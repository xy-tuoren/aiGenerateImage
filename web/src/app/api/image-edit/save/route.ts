import { NextRequest } from "next/server";
import fs from "fs-extra";
import path from "path";
import { ObjectId } from "mongodb";
import { getMongoDb } from "@/lib/server/mongodb";
import { requireApiAccess } from "@/lib/server/auth";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

async function resolvePublicDir(): Promise<string> {
  const cwd = process.cwd();
  const p1 = path.join(cwd, "public");
  const p2 = path.join(cwd, "web", "public");
  if (await fs.pathExists(p1)) return p1;
  if (await fs.pathExists(p2)) return p2;
  return p1;
}

function mimeToExt(mimeType: string): string {
  const mt = String(mimeType || "").toLowerCase();
  if (mt.includes("png")) return "png";
  if (mt.includes("jpeg") || mt.includes("jpg")) return "jpg";
  if (mt.includes("webp")) return "webp";
  if (mt.includes("gif")) return "gif";
  return "png";
}

export async function POST(req: NextRequest) {
  const guard = requireApiAccess(req);
  if (!guard.ok) return Response.json({ ok: false, error: guard.error }, { status: guard.status });
  const user = guard.user;

  const body = await req.json().catch(() => null);
  if (!body || typeof body !== "object") {
    return Response.json({ ok: false, error: "body 必须是 JSON 对象" }, { status: 400 });
  }

  const imageBase64 = String((body as any).imageBase64 || "").trim();
  if (!imageBase64) {
    return Response.json({ ok: false, error: "imageBase64 不能为空" }, { status: 400 });
  }

  const mimeType = String((body as any).mimeType || "image/png").trim();
  const mode = String((body as any).mode || "new").trim(); // 'override' | 'new'
  const originalUrl = String((body as any).originalUrl || "").trim();
  const appName = String((body as any).appName || "").trim() || undefined;
  const lang = String((body as any).lang || "").trim() || undefined;
  const aspectRatio = String((body as any).aspectRatio || "").trim() || undefined;
  const prompt = String((body as any).prompt || "").trim() || undefined;
  const referenceImageUrls: string[] = Array.isArray((body as any).referenceImageUrls)
    ? (body as any).referenceImageUrls.map((x: any) => String(x || "").trim()).filter(Boolean)
    : [];

  const publicDir = await resolvePublicDir();
  const buf = Buffer.from(imageBase64, "base64");

  if (mode === "override" && originalUrl) {
    // Override original image file
    try {
      const decoded = decodeURIComponent(originalUrl);
      const absPath = path.join(publicDir, decoded);
      
      // Security check: must be under public/material
      const materialDir = path.resolve(path.join(publicDir, "material"));
      const resolvedPath = path.resolve(absPath);
      if (!resolvedPath.startsWith(materialDir)) {
        return Response.json({ ok: false, error: "路径不合法" }, { status: 400 });
      }

      // Write the new image (may have different extension)
      const ext = mimeToExt(mimeType);
      const origExt = path.extname(absPath).replace(".", "").toLowerCase();
      
      if (ext === origExt) {
        // Same extension, overwrite in place
        await fs.writeFile(absPath, buf);
      } else {
        // Different extension, write new file and remove old
        const newPath = absPath.replace(/\.[^.]+$/, `.${ext}`);
        await fs.writeFile(newPath, buf);
        if (newPath !== absPath && await fs.pathExists(absPath)) {
          await fs.remove(absPath);
        }
      }

      // Update database record
      const db = await getMongoDb();
      const recordsCol = db.collection("generation_records");
      
      // Try to update the record URL if extension changed
      const newUrl = ext !== origExt
        ? originalUrl.replace(/\.[^.]+$/, `.${ext}`)
        : originalUrl;

      await recordsCol.updateMany(
        { url: originalUrl, userId: user.userId } as any,
        {
          $set: {
            mimeType,
            ...(newUrl !== originalUrl ? { url: newUrl } : {}),
            ...(prompt ? { prompt } : {}),
            updatedAt: new Date(),
          },
        }
      );

      return Response.json({ ok: true, url: newUrl, mode: "override" });
    } catch (e: any) {
      const msg = e instanceof Error ? e.message : String(e);
      return Response.json({ ok: false, error: `覆盖失败: ${msg}` }, { status: 500 });
    }
  }

  // Save as new image
  try {
    const ext = mimeToExt(mimeType);
    const ts = Date.now();
    const uploadDir = path.join(publicDir, "material", "image-edit");
    await fs.ensureDir(uploadDir);

    let filename = `${ts}.${ext}`;
    let absFile = path.join(uploadDir, filename);
    let i = 2;
    while (await fs.pathExists(absFile)) {
      filename = `${ts}-${i}.${ext}`;
      absFile = path.join(uploadDir, filename);
      i++;
    }

    await fs.writeFile(absFile, buf);
    const url = `/material/image-edit/${encodeURIComponent(filename)}`;

    // Create generation record
    const db = await getMongoDb();
    const recordsCol = db.collection("generation_records");
    const now = new Date();
    const jobId = new ObjectId();
    const configId = new ObjectId();

    await recordsCol.insertOne({
      userId: user.userId,
      jobId,
      configId,
      index: 0,
      status: "completed",
      prompt: prompt || "",
      url,
      mimeType,
      createdAt: now,
      ...(appName ? { appName } : {}),
      ...(lang ? { lang } : {}),
      ...(aspectRatio ? { aspectRatio } : {}),
      ...(referenceImageUrls.length ? { referenceImages: referenceImageUrls } : {}),
    });

    return Response.json({ ok: true, url, mode: "new" });
  } catch (e: any) {
    const msg = e instanceof Error ? e.message : String(e);
    return Response.json({ ok: false, error: `保存失败: ${msg}` }, { status: 500 });
  }
}
