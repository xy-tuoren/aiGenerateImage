import { NextResponse } from "next/server";
import axios from "axios";
import fs from "fs-extra";
import FormData from "form-data";
import path from "path";
import { chunkArray, mimeFromExt } from "@/lib/server/utils";

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
    const authHeader = getFireplayAuthHeader(req);
    // if (!authHeader) {
    //   return NextResponse.json(
    //     { ok: false, error: "缺少 Fireplay 授权：请设置服务端环境变量 FIREPLAY_API_TOKEN（或在请求头带 Authorization）" },
    //     { status: 401 }
    //   );
    // }
    const body: any = await req.json().catch(() => ({}));
    const imageUrls: string[] = Array.isArray(body?.imageUrls)
      ? body.imageUrls.map((x: any) => String(x || "").trim()).filter(Boolean)
      : [];
    const type = (body?.type === "kids" || body?.type === "buzz" || body?.type === "app") ? body.type : "app";
    const ownerId = Number.isFinite(Number(body?.ownerId)) ? Number(body.ownerId) : 0;

    if (!imageUrls.length) {
      return NextResponse.json({ ok: false, error: "imageUrls 不能为空" }, { status: 400 });
    }

    const uploadedUrls: string[] = [];
    const chunks = chunkArray(imageUrls, BATCH_MAX_FILES);

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
      for (const r of uploadJson.data.results as Array<{ success: boolean; url?: string }>) {
        if (r?.success && r.url) uploadedUrls.push(String(r.url));
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

    return NextResponse.json({ ok: true, uploadedUrls, data: batchJson.data });
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

