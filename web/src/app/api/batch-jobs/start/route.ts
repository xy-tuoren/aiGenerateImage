import { NextRequest } from "next/server";
import { ObjectId } from "mongodb";
import { getMongoDb } from "@/lib/server/mongodb";
import { startBatchJob } from "@/lib/server/batchJobRunner";
import { expandConfigByBatchFun } from "@/lib/server/batchFunExpand";
import { requireApiAccess, resolveRoleMaxGenerateCount } from "@/lib/server/auth";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const envInt = (name: string, fallback: number) => {
  const raw = String(process.env[name] ?? "").trim();
  const n = raw ? Number(raw) : NaN;
  if (!Number.isFinite(n)) return fallback;
  return Math.max(1, Math.floor(n));
};

type ImageConfigDoc = {
  _id: ObjectId;
  userId: string;
  modelProvider?: "gemini" | "jimeng";
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
  langs?: string[];
  batchFun?: string;
  promptTmpFunName?: string;
  extra?: Record<string, unknown>;
};

export async function POST(req: NextRequest) {
  const guard = requireApiAccess(req);
  if (!guard.ok) return Response.json({ ok: false, error: guard.error }, { status: guard.status });
  const user = guard.user;
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

  const nonAdminMax = envInt("NON_ADMIN_CONCURRENCY_MAX", 10);
  const inputConcurrency = (body as any).concurrency;
  const hasInputConcurrency = inputConcurrency !== undefined && inputConcurrency !== null && inputConcurrency !== "";
  const defaultConcurrency = guard.authz.isSuperAdmin ? 64 : nonAdminMax;
  const parsedConcurrency = hasInputConcurrency ? Number(inputConcurrency) : defaultConcurrency;
  const concurrencyRaw = Math.max(1, Number.isFinite(parsedConcurrency) ? Math.floor(parsedConcurrency) : defaultConcurrency);
  const concurrency = guard.authz.isSuperAdmin ? concurrencyRaw : Math.min(concurrencyRaw, nonAdminMax);
  const roleMaxGenerateCount = guard.authz.isSuperAdmin ? undefined : resolveRoleMaxGenerateCount(guard.authz.role);
  const clampByRole = (n: number) => {
    const base = Math.max(0, Math.floor(Number(n) || 0));
    if (roleMaxGenerateCount === undefined) return base;
    return Math.min(base, roleMaxGenerateCount);
  };
  const actualCountRaw = (body as any).actualCount;
  const actualCountNum = actualCountRaw === undefined || actualCountRaw === null || actualCountRaw === "" ? undefined : Number(actualCountRaw);
  const requestedActualCount = typeof actualCountNum === "number" && Number.isFinite(actualCountNum) ? Math.max(0, Math.floor(actualCountNum)) : undefined;
  const actualCount = requestedActualCount === undefined ? undefined : clampByRole(requestedActualCount);
  const cappedByRoleOnActualCount =
    requestedActualCount !== undefined &&
    roleMaxGenerateCount !== undefined &&
    requestedActualCount > roleMaxGenerateCount;

  const db = await getMongoDb();
  const configsCol = db.collection<ImageConfigDoc>("image_configs");
  const jobsCol = db.collection("batch_jobs");
  const jobConfigsCol = db.collection("batch_job_configs");

  const configObjectIds = configIds.map((id) => new ObjectId(id));
  const configs = await configsCol.find({ _id: { $in: configObjectIds }, userId: user.userId } as any).toArray();
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
    const effectiveCountRaw = actualCount !== undefined ? actualCount : Math.max(0, Number(src.count ?? 1) || 0);
    const effectiveCount = clampByRole(effectiveCountRaw);

    const srcLangs = Array.isArray((src as any).langs)
      ? (src as any).langs.map((s: any) => String(s ?? "").trim()).filter(Boolean)
      : [];
    const langList = Array.from(new Set((srcLangs.length ? srcLangs : (src.lang ? [String(src.lang).trim()] : [])).filter(Boolean)));
    const effectiveLangs = langList.length ? langList : [undefined];

    for (const lang of effectiveLangs) {
      const cfgForExpand: any = {
        modelProvider: (src as any).modelProvider,
        prompt: src.prompt,
        referenceImages: src.referenceImages,
        generationConfig: src.generationConfig,
        imageConfig: src.imageConfig,
        responseModalities: src.responseModalities,
        output: src.output,
        count: src.count,
        nextPromptFun: src.nextPromptFun,
        appName: src.appName,
        lang: lang ? String(lang) : undefined,
        batchFun: src.batchFun,
        promptTmpFunName: src.promptTmpFunName,
        extra: src.extra,
      };

      const isCombination = typeof cfgForExpand.batchFun === "string" && cfgForExpand.batchFun.startsWith("combination");
      const expanded = await expandConfigByBatchFun(cfgForExpand, { countOverride: isCombination ? effectiveCount : undefined });
      for (const e of expanded) {
        const cfgId = new ObjectId();
        const perCountRaw = isCombination
          ? 1
          : actualCount !== undefined
            ? effectiveCount
            : Math.max(0, Number(e.count ?? src.count ?? 1) || 0);
        const perCount = clampByRole(perCountRaw);
        expandedJobConfigs.push({
          configId: cfgId,
          sourceConfigId: src._id,
          // Ensure provider choice survives batchFun expansion.
          config: { ...e, modelProvider: (e as any).modelProvider ?? (src as any).modelProvider, count: perCount },
          total: perCount,
        });
      }
    }
  }

  const total = expandedJobConfigs.reduce((sum, x) => sum + x.total, 0);

  const job = {
    userId: user.userId,
    username: user.username,
    role: guard.authz.role,
    isSuperAdmin: guard.authz.isSuperAdmin,
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
    userId: user.userId,
    username: user.username,
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

  return Response.json({
    ok: true,
    jobId: String(jobId),
    total,
    actualCount,
    requestedActualCount,
    roleMaxGenerateCount,
    cappedByRoleOnActualCount,
    createdConfigs: expandedConfigIds.length,
  });
}

