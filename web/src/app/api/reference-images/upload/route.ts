import { NextResponse } from "next/server";
import fs from "fs-extra";
import path from "path";
import { ObjectId } from "mongodb";
import { getMongoDb } from "@/lib/server/mongodb";
import { guessMimeFromPath, isImageFileName } from "@/lib/server/utils";
import { requireApiAccess } from "@/lib/server/auth";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

const UPLOAD_DIR = "reference-uploads";
const MAX_FILES = 200;

async function resolvePublicDir(): Promise<string> {
  const cwd = process.cwd();
  const p1 = path.join(cwd, "public");
  const p2 = path.join(cwd, "web", "public");
  if (await fs.pathExists(p1)) return p1;
  if (await fs.pathExists(p2)) return p2;
  return p1;
}

function safeFileName(name: string): string {
  return String(name || "")
    .replace(/[<>:"/\\|?*\x00-\x1f]/g, "_")
    .trim() || "image";
}

export async function POST(req: Request) {
  try {
    const guard = requireApiAccess(req);
    if (!guard.ok) return NextResponse.json({ ok: false, error: guard.error }, { status: guard.status });
    const user = guard.user;
    const formData = await req.formData();
    const toGalleryRaw = formData.get("toGallery");
    const toGallery = String(toGalleryRaw ?? "").trim() === "1" || String(toGalleryRaw ?? "").trim().toLowerCase() === "true";
    const appName = String(formData.get("appName") ?? "").trim() || undefined;
    const lang = String(formData.get("lang") ?? "").trim() || undefined;
    const aspectRatio = String(formData.get("aspectRatio") ?? "").trim() || undefined;
    const files = formData.getAll("files");
    if (!files || !Array.isArray(files) || files.length === 0) {
      return NextResponse.json({ ok: false, error: "请选择至少一个文件" }, { status: 400 });
    }
    if (files.length > MAX_FILES) {
      return NextResponse.json({ ok: false, error: `最多上传 ${MAX_FILES} 个文件` }, { status: 400 });
    }

    const publicDir = await resolvePublicDir();
    const uploadDir = path.join(publicDir, "material", UPLOAD_DIR);
    await fs.ensureDir(uploadDir);

    const savedPaths: string[] = [];
    const savedUrls: string[] = [];
    const savedMimeTypes: string[] = [];
    const seen = new Set<string>();
    const cwd = process.cwd();

    for (let i = 0; i < files.length; i++) {
      const item = files[i];
      if (!(item instanceof File)) continue;
      const base = safeFileName(item.name) || "image";
      const ext = path.extname(base).toLowerCase();
      if (!isImageFileName(base)) continue;

      let filename = base;
      if (seen.has(filename)) {
        const stem = path.basename(base, ext);
        let k = 1;
        while (seen.has(`${stem}-${k}${ext}`)) k++;
        filename = `${stem}-${k}${ext}`;
      }
      seen.add(filename);

      const absPath = path.join(uploadDir, filename);
      const buf = Buffer.from(await item.arrayBuffer());
      await fs.writeFile(absPath, buf);
      savedPaths.push(path.relative(cwd, absPath));
      savedUrls.push(`/material/${UPLOAD_DIR}/${encodeURIComponent(filename)}`);
      savedMimeTypes.push((item.type && item.type.startsWith("image/")) ? item.type : guessMimeFromPath(filename));
    }

    if (!savedPaths.length) {
      return NextResponse.json({ ok: false, error: "没有有效的图片文件" }, { status: 400 });
    }

    let inserted = 0;
    let insertedIds: string[] = [];
    if (toGallery && savedUrls.length) {
      try {
        const db = await getMongoDb();
        const col = db.collection("generation_records");
        const now = new Date();
        const jobId = new ObjectId();
        const configId = new ObjectId();
        const docs = savedUrls.map((url, idx) => ({
          userId: user.userId,
          jobId,
          configId,
          index: idx,
          status: "completed",
          prompt: "",
          url,
          mimeType: savedMimeTypes[idx] || undefined,
          createdAt: now,
          ...(appName ? { appName } : {}),
          ...(lang ? { lang } : {}),
          ...(aspectRatio ? { aspectRatio } : {}),
        }));
        const result = await col.insertMany(docs as any[], { ordered: false } as any);
        inserted = Number(result?.insertedCount || 0) || 0;
        insertedIds = result?.insertedIds ? Object.values(result.insertedIds).map((x: any) => String(x)) : [];
      } catch {
      }
    }

    return NextResponse.json({ ok: true, paths: savedPaths, urls: savedUrls, inserted, insertedIds });
  } catch (e) {
    const message = e instanceof Error ? e.message : "上传失败";
    return NextResponse.json({ ok: false, error: message }, { status: 500 });
  }
}
