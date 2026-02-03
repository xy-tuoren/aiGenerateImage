import { getMongoDb } from "@/lib/server/mongodb";
import { getUserFromRequest } from "@/lib/server/auth";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function GET(req: Request) {
  const user = getUserFromRequest(req);
  if (!user) return Response.json({ ok: false, error: "未登录" }, { status: 401 });
  const { searchParams } = new URL(req.url);
  const limitRaw = searchParams.get("limit");
  const limit = Math.min(500, Math.max(1, Number(limitRaw ?? 100) || 100));

  const db = await getMongoDb();
  const jobsCol = db.collection("batch_jobs");
  const docs = await jobsCol.find({ userId: user.userId } as any, { sort: { createdAt: -1 }, limit } as any).toArray();

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

