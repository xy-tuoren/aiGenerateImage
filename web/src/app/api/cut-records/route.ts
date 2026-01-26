import { ObjectId } from "mongodb";
import { getMongoDb } from "@/lib/server/mongodb";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

type CutJobItemDoc = {
  _id?: ObjectId;
  jobId: ObjectId;
  sourceUrl: string;
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

export async function GET(req: Request) {
  const { searchParams } = new URL(req.url);
  const limitRaw = searchParams.get("limit");
  const limit = Math.min(5000, Math.max(1, Number(limitRaw ?? 200) || 200));
  const status = (searchParams.get("status") || "").trim();
  const appName = (searchParams.get("appName") || "").trim();
  const lang = (searchParams.get("lang") || "").trim();
  const ratio = (searchParams.get("ratio") || "").trim();
  const jobId = (searchParams.get("jobId") || "").trim();

  const filter: any = {};
  if (status) {
    if (status !== "queued" && status !== "running" && status !== "completed" && status !== "failed") {
      return Response.json({ ok: false, error: "status 非法" }, { status: 400 });
    }
    filter.status = status;
  }
  if (appName) filter.appName = appName;
  if (lang) filter.lang = lang;
  if (ratio) filter.ratio = ratio;
  if (jobId) {
    if (!ObjectId.isValid(jobId)) return Response.json({ ok: false, error: "jobId 非法" }, { status: 400 });
    filter.jobId = new ObjectId(jobId);
  }

  const db = await getMongoDb();
  const col = db.collection<CutJobItemDoc>("cut_job_items");
  const docs = await col.find(filter, { sort: { createdAt: -1 }, limit } as any).toArray();

  const items = docs.map((d: any) => ({
    id: String(d._id),
    jobId: String(d.jobId),
    sourceUrl: d.sourceUrl,
    outputUrl: d.outputUrl,
    outputMimeType: d.outputMimeType,
    appName: d.appName,
    lang: d.lang,
    ratio: d.ratio,
    templateName: d.templateName,
    status: d.status,
    total: d.total,
    done: d.done,
    error: d.error,
    createdAt: d.createdAt,
    updatedAt: d.updatedAt,
  }));

  return Response.json({ ok: true, items });
}

