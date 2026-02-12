import { NextResponse } from "next/server";
import axios from "axios";
import fs from "fs-extra";
import FormData from "form-data";
import path from "path";
import { chunkArray, mimeFromExt } from "@/lib/server/utils";
import { getMongoDb } from "@/lib/server/mongodb";
import { requireApiAccess, resolveGalleryGroupUserIds } from "@/lib/server/auth";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

const FIREPLAY_API_BASE = "https://api.fireplay.ai";
const BATCH_MAX_FILES = 30;

function getFireplayAuthHeader(req: Request): string {
  const fromReq = String(req.headers.get("authorization") || "").trim();
  if (fromReq) return fromReq;
  const token = String(process.env.FIREPLAY_API_TOKEN || "").trim();
  if (token) return token.startsWith("Bearer ") ? token : `Bearer ${token}`;
  return "";
}

function toGeneratedPath(src: string): string {
  const s = String(src || "").trim();
  if (!s) return "";
  if (/^https?:\/\//i.test(s)) {
    const u = new URL(s);
    return u.pathname || "";
  }
  return s.startsWith("/") ? s : `/${s}`;
}

async function readImageAsBuffer(src: string): Promise<{ buffer: Buffer; fileName: string; contentType: string }> {
  const p = toGeneratedPath(src);
  if (!p.startsWith("/generated/")) {
    throw new Error(`仅支持从本地 /generated/... 读取: ${p || src}`);
  }
  const rel = p.replace(/^\/+/, "").replace(/\.\.(\/|\\)/g, "");
  const abs = path.join(process.cwd(), "public", rel);
  if (!(await fs.pathExists(abs))) throw new Error(`本地文件不存在: ${p}`);
  const buffer = await fs.readFile(abs);
  const contentType = mimeFromExt(path.extname(abs));
  const fileName = path.basename(abs);
  return { buffer, fileName, contentType };
}

export async function POST(req: Request) {
  try {
    const guard = requireApiAccess(req);
    if (!guard.ok) return NextResponse.json({ ok: false, error: guard.error }, { status: guard.status });
    const user = guard.user;
    const { searchParams } = new URL(req.url);
    const scope = String(searchParams.get("scope") || "").trim();
    const useGalleryScope = scope === "gallery";
    const groupUserIds = useGalleryScope ? resolveGalleryGroupUserIds(user.username) : [];
    const userIdFilter = useGalleryScope && groupUserIds.length ? { $in: groupUserIds } : user.userId;
    const authHeader = getFireplayAuthHeader(req);
    const body: any = await req.json().catch(() => ({}));
    const imageUrls: string[] = Array.isArray(body?.imageUrls)
      ? body.imageUrls.map((x: any) => String(x || "").trim()).filter(Boolean)
      : [];
    const type = (body?.type === "kids" || body?.type === "buzz" || body?.type === "app") ? body.type : "app";
    const ownerId = Number.isFinite(Number(body?.ownerId)) ? Number(body.ownerId) : 0;

    if (!imageUrls.length) {
      return NextResponse.json({ ok: false, error: "imageUrls 不能为空" }, { status: 400 });
    }

    // 同组去重：已经上传过 Fireplay 的源图不再重复上传
    let urlsToUpload = imageUrls;
    let skippedSourceUrls: string[] = [];
    try {
      const db = await getMongoDb();
      const col = db.collection<{ userId: string; sourceUrl: string }>("fireplay_upload_records");
      const uniq = Array.from(new Set(imageUrls.map((x) => String(x || "").trim()).filter(Boolean)));
      const existing = uniq.length
        ? await col.find({ userId: userIdFilter as any, sourceUrl: { $in: uniq } } as any, { projection: { sourceUrl: 1 } as any } as any).toArray()
        : [];
      const existedSet = new Set(existing.map((d: any) => String(d?.sourceUrl || "").trim()).filter(Boolean));
      skippedSourceUrls = uniq.filter((u) => existedSet.has(u));
      urlsToUpload = imageUrls.filter((u) => !existedSet.has(String(u || "").trim()));
    } catch {
      // ignore, fallback to upload all
      urlsToUpload = imageUrls;
      skippedSourceUrls = [];
    }

    if (!urlsToUpload.length) {
      return NextResponse.json({ ok: true, uploadedUrls: [], uploadedSourceUrls: [], skippedSourceUrls, data: { results: [] } });
    }

    const uploadedUrls: string[] = [];
    const localUrlsForUploaded: string[] = [];
    const chunks = chunkArray(urlsToUpload, BATCH_MAX_FILES);

    for (let batchIndex = 0; batchIndex < chunks.length; batchIndex++) {
      const urls: string[] = chunks[batchIndex] as string[];
      const form = new FormData();
      for (let i = 0; i < urls.length; i++) {
        const url = String(urls[i] || "").trim();
        const { buffer, fileName, contentType } = await readImageAsBuffer(url);
        form.append("files", buffer, { filename: fileName, contentType });
      }
      const uploadRes = await axios.post(`${FIREPLAY_API_BASE}/api/upload/batch-image`, form, {
        headers: { ...form.getHeaders(), ...(authHeader ? { Authorization: authHeader } : {}) },
        maxBodyLength: Infinity,
        maxContentLength: Infinity,
      });
      const uploadJson: any = uploadRes.data;
      if (!uploadJson?.data?.results) {
        throw new Error(uploadJson?.error || "上传到 Fireplay 失败");
      }
      const results = uploadJson.data.results as Array<{ success: boolean; url?: string }>;
      for (let i = 0; i < results.length; i++) {
        const r = results[i];
        if (r?.success && r.url) {
          uploadedUrls.push(String(r.url));
          localUrlsForUploaded.push(String(urls[i] || "").trim());
        }
      }
    }

    if (!uploadedUrls.length) {
      throw new Error("所有图片上传到 Fireplay 失败");
    }

    const batchRes = await axios.post(
      `${FIREPLAY_API_BASE}/api/original-image/batch-upload`,
      { fileUrls: uploadedUrls, type, ownerId },
      { headers: { Authorization: authHeader } }
    );
    const batchJson: any = batchRes.data;
    if (!batchJson?.data?.results) {
      throw new Error(batchJson?.error || "写入 Fireplay DB 失败");
    }

    const uploadedSourceUrls: string[] = [];
    try {
      const results = batchJson.data.results as Array<{ success: boolean }>;
      for (let i = 0; i < results.length; i++) {
        const r = results[i];
        if (r?.success) uploadedSourceUrls.push(String(localUrlsForUploaded[i] || "").trim());
      }
    } catch {
    }

    if (uploadedSourceUrls.length) {
      try {
        const db = await getMongoDb();
        const col = db.collection("fireplay_upload_records");
        const now = new Date();
        const uniq = Array.from(new Set(uploadedSourceUrls.map((x) => String(x || "").trim()).filter(Boolean)));
        if (uniq.length) {
          await col.bulkWrite(
            uniq.map((sourceUrl) => ({
              updateOne: {
                filter: { userId: user.userId, sourceUrl },
                update: { $set: { userId: user.userId, sourceUrl, uploadedAt: now, type, ownerId }, $setOnInsert: { createdAt: now } },
                upsert: true,
              },
            })),
            { ordered: false } as any
          );
        }
      } catch {
      }
    }

    return NextResponse.json({ ok: true, uploadedUrls, uploadedSourceUrls, skippedSourceUrls, data: batchJson.data });
  } catch (e) {
    const anyErr: any = e;
    const message =
      anyErr?.response?.data?.error ||
      anyErr?.response?.data?.message ||
      (e instanceof Error ? e.message : "未知错误");
    const status = Number(anyErr?.response?.status) || 500;
    return NextResponse.json({ ok: false, error: message }, { status: status >= 400 && status < 600 ? status : 500 });
  }
}

