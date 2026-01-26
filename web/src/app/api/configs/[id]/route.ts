import { NextRequest } from "next/server";
import { ObjectId } from "mongodb";
import { getMongoDb } from "@/lib/mongodb";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

type ImageConfigDoc = {
  _id?: ObjectId;
  prompt: string;
  referenceImages?: string[];
  generationConfig?: Record<string, any>;
  imageConfig?: Record<string, any>;
  responseModalities?: string[];
  count?: number;
  nextPromptFun?: string[];
  appName?: string;
  lang?: string;
  batchFun?: string;
  aspectRatio?: string;
  promptTmpFunName?: string;
  extra?: Record<string, any>;
  createdAt?: Date;
  updatedAt?: Date;
};

function toClient(doc: ImageConfigDoc) {
  const { _id, ...rest } = doc as any;
  return { id: _id ? String(_id) : undefined, ...rest };
}

export async function GET(_req: Request, ctx: { params: Promise<{ id: string }> }) {
  const { id } = await ctx.params;
  if (!id || !ObjectId.isValid(id)) {
    return Response.json({ ok: false, error: "id 非法" }, { status: 400 });
  }
  const db = await getMongoDb();
  const col = db.collection<ImageConfigDoc>("image_configs");
  const doc = await col.findOne({ _id: new ObjectId(id) });
  if (!doc) return Response.json({ ok: false, error: "配置不存在" }, { status: 404 });
  return Response.json({ ok: true, item: toClient(doc) });
}

export async function PUT(req: NextRequest, ctx: { params: Promise<{ id: string }> }) {
  const { id } = await ctx.params;
  if (!id || !ObjectId.isValid(id)) {
    return Response.json({ ok: false, error: "id 非法" }, { status: 400 });
  }

  const body = await req.json().catch(() => null);
  if (!body || typeof body !== "object") {
    return Response.json({ ok: false, error: "body 必须是 JSON 对象" }, { status: 400 });
  }

  const prompt = (body.prompt ?? "").toString().trim();
  if (!prompt) {
    return Response.json({ ok: false, error: "prompt 不能为空" }, { status: 400 });
  }

  const ref = body.referenceImages;
  const referenceImages = Array.isArray(ref)
    ? (ref as any[]).map((s) => (s ?? "").toString().trim()).filter(Boolean)
    : undefined;

  const countRaw = body.count;
  const countNum = countRaw === undefined || countRaw === null || countRaw === "" ? undefined : Number(countRaw);

  const now = new Date();
  const patch: Partial<ImageConfigDoc> = {
    prompt,
    referenceImages,
    generationConfig: body.generationConfig && typeof body.generationConfig === "object" ? body.generationConfig : undefined,
    imageConfig: body.imageConfig && typeof body.imageConfig === "object" ? body.imageConfig : undefined,
    responseModalities: Array.isArray(body.responseModalities) ? body.responseModalities : undefined,
    count: typeof countNum === "number" && !Number.isNaN(countNum) ? countNum : undefined,
    nextPromptFun: Array.isArray(body.nextPromptFun) ? body.nextPromptFun : undefined,
    appName: body.appName ? String(body.appName) : undefined,
    lang: body.lang ? String(body.lang) : undefined,
    batchFun: body.batchFun ? String(body.batchFun) : undefined,
    aspectRatio: body.aspectRatio ? String(body.aspectRatio) : undefined,
    promptTmpFunName: body.promptTmpFunName ? String(body.promptTmpFunName) : undefined,
    extra: body.extra && typeof body.extra === "object" ? body.extra : undefined,
    updatedAt: now,
  };

  const db = await getMongoDb();
  const col = db.collection<ImageConfigDoc>("image_configs");
  const _id = new ObjectId(id);
  const old = await col.findOne({ _id });
  if (!old) return Response.json({ ok: false, error: "配置不存在" }, { status: 404 });

  await col.updateOne({ _id }, { $set: patch });
  const next = await col.findOne({ _id });
  return Response.json({ ok: true, item: toClient(next as any) });
}

export async function DELETE(_req: Request, ctx: { params: Promise<{ id: string }> }) {
  const { id } = await ctx.params;
  if (!id || !ObjectId.isValid(id)) {
    return Response.json({ ok: false, error: "id 非法" }, { status: 400 });
  }
  const db = await getMongoDb();
  const col = db.collection<ImageConfigDoc>("image_configs");
  const _id = new ObjectId(id);
  const old = await col.findOne({ _id });
  if (!old) return Response.json({ ok: false, error: "配置不存在" }, { status: 404 });
  await col.deleteOne({ _id });
  return Response.json({ ok: true });
}
