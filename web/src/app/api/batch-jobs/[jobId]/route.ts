import { ObjectId } from "mongodb";
import { getMongoDb } from "@/lib/mongodb";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function GET(
  _req: Request,
  ctx: { params: Promise<{ jobId: string }> }
) {
  const { jobId } = await ctx.params;
  if (!jobId || !ObjectId.isValid(jobId)) {
    return Response.json({ ok: false, error: "jobId 非法" }, { status: 400 });
  }

  const db = await getMongoDb();
  const jobsCol = db.collection("batch_jobs");
  const jobConfigsCol = db.collection("batch_job_configs");
  const imagesCol = db.collection("generated_images");
  const configsCol = db.collection("image_configs");

  const _id = new ObjectId(jobId);
  const job = await jobsCol.findOne({ _id });
  if (!job) return Response.json({ ok: false, error: "job 不存在" }, { status: 404 });

  const jobConfigs = await jobConfigsCol.find({ jobId: _id }).toArray();
  const configIds = jobConfigs.map((c: any) => c.configId).filter(Boolean);
  const configs = await configsCol
    .find({ _id: { $in: configIds } }, { projection: { prompt: 1, appName: 1, lang: 1, batchFun: 1, aspectRatio: 1 } as any })
    .toArray();
  const configMap = new Map<string, any>(configs.map((c: any) => [String(c._id), c]));

  const latestImages = await imagesCol
    .find({ jobId: _id }, { sort: { createdAt: -1 }, limit: 200 } as any)
    .toArray();
  const imagesByConfig = new Map<string, any[]>();
  for (const img of latestImages as any[]) {
    const key = String(img.configId);
    const arr = imagesByConfig.get(key) || [];
    arr.push({ url: img.url, index: img.index, createdAt: img.createdAt, mimeType: img.mimeType });
    imagesByConfig.set(key, arr);
  }

  const items = (jobConfigs as any[]).map((jc) => {
    const cfg = configMap.get(String(jc.configId));
    return {
      configId: String(jc.configId),
      status: jc.status,
      total: jc.total,
      done: jc.done,
      error: jc.error,
      configMeta: cfg
        ? {
            appName: cfg.appName,
            lang: cfg.lang,
            batchFun: cfg.batchFun,
            aspectRatio: cfg.aspectRatio,
            prompt: cfg.prompt,
          }
        : undefined,
      images: imagesByConfig.get(String(jc.configId)) || [],
    };
  });

  return Response.json({
    ok: true,
    job: {
      id: String(job._id),
      status: (job as any).status,
      concurrency: (job as any).concurrency,
      total: (job as any).total,
      done: (job as any).done,
      error: (job as any).error,
      createdAt: (job as any).createdAt,
      updatedAt: (job as any).updatedAt,
    },
    items,
  });
}

