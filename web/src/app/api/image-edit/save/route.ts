import { NextRequest } from "next/server";
import fs from "fs-extra";
import path from "path";
import { ObjectId } from "mongodb";
import { getMongoDb } from "@/lib/server/mongodb";
import { requireApiAccess } from "@/lib/server/auth";
import { resizeImageByAspectRatio } from "@/lib/server/utils";

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

function stripQueryHash(input: string) {
  const s = String(input || "").trim();
  if (!s) return s;
  const q = s.indexOf("?");
  const h = s.indexOf("#");
  const cut = Math.min(q >= 0 ? q : s.length, h >= 0 ? h : s.length);
  return s.slice(0, cut);
}

function normalizeOriginalUrlToPathname(input: string): string {
  let s = String(input || "").trim();
  if (!s) return s;

  // If it's an absolute URL, use its pathname/search.
  if (/^[a-zA-Z][a-zA-Z0-9+.-]*:\/\//.test(s)) {
    try {
      const u = new URL(s);
      s = `${u.pathname}${u.search || ""}`;
    } catch {
      // keep original
    }
  }

  // Handle Next.js image optimizer URL: /_next/image?url=...
  if (s.startsWith("/_next/image")) {
    try {
      const u = new URL(s, "http://localhost");
      const inner = String(u.searchParams.get("url") || "").trim();
      if (inner) s = inner;
    } catch {
      // keep
    }
  }

  // If the extracted inner URL is still absolute, normalize again.
  if (/^[a-zA-Z][a-zA-Z0-9+.-]*:\/\//.test(s)) {
    try {
      const u = new URL(s);
      s = u.pathname;
    } catch {
      // keep
    }
  }

  return s;
}

function canonicalizePublicAssetUrl(input: string): { ok: true; url: string; root: "material" | "generated" } | { ok: false } {
  let s = String(input || "").trim();
  if (!s) return { ok: false };

  // Decode once so things like %2Fgenerated%2F... become /generated/...
  try {
    s = decodeURIComponent(s);
  } catch {
    // keep
  }

  if (!s.startsWith("/")) s = `/${s}`;

  const parts = s.split("/");
  const root = parts[1];
  if (root !== "material" && root !== "generated") return { ok: false };

  // Re-encode each segment except leading "" and the root folder.
  const out = parts.map((seg, idx) => {
    if (idx <= 1) return seg; // "" + root
    if (!seg) return seg;
    try {
      return encodeURIComponent(decodeURIComponent(seg));
    } catch {
      return encodeURIComponent(seg);
    }
  });

  return { ok: true, url: out.join("/"), root };
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
  const finalBase64 = aspectRatio
    ? await resizeImageByAspectRatio(imageBase64, aspectRatio)
    : imageBase64;
  const buf = Buffer.from(finalBase64, "base64");

  if (mode === "override" && originalUrl) {
    // Override original image file
    try {
      // NOTE: originalUrl is usually like "/material/xxx.png"
      // On Windows, path.join(publicDir, "/material/...") would drop publicDir.
      // Normalize it into a relative path under publicDir.
      const originalUrlNoQh = stripQueryHash(normalizeOriginalUrlToPathname(originalUrl));
      const candidate = originalUrlNoQh.startsWith("/") ? originalUrlNoQh : `/${originalUrlNoQh}`;
      const canon = canonicalizePublicAssetUrl(candidate);
      if (!canon.ok) {
        return Response.json({ ok: false, error: "路径不合法" }, { status: 400 });
      }
      const originalUrlForDb = canon.url;

      const decodedPathname = (() => {
        try {
          return decodeURIComponent(originalUrlForDb);
        } catch {
          return originalUrlForDb;
        }
      })();

      const rel = decodedPathname.replace(/^\/+/, "");
      const absPath = path.resolve(path.join(publicDir, rel));

      // Security check: must be under public/material OR public/generated
      const allowedRootDir = path.resolve(path.join(publicDir, canon.root));
      const resolvedPath = absPath;
      if (!(resolvedPath === allowedRootDir || resolvedPath.startsWith(allowedRootDir + path.sep))) {
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
        const newPath = origExt ? absPath.replace(/\.[^.]+$/, `.${ext}`) : `${absPath}.${ext}`;
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
        ? originalUrlForDb.replace(/\.[^.]+$/, `.${ext}`)
        : originalUrlForDb;

      const urlCandidates = Array.from(
        new Set(
          [
            originalUrl,
            originalUrlNoQh,
            candidate,
            decodedPathname,
            originalUrlForDb,
            stripQueryHash(originalUrlForDb),
          ]
            .map((s) => String(s || "").trim())
            .filter(Boolean)
        )
      );

      await recordsCol.updateMany(
        { url: { $in: urlCandidates }, userId: user.userId } as any,
        {
          $set: {
            mimeType,
            ...(newUrl !== originalUrlForDb ? { url: newUrl } : {}),
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
