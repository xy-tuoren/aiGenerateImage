import { ObjectId } from "mongodb";
import { getMongoDb } from "@/lib/server/mongodb";
import { startBatchJob, startCutJob } from "@/lib/server/batchJobRunner";
import { requireApiAccess } from "@/lib/server/auth";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function POST(req: Request, ctx: { params: Promise<{ jobId: string }> }) {
  const { jobId } = await ctx.params;
  if (!jobId || !ObjectId.isValid(jobId)) {
    return Response.json({ ok: false, error: "jobId 非法" }, { status: 400 });
  }
  const guard = requireApiAccess(req);
  if (!guard.ok) return Response.json({ ok: false, error: guard.error }, { status: guard.status });
  const user = guard.user;

  const body = await req.json().catch(() => null);
  const configIdsRaw = body && typeof body === "object" ? (body as any).configIds : undefined;
  const configIds = Array.isArray(configIdsRaw) ? configIdsRaw.map((x: any) => String(x || "").trim()).filter(Boolean) : [];

  const db = await getMongoDb();
  const jobsCol = db.collection("batch_jobs");
  const jobConfigsCol = db.collection("batch_job_configs");

  const _id = new ObjectId(jobId);
  const job = await jobsCol.findOne({ _id, userId: user.userId } as any);
  if (!job) return Response.json({ ok: false, error: "job 不存在" }, { status: 404 });
  const jobType = String((job as any)?.extra?.type || "");
  if (jobType === "cut") {
    const cutItemsCol = db.collection("cut_job_items");
    const cutRecordsCol = db.collection("cut_records");
    const concurrency = Math.max(1, Number((job as any).concurrency ?? 1) || 1);

    const targetSourceUrls = configIds.length ? configIds : [];
    const filter: any = { jobId: _id, userId: user.userId, status: { $ne: "completed" } };
    if (targetSourceUrls.length) filter.sourceUrl = { $in: targetSourceUrls };

    const items = await cutItemsCol.find(filter, { projection: { _id: 1, sourceAbsPath: 1, sourceUrl: 1, ratio: 1, templateName: 1 } as any, limit: 5000 } as any).toArray();
    if (!items.length) return Response.json({ ok: true, retried: 0 });

    const now = new Date();
    await cutItemsCol.updateMany(
      { _id: { $in: items.map((x: any) => x._id) } } as any,
      {
        $set: { status: "queued", done: 0, updatedAt: now } as any,
        $unset: { error: "", outputUrl: "", outputFilePath: "", outputMimeType: "" } as any,
      } as any
    );

    for (const it of items as any[]) {
      try {
        const pathKey = `outputs.${String(it.ratio)}.${String(it.templateName)}`;
        await cutRecordsCol.updateOne(
          { sourceAbsPath: String(it.sourceAbsPath), userId: user.userId } as any,
          { $set: { status: "queued", updatedAt: now, [pathKey]: { status: "queued", updatedAt: now } } as any } as any,
          { upsert: true } as any
        );
      } catch {
      }
    }

    const completedCount = await cutItemsCol.countDocuments({ jobId: _id, userId: user.userId, status: "completed" } as any);
    await jobsCol.updateOne(
      { _id, userId: user.userId } as any,
      { $set: { status: "queued", done: completedCount, updatedAt: now }, $unset: { error: "" } as any } as any
    );

    await startCutJob({ jobId, concurrency });
    return Response.json({ ok: true, retried: items.length });
  }

  const concurrency = Math.max(1, Number((job as any).concurrency ?? 1) || 1);

  const validConfigIds = configIds.filter((id) => ObjectId.isValid(id)).map((id) => new ObjectId(id));
  const targetConfigObjectIds = validConfigIds.length
    ? validConfigIds
    : await jobConfigsCol.distinct("configId" as any, { jobId: _id, userId: user.userId, $expr: { $lt: ["$done", "$total"] } } as any);

  const targetIds = (Array.isArray(targetConfigObjectIds) ? targetConfigObjectIds : []).filter((x: any) => x && ObjectId.isValid(String(x))).map((x: any) => new ObjectId(String(x)));
  if (!targetIds.length) return Response.json({ ok: true, retried: 0 });

  const now = new Date();
  await jobsCol.updateOne({ _id, userId: user.userId } as any, { $set: { status: "queued", updatedAt: now }, $unset: { error: "" } as any } as any);
  await jobConfigsCol.updateMany(
    { jobId: _id, userId: user.userId, configId: { $in: targetIds } } as any,
    { $set: { status: "queued", updatedAt: now }, $unset: { error: "" } as any } as any
  );

  await startBatchJob({
    jobId,
    configIds: targetIds.map((x) => String(x)),
    concurrency,
    onlyMissing: true,
  });

  return Response.json({ ok: true, retried: targetIds.length });
}

