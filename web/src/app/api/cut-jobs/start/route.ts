import * as fs from "fs-extra";
import { join, normalize } from "path";
import { ObjectId } from "mongodb";
import { getMongoDb } from "@/lib/server/mongodb";
import { startCutJob } from "@/lib/server/batchJobRunner";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

type CutJobItemDoc = {
  _id?: ObjectId;
  jobId: ObjectId;
  sourceUrl: string;
  sourceAbsPath: string;
  appName?: string;
  lang?: string;
  ratio: string;
  templateName: string;
  status: "queued" | "running" | "completed" | "failed";
  total: number;
  done: number;
  error?: string;
  outputUrl?: string;
  outputMimeType?: string;
  createdAt: Date;
  updatedAt: Date;
};

function publicUrlToAbsPath(u: string) {
  const url = String(u || "").trim();
  if (!url.startsWith("/")) throw new Error("url 必须是站内路径（以 / 开头）");
  const rel = normalize(url).replaceAll("\\", "/");
  if (rel.includes("..")) throw new Error("非法路径");
  return join(process.cwd(), "public", rel.replace(/^\//, ""));
}

export async function POST(req: Request) {
  const body = await req.json().catch(() => null);
  if (!body || typeof body !== "object") {
    return Response.json({ ok: false, error: "body 必须是 JSON 对象" }, { status: 400 });
  }

  const imagesRaw = (body as any).images;
  const images = Array.isArray(imagesRaw) ? imagesRaw : [];
  if (!images.length) {
    return Response.json({ ok: false, error: "images 不能为空" }, { status: 400 });
  }

  const concurrency = Math.max(1, Number((body as any).concurrency ?? 8) || 8);

  const templateNames = ["getCutLogoFinalPrompt", "getCutOtherFinalPrompt", "getCutScaleFinalPrompt"];
  const ratios = ["1:1", "4:5"];

  const now = new Date();
  const itemDocs: Omit<CutJobItemDoc, "_id" | "jobId">[] = [];

  for (const it of images) {
    const url = String((it as any)?.url || "").trim();
    if (!url) continue;
    const appName = (it as any)?.appName ? String((it as any).appName) : undefined;
    const lang = (it as any)?.lang ? String((it as any).lang) : undefined;

    const abs = publicUrlToAbsPath(url);
    const exists = await fs.pathExists(abs);
    if (!exists) {
      return Response.json({ ok: false, error: `图片不存在: ${url}` }, { status: 400 });
    }

    for (const ratio of ratios) {
      for (const templateName of templateNames) {
        itemDocs.push({
          sourceUrl: url,
          sourceAbsPath: abs,
          appName,
          lang,
          ratio,
          templateName,
          status: "queued",
          total: 1,
          done: 0,
          createdAt: now,
          updatedAt: now,
        });
      }
    }
  }

  if (!itemDocs.length) {
    return Response.json({ ok: false, error: "没有可创建的裁图任务" }, { status: 400 });
  }

  const db = await getMongoDb();
  const jobsCol = db.collection("batch_jobs");
  const cutItemsCol = db.collection<CutJobItemDoc>("cut_job_items");

  const total = itemDocs.length;
  const job = {
    status: "queued",
    concurrency,
    total,
    done: 0,
    createdAt: now,
    updatedAt: now,
    extra: { type: "cut" },
  };
  const insertJob = await jobsCol.insertOne(job as any);
  const jobId = insertJob.insertedId as ObjectId;

  await cutItemsCol.insertMany(itemDocs.map((x) => ({ ...x, jobId })) as any[]);

  await startCutJob({
    jobId: String(jobId),
    concurrency,
  });

  return Response.json({ ok: true, jobId: String(jobId), createdItems: total });
}

