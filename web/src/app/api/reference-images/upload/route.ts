import { NextResponse } from "next/server";
import fs from "fs-extra";
import path from "path";
import { isImageFileName } from "@/lib/server/utils";

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
    const formData = await req.formData();
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
    }

    if (!savedPaths.length) {
      return NextResponse.json({ ok: false, error: "没有有效的图片文件" }, { status: 400 });
    }

    return NextResponse.json({ ok: true, paths: savedPaths });
  } catch (e) {
    const message = e instanceof Error ? e.message : "上传失败";
    return NextResponse.json({ ok: false, error: message }, { status: 500 });
  }
}
