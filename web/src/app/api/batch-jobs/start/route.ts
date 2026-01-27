import { NextRequest } from "next/server";
import { ObjectId } from "mongodb";
import { getMongoDb } from "@/lib/server/mongodb";
import { startBatchJob } from "@/lib/server/batchJobRunner";
import { expandConfigByBatchFun } from "@/lib/server/batchFunExpand";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

type ImageConfigDoc = {
  _id: ObjectId;
  prompt: string;
  referenceImages?: string[];
  generationConfig?: Record<string, unknown>;
  imageConfig?: Record<string, unknown>;
  responseModalities?: string[];
  output?: string;
  count?: number;
  nextPromptFun?: string[];
  appName?: string;
  lang?: string;
  batchFun?: string;
  promptTmpFunName?: string;
  extra?: Record<string, unknown>;
};

export async function POST(req: NextRequest) {
  const body = await req.json().catch(() => null);
  if (!body || typeof body !== "object") {
    return Response.json({ ok: false, error: "body 必须是 JSON 对象" }, { status: 400 });
  }

  const configIdsRaw = (body as any).configIds;
  const configIds = Array.isArray(configIdsRaw)
    ? configIdsRaw.map((s: any) => String(s || "").trim()).filter(Boolean)
    : [];
  if (!configIds.length) {
    return Response.json({ ok: false, error: "configIds 不能为空" }, { status: 400 });
  }

  const concurrency = Math.max(1, Number((body as any).concurrency ?? 3) || 3);
  const actualCountRaw = (body as any).actualCount;
  const actualCountNum = actualCountRaw === undefined || actualCountRaw === null || actualCountRaw === "" ? undefined : Number(actualCountRaw);
  const actualCount = typeof actualCountNum === "number" && Number.isFinite(actualCountNum) ? Math.max(0, Math.floor(actualCountNum)) : undefined;

  const db = await getMongoDb();
  const configsCol = db.collection<ImageConfigDoc>("image_configs");
  const jobsCol = db.collection("batch_jobs");
  const jobConfigsCol = db.collection("batch_job_configs");

  const configObjectIds = configIds.map((id) => new ObjectId(id));
  const configs = await configsCol.find({ _id: { $in: configObjectIds } }).toArray();
  const cfgMap = new Map<string, ImageConfigDoc>(configs.map((c) => [String(c._id), c]));
  const missing = configIds.filter((id) => !cfgMap.has(id));
  if (missing.length) {
    return Response.json({ ok: false, error: `存在不存在的配置 id: ${missing.join(", ")}` }, { status: 400 });
  }

  const now = new Date();

  const expandedJobConfigs: Array<{
    configId: ObjectId;
    sourceConfigId: ObjectId;
    config: Record<string, any>;
    total: number;
  }> = [];

  for (const id of configIds) {
    const src = cfgMap.get(id);
    if (!src) continue;
    const effectiveCount = actualCount !== undefined ? actualCount : Math.max(0, Number(src.count ?? 1) || 0);

    const cfgForExpand: any = {
      prompt: src.prompt,
      referenceImages: src.referenceImages,
      generationConfig: src.generationConfig,
      imageConfig: src.imageConfig,
      responseModalities: src.responseModalities,
      output: src.output,
      count: src.count,
      nextPromptFun: src.nextPromptFun,
      appName: src.appName,
      lang: src.lang,
      batchFun: src.batchFun,
      promptTmpFunName: src.promptTmpFunName,
      extra: src.extra,
    };

    const isCombination = typeof cfgForExpand.batchFun === "string" && cfgForExpand.batchFun.startsWith("combination");
    const expanded = await expandConfigByBatchFun(cfgForExpand, { countOverride: isCombination ? effectiveCount : undefined });
    for (const e of expanded) {
      const cfgId = new ObjectId();
      const perCount = isCombination ? 1 : (actualCount !== undefined ? effectiveCount : Math.max(0, Number(e.count ?? src.count ?? 1) || 0));
      expandedJobConfigs.push({
        configId: cfgId,
        sourceConfigId: src._id,
        config: { ...e, count: perCount },
        total: perCount,
      });
    }
  }

  const total = expandedJobConfigs.reduce((sum, x) => sum + x.total, 0);

  const job = {
    status: "queued",
    concurrency,
    total,
    done: 0,
    createdAt: now,
    updatedAt: now,
  };
  const insertJob = await jobsCol.insertOne(job as any);
  const jobId = insertJob.insertedId as ObjectId;

  const jobConfigDocs = expandedJobConfigs.map((x) => ({
    jobId,
    configId: x.configId,
    sourceConfigId: x.sourceConfigId,
    config: x.config,
    status: "queued",
    total: x.total,
    done: 0,
    createdAt: now,
    updatedAt: now,
  }));
  if (jobConfigDocs.length) await jobConfigsCol.insertMany(jobConfigDocs as any[]);

  const expandedConfigIds = expandedJobConfigs.map((x) => String(x.configId));
  await startBatchJob({
    jobId: String(jobId),
    configIds: expandedConfigIds,
    concurrency,
  });

  return Response.json({ ok: true, jobId: String(jobId), total, actualCount, createdConfigs: expandedConfigIds.length });
}

