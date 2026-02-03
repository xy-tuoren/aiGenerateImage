import { NextRequest } from "next/server";
import { ObjectId } from "mongodb";
import { getMongoDb } from "@/lib/server/mongodb";
import { getUserFromRequest } from "@/lib/server/auth";

type ImageConfigDoc = {
  _id?: ObjectId;
  userId: string;
  username?: string;
  prompt: string;
  referenceImages?: string[];
  generationConfig?: Record<string, any>;
  imageConfig?: Record<string, any>;
  responseModalities?: string[];
  count?: number;
  nextPromptFun?: string[];
  appName?: string;
  lang?: string;
  langs?: string[];
  batchFun?: string;
  promptTmpFunName?: string;
  extra?: Record<string, any>;
  createdAt?: Date;
  updatedAt?: Date;
};

function normalizeGenerationConfig(input: any) {
  const g = input && typeof input === "object" ? { ...input } : undefined;
  if (!g) return { temperature: 1 };
  const t = g.temperature;
  const n = t === undefined || t === null || t === "" ? undefined : Number(t);
  g.temperature = typeof n === "number" && Number.isFinite(n) ? n : 1;
  return g;
}

function toClient(doc: ImageConfigDoc) {
  const { _id, ...rest } = doc as any;
  return { id: _id ? String(_id) : undefined, ...rest };
}

export async function GET(req: Request) {
  const user = getUserFromRequest(req);
  if (!user) return Response.json({ ok: false, error: "未登录" }, { status: 401 });
  const db = await getMongoDb();
  const col = db.collection<ImageConfigDoc>("image_configs");
  const docs = await col.find({ userId: user.userId }, { sort: { updatedAt: -1, createdAt: -1 } }).limit(500).toArray();
  return Response.json({ ok: true, items: docs.map(toClient) });
}

export async function POST(req: NextRequest) {
  const user = getUserFromRequest(req);
  if (!user) return Response.json({ ok: false, error: "未登录" }, { status: 401 });
  const body = await req.json().catch(() => null);
  if (!body || typeof body !== "object") {
    return Response.json({ ok: false, error: "body 必须是 JSON 对象" }, { status: 400 });
  }

  const prompt = (body.prompt ?? "").toString().trim();

  const ref = body.referenceImages;
  const referenceImages = Array.isArray(ref)
    ? (ref as any[]).map((s) => (s ?? "").toString().trim()).filter(Boolean)
    : undefined;

  const countRaw = body.count;
  const countNum = countRaw === undefined || countRaw === null || countRaw === "" ? undefined : Number(countRaw);

  const lang0 = body.lang ? String(body.lang).trim() : "";
  const langsRaw = (body as any).langs;
  const langs0 = Array.isArray(langsRaw)
    ? langsRaw.map((s: any) => String(s ?? "").trim()).filter(Boolean)
    : [];
  const langs = Array.from(new Set((langs0.length ? langs0 : (lang0 ? [lang0] : [])).filter(Boolean)));
  const lang = langs.length ? langs[0] : (lang0 || undefined);

  const inputImageConfig = body.imageConfig && typeof body.imageConfig === "object" ? body.imageConfig : undefined;
  const aspectRatioRaw = inputImageConfig ? (inputImageConfig as any).aspectRatio : undefined;
  const aspectRatio = (aspectRatioRaw ?? "").toString().trim() || "2:1";

  const now = new Date();
  const doc: ImageConfigDoc = {
    userId: user.userId,
    username: user.username,
    prompt,
    referenceImages,
    generationConfig: normalizeGenerationConfig(body.generationConfig),
    imageConfig: inputImageConfig ? { ...(inputImageConfig as any), aspectRatio } : { aspectRatio },
    responseModalities: Array.isArray(body.responseModalities) ? body.responseModalities : undefined,
    count: typeof countNum === "number" && !Number.isNaN(countNum) ? countNum : undefined,
    nextPromptFun: Array.isArray(body.nextPromptFun) ? body.nextPromptFun : undefined,
    appName: body.appName ? String(body.appName) : undefined,
    lang,
    langs: langs.length ? langs : undefined,
    batchFun: body.batchFun ? String(body.batchFun) : undefined,
    promptTmpFunName: body.promptTmpFunName ? String(body.promptTmpFunName) : undefined,
    extra: body.extra && typeof body.extra === "object" ? body.extra : undefined,
    createdAt: now,
    updatedAt: now,
  };

  const db = await getMongoDb();
  const col = db.collection<ImageConfigDoc>("image_configs");
  const result = await col.insertOne(doc);
  return Response.json({ ok: true, item: { ...toClient({ ...doc, _id: result.insertedId }) } });
}

