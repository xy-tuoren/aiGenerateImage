import { getMongoDb } from "@/lib/server/mongodb";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function GET(req: Request) {
  const { searchParams } = new URL(req.url);
  const limitRaw = searchParams.get("limit");
  const limit = Math.min(500, Math.max(1, Number(limitRaw ?? 100) || 100));

  const db = await getMongoDb();
  const jobsCol = db.collection("batch_jobs");
  const docs = await jobsCol.find({}, { sort: { createdAt: -1 }, limit } as any).toArray();

  const items = docs.map((j: any) => ({
    id: String(j._id),
    status: j.status,
    total: j.total,
    done: j.done,
    error: j.error,
    createdAt: j.createdAt,
    updatedAt: j.updatedAt,
  }));

  return Response.json({ ok: true, items });
}

