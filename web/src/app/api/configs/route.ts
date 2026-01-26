import { NextRequest } from "next/server";
import { ObjectId } from "mongodb";
import { getMongoDb } from "@/lib/server/mongodb";

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
  promptTmpFunName?: string;
  extra?: Record<string, any>;
  createdAt?: Date;
  updatedAt?: Date;
};

function toClient(doc: ImageConfigDoc) {
  const { _id, ...rest } = doc as any;
  return { id: _id ? String(_id) : undefined, ...rest };
}

export async function GET() {
  const db = await getMongoDb();
  const col = db.collection<ImageConfigDoc>("image_configs");
  const docs = await col.find({}, { sort: { createdAt: -1 } }).limit(500).toArray();
  return Response.json({ ok: true, items: docs.map(toClient) });
}

export async function POST(req: NextRequest) {
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

  const now = new Date();
  const doc: ImageConfigDoc = {
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

