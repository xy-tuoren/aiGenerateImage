import * as fs from "fs-extra";
import { basename, join, normalize } from "path";
import { ObjectId } from "mongodb";
import archiver from "archiver";
import sharp from "sharp";
import { Readable } from "stream";
import { getMongoDb } from "@/lib/server/mongodb";
import { extFromMime } from "@/lib/server/utils";
import { getUserFromRequest } from "@/lib/server/auth";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

type CutRecordOutputItem = {
  status: "queued" | "running" | "completed" | "failed";
  outputUrl?: string;
  outputMimeType?: string;
  error?: string;
  updatedAt?: Date;
};

type CutRecordDoc = {
  _id?: ObjectId;
  userId: string;
  sourceUrl: string;
  sourceAbsPath: string;
  appName?: string;
  lang?: string;
  outputs?: Record<string, Record<string, CutRecordOutputItem>>;
};

type GenerationRecordDoc = {
  _id?: ObjectId;
  userId: string;
  url?: string;
  status?: string;
};

function publicUrlToAbsPath(u: string) {
  const url = String(u || "").trim();
  if (!url.startsWith("/")) throw new Error("url 必须是站内路径（以 / 开头）");
  const rawPath = url.split("?")[0].split("#")[0];
  const decodedPath = rawPath
    .split("/")
    .map((seg, idx) => {
      if (idx === 0) return seg;
      if (!seg) return seg;
      try {
        const d = decodeURIComponent(seg);
        if (d.includes("/") || d.includes("\\")) throw new Error("非法路径");
        return d;
      } catch {
        return seg;
      }
    })
    .join("/");
  const rel = normalize(decodedPath).replaceAll("\\", "/");
  if (rel.includes("..")) throw new Error("非法路径");
  return join(process.cwd(), "public", rel.replace(/^\//, ""));
}

async function readAsJpegBuffer(absPath: string): Promise<Buffer> {
  const buf = await fs.readFile(absPath);
  return await sharp(buf).flatten({ background: "#ffffff" }).jpeg({ quality: 95 }).toBuffer();
}

async function readUrlAsRawBuffer(u: string): Promise<{ buf: Buffer; mimeType?: string } | null> {
  const url = String(u || "").trim();
  if (!url) return null;
  if (/^https?:\/\//i.test(url)) {
    const res = await fetch(url);
    if (!res.ok) return null;
    const ab = await res.arrayBuffer();
    const mimeType = res.headers.get("content-type") || undefined;
    return { buf: Buffer.from(ab), mimeType };
  }
  const abs = publicUrlToAbsPath(url);
  if (!(await fs.pathExists(abs))) return null;
  return { buf: await fs.readFile(abs) };
}

export async function POST(req: Request) {
  const user = getUserFromRequest(req);
  if (!user) return Response.json({ ok: false, error: "未登录" }, { status: 401 });
  const body = await req.json().catch(() => null);
  if (!body || typeof body !== "object") {
    return Response.json({ ok: false, error: "body 必须是 JSON 对象" }, { status: 400 });
  }

  const urlsRaw = (body as any).urls;
  const urls0 = Array.isArray(urlsRaw) ? urlsRaw.map((x) => String(x)).filter(Boolean) : [];
  if (urls0.length) {
    const db = await getMongoDb();
    const genCol = db.collection<GenerationRecordDoc>("generation_records");
    const uniq = Array.from(new Set(urls0.map((x) => String(x || "").trim()).filter(Boolean)));
    const docs = uniq.length
      ? await genCol.find({ userId: user.userId, status: "completed", url: { $in: uniq } } as any, { projection: { url: 1 } as any }).toArray()
      : [];
    const allowed = new Set(docs.map((d: any) => String(d?.url || "").trim()).filter(Boolean));
    const urls = urls0.map((x) => String(x || "").trim()).filter((u) => u && allowed.has(u));
    if (!urls.length) return Response.json({ ok: false, error: "无权限下载" }, { status: 403 });

    const archive = archiver("zip", { zlib: { level: 9 } });
    const webStream = Readable.toWeb(archive as any) as unknown as ReadableStream;

    let added = 0;
    (async () => {
      const pad4 = (n: number) => String(n).padStart(4, "0");
      const sanitize = (s: string) => s.replace(/[\\/:*?"<>|\s]+/g, "-").replace(/-+/g, "-").replace(/(^-|-$)/g, "");
      const folderName = sanitize(String((body as any).folderName ?? "images").trim() || "images");
      const folder = `${folderName}/`;

      try {
        for (let i = 0; i < urls.length; i++) {
          try {
            const u = String(urls[i] || "").trim();
            if (!u) continue;
            const got = await readUrlAsRawBuffer(u);
            if (!got?.buf?.length) continue;
            const rawName = (() => {
              try {
                if (/^https?:\/\//i.test(u)) return basename(new URL(u).pathname || "");
              } catch {
              }
              return basename(u);
            })();
            const mExt = rawName.match(/\.([a-z0-9]+)$/i);
            const ext = (mExt?.[1] ? String(mExt[1]).toLowerCase() : (got.mimeType ? extFromMime(got.mimeType) : "")) || "jpg";
            const base = sanitize(rawName.replace(/\.[^/.]+$/, "")) || `img-${pad4(i + 1)}`;
            archive.append(got.buf, { name: `${folder}${pad4(i + 1)}-${base}.${ext}` });
            added += 1;
          } catch {
          }
        }
      } finally {
        archive.finalize();
      }
    })();

    archive.on("error", () => {
      try {
        archive.abort();
      } catch {
      }
    });

    const pad2 = (n: number) => String(n).padStart(2, "0");
    const now = new Date();
    const datePrefix = `${pad2(now.getMonth() + 1)}${pad2(now.getDate())}`;
    const sanitize = (s: string) => s.replace(/[\\/:*?"<>|\s]+/g, "-").replace(/-+/g, "-").replace(/(^-|-$)/g, "");
    const prefix = sanitize(String((body as any).filenamePrefix ?? "gallery").trim() || "gallery");
    const filenameUtf8 = `${datePrefix}-${prefix}.zip`;
    const filenameAscii = filenameUtf8.replace(/[^\x20-\x7E]+/g, "_");
    const filenameStar = encodeURIComponent(filenameUtf8).replace(/['()]/g, escape).replace(/\*/g, "%2A");
    return new Response(webStream as any, {
      headers: {
        "Content-Type": "application/zip",
        "Content-Disposition": `attachment; filename="${filenameAscii}"; filename*=UTF-8''${filenameStar}`,
        "Cache-Control": "no-store",
        "X-Items-Added": String(added),
      },
    });
  }

  const idsRaw = (body as any).ids;
  const ids = Array.isArray(idsRaw) ? idsRaw.map((x) => String(x)).filter(Boolean) : [];
  if (!ids.length) return Response.json({ ok: false, error: "ids 不能为空" }, { status: 400 });

  const startFolderIndex = Math.max(1, Number((body as any).startFolderIndex ?? 1) || 1);
  const fixedCode = String((body as any).fixedCode ?? "404").trim() || "404";
  const excludedKeysRaw = (body as any).excludedKeys;
  const excludedKeysArr = Array.isArray(excludedKeysRaw) ? excludedKeysRaw.map((x) => String(x)).filter(Boolean) : [];
  const excludedSet = new Set(excludedKeysArr);

  // 模板优先级：先放常用 3 个，再追加其它模板（例如 stitchLongImage1024 / getCutVerticalCollagePrompt）
  const templateOrder = ["getCutLogoFinalPrompt", "getCutOtherFinalPrompt", "getCutScaleFinalPrompt"];

  const db = await getMongoDb();
  const col = db.collection<CutRecordDoc>("cut_records");

  const objectIds = ids.filter((id) => ObjectId.isValid(id)).map((id) => new ObjectId(id));
  if (!objectIds.length) return Response.json({ ok: false, error: "ids 非法" }, { status: 400 });

  const docs = await col.find({ userId: user.userId, _id: { $in: objectIds } } as any).toArray();
  const byId = new Map<string, CutRecordDoc>();
  for (const d of docs) if (d?._id) byId.set(String(d._id), d);

  const orderedDocs: CutRecordDoc[] = [];
  for (const id of ids) {
    const d = byId.get(id);
    if (d) orderedDocs.push(d);
  }
  if (!orderedDocs.length) return Response.json({ ok: false, error: "未找到记录" }, { status: 404 });

  const archive = archiver("zip", { zlib: { level: 9 } });
  const webStream = Readable.toWeb(archive as any) as unknown as ReadableStream;

  let added = 0;
  (async () => {
    try {
      for (let i = 0; i < orderedDocs.length; i++) {
        const folderIndex = startFolderIndex + i;
        const folder = `${folderIndex}/`;
        const rec = orderedDocs[i];

        // 原图 => landscape-1
        try {
          const srcAbs = String(rec.sourceAbsPath || "").trim();
          if (srcAbs && await fs.pathExists(srcAbs)) {
            const jpg = await readAsJpegBuffer(srcAbs);
            archive.append(jpg, { name: `${folder}${folderIndex}@${fixedCode}-landscape-1.jpg` });
            added += 1;
          }
        } catch {
        }

        // 1:1 => square-1..n
        try {
          const outs11 = rec.outputs && rec.outputs["1:1"] ? rec.outputs["1:1"] : undefined;
          if (outs11 && typeof outs11 === "object") {
            let n = 0;
            const tplNames = Object.keys(outs11).sort();
            const orderedTpls = [...templateOrder, ...tplNames.filter((t) => !templateOrder.includes(t))];
            for (const tpl of orderedTpls) {
              if (rec._id && excludedSet.has(`${String(rec._id)}|1:1|${tpl}`)) continue;
              const it = outs11[tpl];
              const url = it?.outputUrl ? String(it.outputUrl) : "";
              if (!url) continue;
              const abs = publicUrlToAbsPath(url);
              if (!(await fs.pathExists(abs))) continue;
              const jpg = await readAsJpegBuffer(abs);
              n += 1;
              archive.append(jpg, { name: `${folder}${folderIndex}@${fixedCode}-square-${n}.jpg` });
              added += 1;
            }
          }
        } catch {
        }

        // 4:5 => vertical-1..n
        try {
          const outs45 = rec.outputs && rec.outputs["4:5"] ? rec.outputs["4:5"] : undefined;
          if (outs45 && typeof outs45 === "object") {
            let n = 0;
            const tplNames = Object.keys(outs45).sort();
            const orderedTpls = [...templateOrder, ...tplNames.filter((t) => !templateOrder.includes(t))];
            for (const tpl of orderedTpls) {
              if (rec._id && excludedSet.has(`${String(rec._id)}|4:5|${tpl}`)) continue;
              const it = outs45[tpl];
              const url = it?.outputUrl ? String(it.outputUrl) : "";
              if (!url) continue;
              const abs = publicUrlToAbsPath(url);
              if (!(await fs.pathExists(abs))) continue;
              const jpg = await readAsJpegBuffer(abs);
              n += 1;
              archive.append(jpg, { name: `${folder}${folderIndex}@${fixedCode}-vertical-${n}.jpg` });
              added += 1;
            }
          }
        } catch {
        }
      }
    } finally {
      archive.finalize();
    }
  })();

  archive.on("error", () => {
    try {
      archive.abort();
    } catch {
    }
  });

  const pad2 = (n: number) => String(n).padStart(2, "0");
  const now = new Date();
  const datePrefix = `${pad2(now.getMonth() + 1)}${pad2(now.getDate())}`;
  const sanitize = (s: string) => s.replace(/[\\/:*?"<>|\s]+/g, "-").replace(/-+/g, "-").replace(/(^-|-$)/g, "");
  const pickedAppNames = orderedDocs.map((d) => String(d.appName || "").trim()).filter(Boolean);
  const pickedLangs = orderedDocs.map((d) => String(d.lang || "").trim()).filter(Boolean);
  const appName =
    pickedAppNames.length && pickedAppNames.every((x) => x === pickedAppNames[0]) ? pickedAppNames[0] : (pickedAppNames.length ? "mixed" : "unknown");
  const lang =
    pickedLangs.length && pickedLangs.every((x) => x === pickedLangs[0]) ? pickedLangs[0] : (pickedLangs.length ? "mixed" : "unknown");
  const filenameUtf8 = `${datePrefix}-${sanitize(appName)}-${sanitize(lang)}.zip`;
  const filenameAscii = filenameUtf8.replace(/[^\x20-\x7E]+/g, "_");
  const filenameStar = encodeURIComponent(filenameUtf8).replace(/['()]/g, escape).replace(/\*/g, "%2A");
  return new Response(webStream as any, {
    headers: {
      "Content-Type": "application/zip",
      "Content-Disposition": `attachment; filename="${filenameAscii}"; filename*=UTF-8''${filenameStar}`,
      "Cache-Control": "no-store",
      "X-Items-Added": String(added),
    },
  });
}

