import { NextRequest } from "next/server";
import { ObjectId } from "mongodb";
import { getMongoDb } from "@/lib/server/mongodb";
import { requireApiAccess } from "@/lib/server/auth";

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

export async function PUT(req: NextRequest, ctx: { params: Promise<{ id: string }> }) {
  const { id } = await ctx.params;
  if (!id || !ObjectId.isValid(id)) {
    return Response.json({ ok: false, error: "id 非法" }, { status: 400 });
  }

  const guard = requireApiAccess(req);
  if (!guard.ok) return Response.json({ ok: false, error: guard.error }, { status: guard.status });
  const user = guard.user;
  const authz = guard.authz;

  const body = await req.json().catch(() => null);
  if (!body || typeof body !== "object") {
    return Response.json({ ok: false, error: "body 必须是 JSON 对象" }, { status: 400 });
  }

  const template = String((body as any).template ?? "");
  if (!template.trim()) {
    return Response.json({ ok: false, error: "template 不能为空" }, { status: 400 });
  }
  const descriptionRaw = String((body as any).description ?? "").trim();
  const description = descriptionRaw || undefined;

  const db = await getMongoDb();
  const col = db.collection<PromptTemplateDoc>("prompt_templates");
  const _id = new ObjectId(id);
  const old = await col.findOne({ _id });
  if (!old) return Response.json({ ok: false, error: "模板不存在" }, { status: 404 });
  if (
    !authz.isSuperAdmin &&
    String(old.userId || "").trim() !== String(user.userId || "").trim()
  ) {
    return Response.json(
      { ok: false, error: "仅管理员或模板创建者可修改" },
      { status: 403 }
    );
  }

  await col.updateOne(
    { _id },
    {
      $set: {
        template,
        description,
        updatedAt: new Date()
      }
    }
  );
  const next = await col.findOne({ _id });
  return Response.json({ ok: true, item: toClient(next as any) });
}

export async function DELETE(req: Request, ctx: { params: Promise<{ id: string }> }) {
  const { id } = await ctx.params;
  if (!id || !ObjectId.isValid(id)) {
    return Response.json({ ok: false, error: "id 非法" }, { status: 400 });
  }

  const guard = requireApiAccess(req);
  if (!guard.ok) return Response.json({ ok: false, error: guard.error }, { status: guard.status });
  const user = guard.user;
  const authz = guard.authz;

  const db = await getMongoDb();
  const col = db.collection<PromptTemplateDoc>("prompt_templates");
  const _id = new ObjectId(id);
  const old = await col.findOne({ _id });
  if (!old) return Response.json({ ok: false, error: "模板不存在" }, { status: 404 });
  if (!authz.isSuperAdmin && String(old.userId || "").trim() !== String(user.userId || "").trim()) {
    return Response.json(
      { ok: false, error: "仅管理员或模板创建者可删除" },
      { status: 403 }
    );
  }
  await col.deleteOne({ _id });
  return Response.json({ ok: true });
}
