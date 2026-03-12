import { NextRequest } from "next/server";
import { ObjectId } from "mongodb";
import { getMongoDb } from "@/lib/server/mongodb";
import { requireApiAccess } from "@/lib/server/auth";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

type ImageConfigDoc = {
  _id?: ObjectId;
  userId: string;
  username?: string;
  modelProvider?: "gemini" | "jimeng";
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

export async function GET(_req: Request, ctx: { params: Promise<{ id: string }> }) {
  const { id } = await ctx.params;
  if (!id || !ObjectId.isValid(id)) {
    return Response.json({ ok: false, error: "id 非法" }, { status: 400 });
  }
  const guard = requireApiAccess(_req);
  if (!guard.ok) return Response.json({ ok: false, error: guard.error }, { status: guard.status });
  const user = guard.user;
  const db = await getMongoDb();
  const col = db.collection<ImageConfigDoc>("image_configs");
  const doc = await col.findOne({ _id: new ObjectId(id), userId: user.userId });
  if (!doc) return Response.json({ ok: false, error: "配置不存在" }, { status: 404 });
  return Response.json({ ok: true, item: toClient(doc) });
}

export async function PUT(req: NextRequest, ctx: { params: Promise<{ id: string }> }) {
  const { id } = await ctx.params;
  if (!id || !ObjectId.isValid(id)) {
    return Response.json({ ok: false, error: "id 非法" }, { status: 400 });
  }
  const guard = requireApiAccess(req);
  if (!guard.ok) return Response.json({ ok: false, error: guard.error }, { status: guard.status });
  const user = guard.user;

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
  const modelProviderRaw = String((body as any).modelProvider || "").trim().toLowerCase();
  const modelProvider = modelProviderRaw === "jimeng" ? "jimeng" : "gemini";

  const now = new Date();
  const patch: Partial<ImageConfigDoc> = {
    modelProvider,
    prompt,
    referenceImages,
    generationConfig: normalizeGenerationConfig(body.generationConfig),
    imageConfig: body.imageConfig && typeof body.imageConfig === "object" ? body.imageConfig : undefined,
    responseModalities: Array.isArray(body.responseModalities) ? body.responseModalities : undefined,
    count: typeof countNum === "number" && !Number.isNaN(countNum) ? countNum : undefined,
    nextPromptFun: Array.isArray(body.nextPromptFun) ? body.nextPromptFun : undefined,
    appName: body.appName ? String(body.appName) : undefined,
    lang,
    langs: langs.length ? langs : undefined,
    batchFun: body.batchFun ? String(body.batchFun) : undefined,
    promptTmpFunName: body.promptTmpFunName ? String(body.promptTmpFunName) : undefined,
    extra: body.extra && typeof body.extra === "object" ? body.extra : undefined,
    updatedAt: now,
  };

  const db = await getMongoDb();
  const col = db.collection<ImageConfigDoc>("image_configs");
  const _id = new ObjectId(id);
  const old = await col.findOne({ _id, userId: user.userId });
  if (!old) return Response.json({ ok: false, error: "配置不存在" }, { status: 404 });

  await col.updateOne({ _id, userId: user.userId }, { $set: patch });
  const next = await col.findOne({ _id, userId: user.userId });
  return Response.json({ ok: true, item: toClient(next as any) });
}

export async function DELETE(_req: Request, ctx: { params: Promise<{ id: string }> }) {
  const { id } = await ctx.params;
  if (!id || !ObjectId.isValid(id)) {
    return Response.json({ ok: false, error: "id 非法" }, { status: 400 });
  }
  const guard = requireApiAccess(_req);
  if (!guard.ok) return Response.json({ ok: false, error: guard.error }, { status: guard.status });
  const user = guard.user;
  const db = await getMongoDb();
  const col = db.collection<ImageConfigDoc>("image_configs");
  const _id = new ObjectId(id);
  const old = await col.findOne({ _id, userId: user.userId });
  if (!old) return Response.json({ ok: false, error: "配置不存在" }, { status: 404 });
  await col.deleteOne({ _id, userId: user.userId });
  return Response.json({ ok: true });
}
