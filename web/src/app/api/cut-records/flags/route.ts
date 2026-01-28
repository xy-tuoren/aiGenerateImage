import { getMongoDb } from "@/lib/server/mongodb";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

type CutRecordDoc = {
  sourceUrl: string;
};

export async function POST(req: Request) {
  const body = await req.json().catch(() => null);
  if (!body || typeof body !== "object") return Response.json({ ok: false, error: "body 必须是 JSON 对象" }, { status: 400 });
  const urlsRaw = (body as any).urls;
  const urls = Array.isArray(urlsRaw) ? urlsRaw.map((x) => String(x || "").trim()).filter(Boolean) : [];
  if (!urls.length) return Response.json({ ok: false, error: "urls 不能为空" }, { status: 400 });
  const uniq = Array.from(new Set(urls));

  const db = await getMongoDb();
  const col = db.collection<CutRecordDoc>("cut_records");
  const docs = await col.find({ sourceUrl: { $in: uniq } }, { projection: { sourceUrl: 1 } }).toArray();
  const cutUrls = docs.map((d: any) => String(d.sourceUrl || "")).filter(Boolean);
  return Response.json({ ok: true, cutUrls });
}

