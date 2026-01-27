import * as fs from "fs-extra";
import { join, normalize } from "path";
import { ObjectId } from "mongodb";
import archiver from "archiver";
import sharp from "sharp";
import { Readable } from "stream";
import { getMongoDb } from "@/lib/server/mongodb";

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
  sourceUrl: string;
  sourceAbsPath: string;
  outputs?: Record<string, Record<string, CutRecordOutputItem>>;
};

function publicUrlToAbsPath(u: string) {
  const url = String(u || "").trim();
  if (!url.startsWith("/")) throw new Error("url 必须是站内路径（以 / 开头）");
  const rel = normalize(url).replaceAll("\\", "/");
  if (rel.includes("..")) throw new Error("非法路径");
  return join(process.cwd(), "public", rel.replace(/^\//, ""));
}

async function readAsJpegBuffer(absPath: string): Promise<Buffer> {
  const buf = await fs.readFile(absPath);
  return await sharp(buf).flatten({ background: "#ffffff" }).jpeg({ quality: 95 }).toBuffer();
}

export async function POST(req: Request) {
  const body = await req.json().catch(() => null);
  if (!body || typeof body !== "object") {
    return Response.json({ ok: false, error: "body 必须是 JSON 对象" }, { status: 400 });
  }

  const idsRaw = (body as any).ids;
  const ids = Array.isArray(idsRaw) ? idsRaw.map((x) => String(x)).filter(Boolean) : [];
  if (!ids.length) return Response.json({ ok: false, error: "ids 不能为空" }, { status: 400 });

  const startFolderIndex = Math.max(1, Number((body as any).startFolderIndex ?? 1) || 1);
  const fixedCode = String((body as any).fixedCode ?? "404").trim() || "404";
  const excludedKeysRaw = (body as any).excludedKeys;
  const excludedKeysArr = Array.isArray(excludedKeysRaw) ? excludedKeysRaw.map((x) => String(x)).filter(Boolean) : [];
  const excludedSet = new Set(excludedKeysArr);

  // 为了匹配样例命名：每个 ratio 只取这 3 个模板（不含 stitchLongImage1024 / vertical collage）
  const templateOrder = ["getCutLogoFinalPrompt", "getCutOtherFinalPrompt", "getCutScaleFinalPrompt"];

  const db = await getMongoDb();
  const col = db.collection<CutRecordDoc>("cut_records");

  const objectIds = ids.filter((id) => ObjectId.isValid(id)).map((id) => new ObjectId(id));
  if (!objectIds.length) return Response.json({ ok: false, error: "ids 非法" }, { status: 400 });

  const docs = await col.find({ _id: { $in: objectIds } }).toArray();
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
            for (const tpl of templateOrder) {
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
            for (const tpl of templateOrder) {
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

  archive.on("error", (err: any) => {
    try {
      archive.abort();
    } catch {
    }
  });

  const filename = `cut-download-${Date.now()}.zip`;
  return new Response(webStream as any, {
    headers: {
      "Content-Type": "application/zip",
      "Content-Disposition": `attachment; filename="${filename}"`,
      "Cache-Control": "no-store",
      "X-Items-Added": String(added),
    },
  });
}

