import { NextRequest } from "next/server";
import { ObjectId } from "mongodb";
import { getMongoDb } from "@/lib/server/mongodb";
import { startBatchJob } from "@/lib/server/batchJobRunner";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

type ImageConfigDoc = {
  _id: ObjectId;
  count?: number;
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

  const totals = configIds.map((id) => {
    const cfg = cfgMap.get(id);
    const count = actualCount !== undefined ? actualCount : Math.max(0, Number(cfg?.count ?? 1) || 0);
    return { id, count };
  });
  const total = totals.reduce((sum, x) => sum + x.count, 0);

  const now = new Date();
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

  const jobConfigDocs = totals.map((x) => ({
    jobId,
    configId: new ObjectId(x.id),
    status: "queued",
    total: x.count,
    done: 0,
    createdAt: now,
    updatedAt: now,
  }));
  if (jobConfigDocs.length) await jobConfigsCol.insertMany(jobConfigDocs as any[]);

  const countOverrideMap = actualCount !== undefined ? Object.fromEntries(totals.map((x) => [x.id, x.count])) : undefined;
  await startBatchJob({
    jobId: String(jobId),
    configIds,
    concurrency,
    countOverrideMap,
  });

  return Response.json({ ok: true, jobId: String(jobId), total, actualCount });
}

