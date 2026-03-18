import { NextRequest } from "next/server";
import { ObjectId } from "mongodb";
import { getMongoDb } from "@/lib/server/mongodb";
import { requireApiAccess } from "@/lib/server/auth";
import * as promptFns from "@/common/prompt";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

type PromptTemplateDoc = {
  _id?: ObjectId;
  userId: string;
  username?: string;
  name: string;
  nameKey: string;
  template: string;
  description?: string;
  createdAt?: Date;
  updatedAt?: Date;
};

function toClient(doc: PromptTemplateDoc) {
  const { _id, ...rest } = doc as any;
  return { id: _id ? String(_id) : undefined, ...rest };
}

function normalizeName(input: unknown) {
  return String(input ?? "").trim();
}

function isValidFunctionLikeName(name: string) {
  return /^[A-Za-z_][A-Za-z0-9_]*$/.test(name);
}

function getBuiltinTemplateNames() {
  return Object.keys(promptFns).filter((k) => typeof (promptFns as any)[k] === "function");
}

export async function GET(req: Request) {
  const guard = requireApiAccess(req);
  if (!guard.ok) return Response.json({ ok: false, error: guard.error }, { status: guard.status });

  const db = await getMongoDb();
  const col = db.collection<PromptTemplateDoc>("prompt_templates");
  const docs = await col.find({}, { sort: { updatedAt: -1, createdAt: -1 } }).limit(1000).toArray();
  return Response.json({ ok: true, items: docs.map(toClient) });
}

export async function POST(req: NextRequest) {
  const guard = requireApiAccess(req);
  if (!guard.ok) return Response.json({ ok: false, error: guard.error }, { status: guard.status });
  const user = guard.user;

  const body = await req.json().catch(() => null);
  if (!body || typeof body !== "object") {
    return Response.json({ ok: false, error: "body 必须是 JSON 对象" }, { status: 400 });
  }

  const name = normalizeName((body as any).name);
  if (!name) {
    return Response.json({ ok: false, error: "name 不能为空" }, { status: 400 });
  }
  if (!isValidFunctionLikeName(name)) {
    return Response.json(
      { ok: false, error: "name 必须是函数名格式（字母/数字/下划线，且不能以数字开头）" },
      { status: 400 }
    );
  }
  const builtin = getBuiltinTemplateNames();
  if (builtin.includes(name)) {
    return Response.json({ ok: false, error: "与内置提示词函数重名，请更换 name" }, { status: 400 });
  }

  const template = String((body as any).template ?? "");
  if (!template.trim()) {
    return Response.json({ ok: false, error: "template 不能为空" }, { status: 400 });
  }

  const descriptionRaw = String((body as any).description ?? "").trim();
  const description = descriptionRaw || undefined;
  const now = new Date();
  const nameKey = name.toLowerCase();

  const db = await getMongoDb();
  const col = db.collection<PromptTemplateDoc>("prompt_templates");
  const hit = await col.findOne({ nameKey });
  if (hit) {
    return Response.json({ ok: false, error: "模板函数名已存在" }, { status: 400 });
  }

  const doc: PromptTemplateDoc = {
    userId: user.userId,
    username: user.username,
    name,
    nameKey,
    template,
    description,
    createdAt: now,
    updatedAt: now
  };

  const result = await col.insertOne(doc);
  return Response.json({ ok: true, item: toClient({ ...doc, _id: result.insertedId }) });
}
