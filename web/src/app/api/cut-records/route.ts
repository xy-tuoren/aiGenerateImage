import { ObjectId } from "mongodb";
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
  jobId?: ObjectId;
  sourceUrl: string;
  sourceAbsPath: string;
  appName?: string;
  lang?: string;
  status?: "queued" | "running" | "completed" | "failed";
  outputs?: Record<string, Record<string, CutRecordOutputItem>>;
  createdAt: Date;
  updatedAt: Date;
};

function deriveStatus(outputs: CutRecordDoc["outputs"]): "queued" | "running" | "completed" | "failed" {
  const o = outputs && typeof outputs === "object" ? outputs : undefined;
  if (!o) return "queued";
  let hasQueued = false;
  let hasRunning = false;
  let hasCompleted = false;
  for (const ratioKey of Object.keys(o)) {
    const byTpl = o[ratioKey];
    if (!byTpl || typeof byTpl !== "object") continue;
    for (const tplKey of Object.keys(byTpl)) {
      const it = byTpl[tplKey];
      const s = it?.status;
      if (s === "failed") return "failed";
      if (s === "running") hasRunning = true;
      else if (s === "queued") hasQueued = true;
      else if (s === "completed") hasCompleted = true;
    }
  }
  if (hasRunning) return "running";
  if (hasQueued) return "queued";
  if (hasCompleted) return "completed";
  return "queued";
}

export async function GET(req: Request) {
  const { searchParams } = new URL(req.url);
  const limitRaw = searchParams.get("limit");
  const limit = Math.min(5000, Math.max(1, Number(limitRaw ?? 200) || 200));
  const status = (searchParams.get("status") || "").trim();
  const appName = (searchParams.get("appName") || "").trim();
  const lang = (searchParams.get("lang") || "").trim();
  const jobId = (searchParams.get("jobId") || "").trim();

  const filter: any = {};
  if (status) {
    if (status !== "queued" && status !== "running" && status !== "completed" && status !== "failed") {
      return Response.json({ ok: false, error: "status 非法" }, { status: 400 });
    }
  }
  if (appName) filter.appName = appName;
  if (lang) filter.lang = lang;
  if (jobId) {
    if (!ObjectId.isValid(jobId)) return Response.json({ ok: false, error: "jobId 非法" }, { status: 400 });
    filter.jobId = new ObjectId(jobId);
  }

  const db = await getMongoDb();
  const col = db.collection<CutRecordDoc>("cut_records");
  const docs = await col.find(filter, { sort: { updatedAt: -1 }, limit } as any).toArray();

  const items = docs.map((d: any) => {
    const derived = d.outputs ? deriveStatus(d.outputs) : (d.status || "queued");
    return {
      id: String(d._id),
      jobId: d.jobId ? String(d.jobId) : undefined,
      sourceUrl: d.sourceUrl,
      sourceAbsPath: d.sourceAbsPath,
      appName: d.appName,
      lang: d.lang,
      status: derived,
      outputs: d.outputs,
      createdAt: d.createdAt,
      updatedAt: d.updatedAt,
    };
  }).filter((it: any) => (status ? String(it.status) === status : true));

  return Response.json({ ok: true, items });
}

