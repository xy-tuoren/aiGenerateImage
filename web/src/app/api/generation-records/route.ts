import { ObjectId } from "mongodb";
import { getMongoDb } from "@/lib/mongodb";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

type GenerationRecordDoc = {
  _id?: ObjectId;
  jobId: ObjectId;
  configId: ObjectId;
  index: number;
  status: "completed" | "failed";
  prompt: string;
  error?: string;
  url?: string;
  mimeType?: string;
  createdAt: Date;
  appName?: string;
  lang?: string;
  referenceImages?: string[];
};

type GeneratedImageDoc = {
  _id?: ObjectId;
  jobId: ObjectId;
  configId: ObjectId;
  index: number;
  url: string;
  mimeType: string;
  createdAt: Date;
  prompt: string;
  appName?: string;
  lang?: string;
  referenceImages?: string[];
};

type BatchJobConfigDoc = {
  _id?: ObjectId;
  jobId: ObjectId;
  configId: ObjectId;
  status: "queued" | "running" | "completed" | "failed";
  total: number;
  done: number;
  error?: string;
  createdAt: Date;
  updatedAt: Date;
};

export async function GET(req: Request) {
  const { searchParams } = new URL(req.url);
  const limitRaw = searchParams.get("limit");
  const limit = Math.min(5000, Math.max(1, Number(limitRaw ?? 200) || 200));

  const jobId = (searchParams.get("jobId") || "").trim();
  const configId = (searchParams.get("configId") || "").trim();
  const status = (searchParams.get("status") || "").trim();
  const appName = (searchParams.get("appName") || "").trim();
  const lang = (searchParams.get("lang") || "").trim();

  const db = await getMongoDb();
  const recordsCol = db.collection<GenerationRecordDoc>("generation_records");
  const imagesCol = db.collection<GeneratedImageDoc>("generated_images");
  const jobConfigsCol = db.collection<BatchJobConfigDoc>("batch_job_configs");
  const configsCol = db.collection("image_configs");

  let allowedConfigIds: ObjectId[] | null = null;
  if (appName || lang) {
    const configFilter: any = {};
    if (appName) configFilter.appName = appName;
    if (lang) configFilter.lang = lang;
    const matchingConfigs = await configsCol.find(configFilter, { projection: { _id: 1 } as any }).toArray();
    allowedConfigIds = matchingConfigs.map((c: any) => c._id).filter(Boolean);
    if (allowedConfigIds.length === 0) {
      return Response.json({ ok: true, items: [] });
    }
  }

  const filter: any = {};
  if (jobId) {
    if (!ObjectId.isValid(jobId)) return Response.json({ ok: false, error: "jobId 非法" }, { status: 400 });
    filter.jobId = new ObjectId(jobId);
  }
  if (configId) {
    if (!ObjectId.isValid(configId)) return Response.json({ ok: false, error: "configId 非法" }, { status: 400 });
    filter.configId = new ObjectId(configId);
  } else if (allowedConfigIds) {
    filter.configId = { $in: allowedConfigIds };
  }
  if (status) {
    if (status !== "completed" && status !== "failed") return Response.json({ ok: false, error: "status 非法" }, { status: 400 });
    filter.status = status;
  }

  const records = await recordsCol.find(filter, { sort: { createdAt: -1 }, limit } as any).toArray();
  const existingKeys = new Set(records.map((r) => `${String(r.jobId)}|${String(r.configId)}|${Number(r.index)}`));

  const extraFromImages = await imagesCol.find(filter, { sort: { createdAt: -1 }, limit } as any).toArray();
  const extraRecordsFromImages = extraFromImages
    .map((img) => ({
      jobId: img.jobId,
      configId: img.configId,
      index: img.index,
      status: "completed" as const,
      prompt: img.prompt,
      url: img.url,
      mimeType: img.mimeType,
      createdAt: img.createdAt,
      appName: img.appName,
      lang: img.lang,
      referenceImages: img.referenceImages,
    }))
    .filter((r) => !existingKeys.has(`${String(r.jobId)}|${String(r.configId)}|${Number(r.index)}`));

  const extraFailedFromJobConfigs =
    filter.status && filter.status !== "failed"
      ? []
      : await jobConfigsCol
          .find({ ...filter, status: "failed" }, { sort: { updatedAt: -1 }, limit } as any)
          .toArray();
  const extraRecordsFromJobConfigs = extraFailedFromJobConfigs.map((jc) => ({
    jobId: jc.jobId,
    configId: jc.configId,
    index: -1,
    status: "failed" as const,
    prompt: "",
    error: jc.error,
    createdAt: jc.updatedAt || jc.createdAt,
  }));

  const merged = [
    ...records.map((r) => ({ ...r, _id: r._id })),
    ...extraRecordsFromImages,
    ...extraRecordsFromJobConfigs,
  ]
    .filter((r) => (filter.status ? r.status === filter.status : true))
    .sort((a: any, b: any) => new Date(b.createdAt).getTime() - new Date(a.createdAt).getTime())
    .slice(0, limit);

  const configIds = Array.from(new Set(merged.map((r: any) => String(r.configId)))).filter(Boolean);
  const configObjectIds = configIds.map((id) => new ObjectId(id));
  const configs = configObjectIds.length
    ? await configsCol
        .find(
          { _id: { $in: configObjectIds } },
          { projection: { prompt: 1, appName: 1, lang: 1, batchFun: 1, imageConfig: 1 } as any }
        )
        .toArray()
    : [];
  const configMap = new Map<string, any>(configs.map((c: any) => [String(c._id), c]));

  const items = merged.map((r: any) => {
    const cfg = configMap.get(String(r.configId));
    const appName = r.appName ?? cfg?.appName;
    const lang = r.lang ?? cfg?.lang;
    const referenceImages = r.referenceImages ?? cfg?.referenceImages;
    return {
      id: r._id ? String(r._id) : undefined,
      jobId: String(r.jobId),
      configId: String(r.configId),
      index: r.index,
      status: r.status,
      prompt: r.prompt || cfg?.prompt,
      error: r.error,
      url: r.url,
      mimeType: r.mimeType,
      createdAt: r.createdAt,
      appName,
      lang,
      referenceImages,
      configMeta: cfg
        ? {
            appName: appName ?? cfg.appName,
            lang: lang ?? cfg.lang,
            batchFun: cfg.batchFun,
            aspectRatio: cfg.imageConfig?.aspectRatio,
            prompt: cfg.prompt,
            referenceImages: referenceImages ?? cfg.referenceImages,
          }
        : appName || lang || referenceImages
          ? {
              appName,
              lang,
              batchFun: undefined,
              aspectRatio: undefined,
              prompt: undefined,
              referenceImages,
            }
          : undefined,
    };
  });

  return Response.json({ ok: true, items });
}

