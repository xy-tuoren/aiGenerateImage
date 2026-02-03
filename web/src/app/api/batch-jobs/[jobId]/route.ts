import { ObjectId } from "mongodb";
import { getMongoDb } from "@/lib/server/mongodb";
import { requireApiAccess } from "@/lib/server/auth";

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
  const guard = requireApiAccess(_req);
  if (!guard.ok) return Response.json({ ok: false, error: guard.error }, { status: guard.status });
  const user = guard.user;

  const db = await getMongoDb();
  const jobsCol = db.collection("batch_jobs");
  const jobConfigsCol = db.collection("batch_job_configs");
  const imagesCol = db.collection("generated_images");
  const configsCol = db.collection("image_configs");
  const cutItemsCol = db.collection("cut_job_items");

  const _id = new ObjectId(jobId);
  const job = await jobsCol.findOne({ _id, userId: user.userId } as any);
  if (!job) return Response.json({ ok: false, error: "job 不存在" }, { status: 404 });

  const jobType = String((job as any)?.extra?.type || "");
  if (jobType === "cut") {
    const cutItems = await cutItemsCol.find({ jobId: _id, userId: user.userId } as any, { sort: { createdAt: -1 }, limit: 5000 } as any).toArray();
    const items = (cutItems as any[]).map((it) => ({
      id: String(it._id),
      configId: String(it.sourceUrl || ""),
      status: it.status,
      total: it.total,
      done: it.done,
      error: it.error,
      configMeta: {
        appName: it.appName,
        lang: it.lang,
        batchFun: `cut/${it.ratio}`,
        aspectRatio: it.ratio,
        prompt: it.templateName,
      },
      images: it.outputUrl ? [{ url: it.outputUrl, index: 0, createdAt: it.updatedAt, mimeType: it.outputMimeType }] : [],
    }));

    return Response.json({
      ok: true,
      job: {
        id: String((job as any)._id),
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

  const jobConfigs = await jobConfigsCol.find({ jobId: _id, userId: user.userId } as any).toArray();
  const needLookupIds = jobConfigs.filter((jc: any) => !jc?.config).map((jc: any) => jc.configId).filter(Boolean);
  const configs = needLookupIds.length
    ? await configsCol
        .find({ _id: { $in: needLookupIds }, userId: user.userId } as any, { projection: { prompt: 1, appName: 1, lang: 1, batchFun: 1, imageConfig: 1, referenceImages: 1 } as any })
        .toArray()
    : [];
  const configMap = new Map<string, any>(configs.map((c: any) => [String(c._id), c]));

  const latestImages = await imagesCol
    .find({ jobId: _id, userId: user.userId } as any, { sort: { createdAt: -1 }, limit: 200 } as any)
    .toArray();
  const imagesByConfig = new Map<string, any[]>();
  for (const img of latestImages as any[]) {
    const key = String(img.configId);
    const arr = imagesByConfig.get(key) || [];
    arr.push({ url: img.url, index: img.index, createdAt: img.createdAt, mimeType: img.mimeType });
    imagesByConfig.set(key, arr);
  }

  const items = (jobConfigs as any[]).map((jc) => {
    const cfg = (jc as any)?.config ? { ...(jc as any).config } : configMap.get(String(jc.configId));
    return {
      configId: String(jc.configId),
      sourceConfigId: jc?.sourceConfigId ? String(jc.sourceConfigId) : undefined,
      status: jc.status,
      total: jc.total,
      done: jc.done,
      error: jc.error,
      configMeta: cfg
        ? {
            appName: cfg.appName,
            lang: cfg.lang,
            batchFun: cfg.batchFun,
            aspectRatio: cfg.imageConfig?.aspectRatio,
            prompt: cfg.prompt,
            referenceImages: cfg.referenceImages,
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

