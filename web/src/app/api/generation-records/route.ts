import { ObjectId } from "mongodb";
import { getMongoDb } from "@/lib/server/mongodb";
import { requireApiAccess, resolveGalleryGroupUserIds } from "@/lib/server/auth";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

type GenerationRecordDoc = {
  _id?: ObjectId;
  jobId: ObjectId;
  configId: ObjectId;
  sourceConfigId?: ObjectId;
  index: number;
  status: "completed" | "failed";
  prompt: string;
  error?: string;
  url?: string;
  mimeType?: string;
  createdAt: Date;
  appName?: string;
  lang?: string;
  batchFun?: string;
  aspectRatio?: string;
  referenceImages?: string[];
};

type GeneratedImageDoc = {
  _id?: ObjectId;
  jobId: ObjectId;
  configId: ObjectId;
  sourceConfigId?: ObjectId;
  index: number;
  url: string;
  mimeType: string;
  createdAt: Date;
  prompt: string;
  appName?: string;
  lang?: string;
  batchFun?: string;
  aspectRatio?: string;
  referenceImages?: string[];
};

type BatchJobConfigDoc = {
  _id?: ObjectId;
  jobId: ObjectId;
  configId: ObjectId;
  sourceConfigId?: ObjectId;
  config?: Record<string, any>;
  status: "queued" | "running" | "completed" | "failed";
  total: number;
  done: number;
  error?: string;
  createdAt: Date;
  updatedAt: Date;
};

function escapeRegex(s: string) {
  return s.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

export async function GET(req: Request) {
  const guard = requireApiAccess(req);
  if (!guard.ok) return Response.json({ ok: false, error: guard.error }, { status: guard.status });
  const user = guard.user;
  const { searchParams } = new URL(req.url);
  const scope = String(searchParams.get("scope") || "").trim();
  const useGalleryScope = scope === "gallery";
  const galleryUserIds = useGalleryScope ? resolveGalleryGroupUserIds(user.username) : [];
  const limitRaw = searchParams.get("limit");
  const limit = Math.min(5000, Math.max(1, Number(limitRaw ?? 200) || 200));
  const offsetRaw = searchParams.get("offset");
  const offset = Math.max(0, Number(offsetRaw ?? 0) || 0);
  const fetchLimit = Math.min(5000, offset + limit);

  const jobId = (searchParams.get("jobId") || "").trim();
  const configId = (searchParams.get("configId") || "").trim();
  const status = (searchParams.get("status") || "").trim();
  const appName = (searchParams.get("appName") || "").trim();
  const lang = (searchParams.get("lang") || "").trim();
  const appNameNorm = appName.toLowerCase();
  const langNorm = lang.toLowerCase();

  const db = await getMongoDb();
  const recordsCol = db.collection<GenerationRecordDoc>("generation_records");
  const imagesCol = db.collection<GeneratedImageDoc>("generated_images");
  const jobConfigsCol = db.collection<BatchJobConfigDoc>("batch_job_configs");

  const filter: any = {};
  filter.userId = useGalleryScope && galleryUserIds.length ? { $in: galleryUserIds } : user.userId;
  if (jobId) {
    if (!ObjectId.isValid(jobId)) return Response.json({ ok: false, error: "jobId 非法" }, { status: 400 });
    filter.jobId = new ObjectId(jobId);
  }
  if (configId) {
    if (!ObjectId.isValid(configId)) return Response.json({ ok: false, error: "configId 非法" }, { status: 400 });
    filter.configId = new ObjectId(configId);
  }
  if (status) {
    if (status !== "completed" && status !== "failed") return Response.json({ ok: false, error: "status 非法" }, { status: 400 });
    filter.status = status;
  }
  if (appName) filter.appName = { $regex: new RegExp(`^${escapeRegex(appName)}$`, "i") };
  if (lang) filter.lang = { $regex: new RegExp(`^${escapeRegex(lang)}$`, "i") };

  const [records, totalCount] = await Promise.all([
    recordsCol.find(filter, { sort: { createdAt: -1 }, limit: fetchLimit } as any).toArray(),
    recordsCol.countDocuments(filter),
  ]);
  const existingKeys = new Set(records.map((r) => `${String(r.jobId)}|${String(r.configId)}|${Number(r.index)}`));

  const extraFromImages = await imagesCol.find(filter, { sort: { createdAt: -1 }, limit: fetchLimit } as any).toArray();
  const extraRecordsFromImages = extraFromImages
    .map((img) => ({
      jobId: img.jobId,
      configId: img.configId,
      sourceConfigId: img.sourceConfigId,
      index: img.index,
      status: "completed" as const,
      prompt: img.prompt,
      url: img.url,
      mimeType: img.mimeType,
      createdAt: img.createdAt,
      appName: img.appName,
      lang: img.lang,
      batchFun: img.batchFun,
      aspectRatio: img.aspectRatio,
      referenceImages: img.referenceImages,
    }))
    .filter((r) => !existingKeys.has(`${String(r.jobId)}|${String(r.configId)}|${Number(r.index)}`));

  const extraFailedFromJobConfigs =
    filter.status && filter.status !== "failed"
      ? []
      : await jobConfigsCol
        .find(
          {
            userId: filter.userId,
            ...(filter.jobId ? { jobId: filter.jobId } : {}),
            ...(filter.configId ? { configId: filter.configId } : {}),
            status: "failed",
          } as any,
          { sort: { updatedAt: -1 }, limit: fetchLimit } as any
        )
        .toArray();
  const extraRecordsFromJobConfigs = extraFailedFromJobConfigs.map((jc) => ({
    jobId: jc.jobId,
    configId: jc.configId,
    sourceConfigId: jc.sourceConfigId,
    index: -1,
    status: "failed" as const,
    prompt: jc?.config?.prompt || "",
    error: jc.error,
    createdAt: jc.updatedAt || jc.createdAt,
    appName: jc?.config?.appName,
    lang: jc?.config?.lang,
    batchFun: jc?.config?.batchFun,
    aspectRatio: jc?.config?.imageConfig?.aspectRatio,
    referenceImages: jc?.config?.referenceImages,
  }));

  const merged = [
    ...records.map((r) => ({ ...r, _id: r._id })),
    ...extraRecordsFromImages,
    ...extraRecordsFromJobConfigs,
  ]
    .filter((r) => (filter.status ? r.status === filter.status : true))
    .sort((a: any, b: any) => new Date(b.createdAt).getTime() - new Date(a.createdAt).getTime())
    .slice(offset, offset + limit);

  const configIds = Array.from(new Set(merged.map((r: any) => String(r.configId)))).filter(Boolean);
  const configObjectIds = configIds.map((id) => new ObjectId(id));

  // configId -> sourceConfigId 映射（用于“同一配置跨多次任务合并”）
  const jobCfgMetas = configObjectIds.length
    ? await jobConfigsCol
      .find(
        { userId: filter.userId, configId: { $in: configObjectIds } } as any,
        { projection: { configId: 1, sourceConfigId: 1, config: 1 } as any }
      )
      .toArray()
    : [];
  const cfgIdToSourceId = new Map<string, ObjectId>();
  const jobCfgSnapMap = new Map<string, any>();
  for (const jc of jobCfgMetas as any[]) {
    if (jc?.configId && jc?.sourceConfigId) cfgIdToSourceId.set(String(jc.configId), jc.sourceConfigId);
    if (jc?.configId && jc?.config) jobCfgSnapMap.set(String(jc.configId), jc.config);
  }

  const items = merged.map((r: any) => {
    const cfgId = String(r.configId);
    const cfg = jobCfgSnapMap.get(cfgId);
    const sourceId = r?.sourceConfigId || cfgIdToSourceId.get(cfgId);
    const sourceIdStr = sourceId ? String(sourceId) : "";
    const appName2 = r.appName ?? cfg?.appName;
    const lang2 = r.lang ?? cfg?.lang;
    const referenceImages2 = r.referenceImages ?? cfg?.referenceImages;
    const batchFun2 = r.batchFun ?? cfg?.batchFun;
    const aspectRatio2 = r.aspectRatio ?? cfg?.imageConfig?.aspectRatio;
    return {
      id: r._id ? String(r._id) : undefined,
      jobId: String(r.jobId),
      configId: String(r.configId),
      sourceConfigId: sourceIdStr || undefined,
      index: r.index,
      status: r.status,
      prompt: r.prompt || cfg?.prompt,
      error: r.error,
      url: r.url,
      mimeType: r.mimeType,
      createdAt: r.createdAt,
      appName: appName2,
      lang: lang2,
      batchFun: batchFun2,
      aspectRatio: aspectRatio2,
      referenceImages: referenceImages2,
      configMeta: appName2 || lang2 || batchFun2 || aspectRatio2 || referenceImages2
        ? {
          appName: appName2,
          lang: lang2,
          batchFun: batchFun2,
          aspectRatio: aspectRatio2,
          prompt: r.prompt || cfg?.prompt,
          referenceImages: referenceImages2,
        }
        : undefined,
    };
  });

  const filteredByMeta = items.filter((it: any) => {
    if (appName && String(it?.appName || it?.configMeta?.appName || "").trim().toLowerCase() !== appNameNorm) return false;
    if (lang && String(it?.lang || it?.configMeta?.lang || "").trim().toLowerCase() !== langNorm) return false;
    return true;
  });
  const hasMore = filteredByMeta.length === limit;
  return Response.json({ ok: true, items: filteredByMeta, hasMore, totalCount });
}

