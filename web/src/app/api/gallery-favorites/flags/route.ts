import { getMongoDb } from "@/lib/server/mongodb";
import { requireApiAccess } from "@/lib/server/auth";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

type FavoriteDoc = {
  userId: string;
  url: string;
  createdAt: Date;
};

function normalizeUrl(input: string) {
  const raw = String(input || "").trim();
  if (!raw) return "";
  if (!raw.startsWith("/material/")) return raw;
  const qPos = raw.indexOf("?");
  const base = qPos >= 0 ? raw.slice(0, qPos) : raw;
  const query = qPos >= 0 ? raw.slice(qPos) : "";
  const segs = base.split("/").map((seg, idx) => {
    if (idx <= 1) return seg;
    try {
      return encodeURIComponent(decodeURIComponent(seg));
    } catch {
      return encodeURIComponent(seg);
    }
  });
  return `${segs.join("/")}${query}`;
}

export async function POST(req: Request) {
  const guard = requireApiAccess(req);
  if (!guard.ok)
    return Response.json({ ok: false, error: guard.error }, { status: guard.status });
  const user = guard.user;

  const body = await req.json().catch(() => null);
  if (!body || typeof body !== "object")
    return Response.json({ ok: false, error: "body 必须是 JSON 对象" }, { status: 400 });

  const urlsRaw = (body as any).urls;
  const urls = Array.isArray(urlsRaw)
    ? urlsRaw.map((x) => normalizeUrl(String(x || ""))).filter(Boolean)
    : [];
  if (!urls.length)
    return Response.json({ ok: false, error: "urls 不能为空" }, { status: 400 });

  const uniq = Array.from(new Set(urls));
  const db = await getMongoDb();
  const col = db.collection<FavoriteDoc>("gallery_favorites");
  const docs = await col
    .find({ userId: user.userId, url: { $in: uniq } } as any, {
      projection: { url: 1 } as any
    })
    .toArray();
  const favoriteUrls = docs.map((d: any) => String(d?.url || "")).filter(Boolean);
  return Response.json({ ok: true, favoriteUrls });
}

