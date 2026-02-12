import { getMongoDb } from "@/lib/server/mongodb";
import { requireApiAccess, resolveGalleryGroupUserIds } from "@/lib/server/auth";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

type DownloadRecordDoc = {
  userId: string;
  sourceUrl: string;
  updatedAt: Date;
};

type GenerationRecordDoc = {
  userId: string;
  url?: string;
  status?: string;
};

export async function POST(req: Request) {
  const guard = requireApiAccess(req);
  if (!guard.ok) return Response.json({ ok: false, error: guard.error }, { status: guard.status });
  const user = guard.user;
  const galleryUserIds = resolveGalleryGroupUserIds(user.username);
  const body = await req.json().catch(() => null);
  if (!body || typeof body !== "object") return Response.json({ ok: false, error: "body 必须是 JSON 对象" }, { status: 400 });
  const urlsRaw = (body as any).urls;
  const urls = Array.isArray(urlsRaw) ? urlsRaw.map((x: any) => String(x || "").trim()).filter(Boolean) : [];
  if (!urls.length) return Response.json({ ok: false, error: "urls 不能为空" }, { status: 400 });
  const uniq = Array.from(new Set(urls));

  const db = await getMongoDb();
  const genCol = db.collection<GenerationRecordDoc>("generation_records");
  const docs = await genCol.find({ userId: galleryUserIds.length ? { $in: galleryUserIds } : user.userId, status: "completed", url: { $in: uniq } } as any, { projection: { url: 1 } }).toArray();
  const allowed = new Set(docs.map((d: any) => String(d?.url || "").trim()).filter(Boolean));
  const allowedUrls = uniq.filter((u) => allowed.has(u));
  if (!allowedUrls.length) return Response.json({ ok: false, error: "无权限标记" }, { status: 403 });

  const col = db.collection<DownloadRecordDoc>("download_records");
  const now = new Date();
  const ops = allowedUrls.map((url) => ({
    updateOne: {
      filter: { userId: user.userId, sourceUrl: url } as any,
      update: {
        $set: { userId: user.userId, sourceUrl: url, updatedAt: now } as any,
      },
      upsert: true,
    },
  }));
  if (ops.length) await col.bulkWrite(ops as any[], { ordered: false } as any);

  return Response.json({ ok: true, marked: allowedUrls.length });
}
