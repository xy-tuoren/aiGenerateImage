import { getMongoDb } from "@/lib/server/mongodb";
import { getUserFromRequest } from "@/lib/server/auth";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

type CutRecordDoc = {
  sourceUrl: string;
};

export async function POST(req: Request) {
  const user = getUserFromRequest(req);
  if (!user) return Response.json({ ok: false, error: "未登录" }, { status: 401 });
  const body = await req.json().catch(() => null);
  if (!body || typeof body !== "object") return Response.json({ ok: false, error: "body 必须是 JSON 对象" }, { status: 400 });
  const urlsRaw = (body as any).urls;
  const urls = Array.isArray(urlsRaw) ? urlsRaw.map((x) => String(x || "").trim()).filter(Boolean) : [];
  if (!urls.length) return Response.json({ ok: false, error: "urls 不能为空" }, { status: 400 });
  const uniq = Array.from(new Set(urls));

  const db = await getMongoDb();
  const col = db.collection<CutRecordDoc>("cut_records");
  const docs = await col.find({ userId: user.userId, sourceUrl: { $in: uniq } } as any, { projection: { sourceUrl: 1 } }).toArray();
  const cutUrls = docs.map((d: any) => String(d.sourceUrl || "")).filter(Boolean);

  const fireplayCol = db.collection<{ sourceUrl: string }>("fireplay_upload_records");
  const fireplayDocs = await fireplayCol.find({ userId: user.userId, sourceUrl: { $in: uniq } } as any, { projection: { sourceUrl: 1 } }).toArray();
  const fireplayUploadedUrls = fireplayDocs.map((d: any) => String(d.sourceUrl || "")).filter(Boolean);

  return Response.json({ ok: true, cutUrls, fireplayUploadedUrls });
}

