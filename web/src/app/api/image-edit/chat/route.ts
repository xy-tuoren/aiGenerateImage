import { NextRequest } from "next/server";
import fs from "fs-extra";
import path from "path";
import { ObjectId } from "mongodb";
import { requireApiAccess } from "@/lib/server/auth";
import { GeminiClient } from "@/lib/server/gemini";
import { getMongoDb } from "@/lib/server/mongodb";
import { guessMimeFromPath } from "@/lib/server/utils";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

type InlineRefImage = { data: string; mimeType: string };
type HistoryMessage = {
  role: "user" | "assistant";
  text?: string;
  imageBase64?: string;
  imageMimeType?: string;
  thoughtSignature?: string;
  modelParts?: any[];
};

type ImageEditConversationDoc = {
  _id?: ObjectId;
  userId: string;
  title: string;
  lastMessage?: string;
  createdAt: Date;
  updatedAt: Date;
};

type ImageEditMessageDoc = {
  _id?: ObjectId;
  conversationId: ObjectId;
  userId: string;
  role: "user" | "assistant";
  text?: string;
  thoughtProcess?: string;
  imageBase64?: string;
  imageMimeType?: string;
  thoughtSignature?: string;
  modelParts?: any[];
  createdAt: Date;
};

async function resolvePublicDir(): Promise<string> {
  const cwd = process.cwd();
  const p1 = path.join(cwd, "public");
  const p2 = path.join(cwd, "web", "public");
  if (await fs.pathExists(p1)) return p1;
  if (await fs.pathExists(p2)) return p2;
  return p1;
}

function stripQueryHash(input: string) {
  const s = String(input || "").trim();
  if (!s) return s;
  const q = s.indexOf("?");
  const h = s.indexOf("#");
  const cut = Math.min(q >= 0 ? q : s.length, h >= 0 ? h : s.length);
  return s.slice(0, cut);
}

function isHttpUrl(input: string) {
  return /^https?:\/\//i.test(String(input || "").trim());
}

function normalizeBase64(input: unknown) {
  const s = String(input || "").trim();
  if (!s) return "";
  // if it's a data URL, strip the prefix
  const m = s.match(/^data:([^;]+);base64,(.+)$/i);
  if (m?.[2]) return m[2].trim();
  return s;
}

async function readRefFromHttp(url: string): Promise<InlineRefImage> {
  const res = await fetch(url);
  if (!res.ok) throw new Error(`下载参考图失败: ${url}, status=${res.status}`);
  const ab = await res.arrayBuffer();
  const buf = Buffer.from(ab);
  const mimeType = res.headers.get("content-type") || guessMimeFromPath(url);
  return { data: buf.toString("base64"), mimeType };
}

async function readRefFromPublicUrl(publicUrl: string, publicDir: string): Promise<InlineRefImage> {
  const raw = stripQueryHash(publicUrl);
  const pathname = raw.startsWith("/") ? raw : `/${raw}`;
  const decodedPathname = (() => {
    try {
      return decodeURIComponent(pathname);
    } catch {
      return pathname;
    }
  })();
  const rel = decodedPathname.replace(/^\/+/, "");
  const abs = path.resolve(path.join(publicDir, rel));
  const publicRoot = path.resolve(publicDir);
  if (!(abs === publicRoot || abs.startsWith(publicRoot + path.sep))) {
    throw new Error(`参考图路径不合法: ${publicUrl}`);
  }
  const exists = await fs.pathExists(abs);
  if (!exists) throw new Error(`参考图不存在: ${publicUrl}`);
  const st = await fs.stat(abs).catch(() => null);
  if (!st || !st.isFile()) throw new Error(`参考图不是文件: ${publicUrl}`);
  const buf = await fs.readFile(abs);
  return { data: buf.toString("base64"), mimeType: guessMimeFromPath(abs) };
}

async function buildReferenceImages(input: {
  referenceImageUrls?: unknown;
  referenceImageInline?: unknown;
}): Promise<InlineRefImage[]> {
  const referenceImageUrls = Array.isArray(input.referenceImageUrls)
    ? (input.referenceImageUrls as any[]).map((x) => String(x || "").trim()).filter(Boolean)
    : [];

  const inline = Array.isArray(input.referenceImageInline)
    ? (input.referenceImageInline as any[])
      .map((x) => ({
        data: normalizeBase64(x?.data),
        mimeType: String(x?.mimeType || "image/png").trim() || "image/png",
      }))
      .filter((x) => x.data)
    : [];

  // Gemini 3.1 Flash Image 单次工作流总参考图上限控制
  const MAX_TOTAL_REFS = 14;
  const MAX_URL_REFS = 14;
  const MAX_INLINE_REFS = 14;

  const publicDir = await resolvePublicDir();
  const urlRefs = referenceImageUrls.slice(0, MAX_URL_REFS);
  const urlRefImgs: InlineRefImage[] = [];
  for (const u of urlRefs) {
    if (isHttpUrl(u)) urlRefImgs.push(await readRefFromHttp(u));
    else urlRefImgs.push(await readRefFromPublicUrl(u, publicDir));
  }

  return [...urlRefImgs, ...inline.slice(0, MAX_INLINE_REFS)].slice(
    0,
    MAX_TOTAL_REFS
  );
}

function safeTrimText(input: unknown) {
  const s = String(input ?? "").trim();
  return s;
}

function normalizeHistory(input: unknown): HistoryMessage[] {
  const arr = Array.isArray(input) ? (input as any[]) : [];
  const out: HistoryMessage[] = [];
  for (const x of arr) {
    const role = String(x?.role || "").trim();
    if (role !== "user" && role !== "assistant") continue;
    out.push({
      role: role as any,
      text: x?.text != null ? safeTrimText(x.text) : undefined,
      imageBase64: x?.imageBase64 != null ? String(x.imageBase64 || "").trim() : undefined,
      imageMimeType: x?.imageMimeType != null ? String(x.imageMimeType || "").trim() : undefined,
      thoughtSignature: x?.thoughtSignature != null ? String(x.thoughtSignature || "").trim() : undefined,
      modelParts: Array.isArray(x?.modelParts) ? x.modelParts : undefined,
    });
  }
  return out;
}

function buildContentsFromHistory(args: {
  history: HistoryMessage[];
  currentPrompt: string;
  referenceImages: InlineRefImage[];
}) {
  const { history, currentPrompt, referenceImages } = args;

  // Keep it small: last 20 messages, and prefer the latest assistant model parts(signature chain)
  const tail = history.slice(Math.max(0, history.length - 20));
  const lastAssistantWithModelParts = (() => {
    for (let i = tail.length - 1; i >= 0; i -= 1) {
      const m = tail[i];
      if (
        m.role === "assistant" &&
        Array.isArray(m.modelParts) &&
        m.modelParts.length > 0
      ) {
        return m;
      }
    }
    return null;
  })();
  const lastAssistantWithImage = (() => {
    for (let i = tail.length - 1; i >= 0; i -= 1) {
      const m = tail[i];
      if (m.role === "assistant" && m.imageBase64) return m;
    }
    return null;
  })();

  const userTexts: string[] = [];
  for (const m of tail) {
    if (m.role !== "user") continue;
    const t = safeTrimText(m.text);
    if (t) userTexts.push(t);
  }
  const keptUserTexts = userTexts.slice(Math.max(0, userTexts.length - 8));

  const contents: any[] = [];
  for (const t of keptUserTexts) {
    contents.push({ role: "user", parts: [{ text: t }] });
  }

  if (lastAssistantWithModelParts?.modelParts?.length) {
    contents.push({
      role: "model",
      parts: lastAssistantWithModelParts.modelParts
    });
  } else if (lastAssistantWithImage?.imageBase64) {
    const mimeType = lastAssistantWithImage.imageMimeType || "image/png";
    const part: any = {
      inlineData: {
        mimeType,
        data: lastAssistantWithImage.imageBase64,
      },
    };
    // carry thought signature if present (Gemini3 image editing best practice)
    if (lastAssistantWithImage.thoughtSignature) {
      part.thoughtSignature = lastAssistantWithImage.thoughtSignature;
    }
    contents.push({ role: "model", parts: [part] });
  }

  // 严格模式下优先通过 role=model 回放上一轮签名 parts；当前 user 始终只表达本轮意图。
  const userParts: any[] = [{ text: currentPrompt }];
  for (const ref of referenceImages) {
    userParts.push({
      inlineData: {
        mimeType: ref.mimeType,
        data: ref.data,
      },
    });
  }
  contents.push({ role: "user", parts: userParts });

  return contents;
}

function buildConversationTitle(prompt: string) {
  const text = String(prompt || "").trim().replace(/\s+/g, " ");
  if (!text) return "新对话";
  return text.length > 28 ? `${text.slice(0, 28)}...` : text;
}

async function loadConversationHistoryFromDb(args: {
  conversationId: ObjectId;
  userId: string;
}): Promise<HistoryMessage[]> {
  const db = await getMongoDb();
  const messagesCol = db.collection<ImageEditMessageDoc>("image_edit_messages");
  const rows = await messagesCol
    .find(
      { conversationId: args.conversationId, userId: args.userId },
      { sort: { createdAt: 1 }, limit: 60 } as any
    )
    .toArray();
  return rows.map((x) => ({
    role: x.role,
    text: x.text,
    imageBase64: x.imageBase64,
    imageMimeType: x.imageMimeType,
    thoughtSignature: x.thoughtSignature,
    modelParts: Array.isArray(x.modelParts) ? x.modelParts : undefined
  }));
}

export async function GET(req: NextRequest) {
  const guard = requireApiAccess(req);
  if (!guard.ok) return Response.json({ ok: false, error: guard.error }, { status: guard.status });
  const user = guard.user;
  const { searchParams } = new URL(req.url);
  const conversationId = String(searchParams.get("conversationId") || "").trim();
  const db = await getMongoDb();
  const conversationsCol = db.collection<ImageEditConversationDoc>("image_edit_conversations");
  const messagesCol = db.collection<ImageEditMessageDoc>("image_edit_messages");

  if (conversationId) {
    if (!ObjectId.isValid(conversationId)) {
      return Response.json({ ok: false, error: "conversationId 非法" }, { status: 400 });
    }
    const convObjectId = new ObjectId(conversationId);
    const conv = await conversationsCol.findOne({
      _id: convObjectId,
      userId: user.userId
    } as any);
    if (!conv) return Response.json({ ok: false, error: "会话不存在" }, { status: 404 });
    const messages = await messagesCol
      .find(
        { conversationId: convObjectId, userId: user.userId },
        { sort: { createdAt: 1 }, limit: 200 } as any
      )
      .toArray();
    return Response.json({
      ok: true,
      conversation: {
        id: String(conv._id),
        title: conv.title || "新对话",
        lastMessage: conv.lastMessage || "",
        createdAt: conv.createdAt,
        updatedAt: conv.updatedAt
      },
      messages: messages.map((m) => ({
        id: String(m._id),
        role: m.role,
        text: m.text || "",
        thoughtProcess: m.thoughtProcess || "",
        imageBase64: m.imageBase64,
        imageMimeType: m.imageMimeType,
        thoughtSignature: m.thoughtSignature,
        modelParts: Array.isArray(m.modelParts) ? m.modelParts : undefined,
        createdAt: m.createdAt
      }))
    });
  }

  const list = await conversationsCol
    .find({ userId: user.userId } as any, { sort: { updatedAt: -1 }, limit: 100 } as any)
    .toArray();
  return Response.json({
    ok: true,
    items: list.map((x) => ({
      id: String(x._id),
      title: x.title || "新对话",
      lastMessage: x.lastMessage || "",
      createdAt: x.createdAt,
      updatedAt: x.updatedAt
    }))
  });
}

export async function POST(req: NextRequest) {
  const guard = requireApiAccess(req);
  if (!guard.ok) return Response.json({ ok: false, error: guard.error }, { status: guard.status });

  const body = await req.json().catch(() => null);
  if (!body || typeof body !== "object") {
    return Response.json({ ok: false, error: "body 必须是 JSON 对象" }, { status: 400 });
  }

  const prompt = String((body as any).prompt || "").trim();
  if (!prompt) {
    return Response.json({ ok: false, error: "prompt 不能为空" }, { status: 400 });
  }

  const user = guard.user;
  const db = await getMongoDb();
  const conversationsCol = db.collection<ImageEditConversationDoc>("image_edit_conversations");
  const messagesCol = db.collection<ImageEditMessageDoc>("image_edit_messages");
  const aspectRatio = String((body as any).aspectRatio || "").trim();
  const rawImageSize = String((body as any).imageSize || "").trim();
  const rawThinkingLevel = String((body as any).thinkingLevel || "").trim().toLowerCase();
  const thinkingLevel = rawThinkingLevel === "minimal" ? "minimal" : "high";
  const rawTemperature = Number((body as any).temperature);
  const allowedTemperatures = new Set([0.5, 1, 1.5, 2]);
  const finalTemperature = allowedTemperatures.has(rawTemperature)
    ? rawTemperature
    : 1;
  const allowedAspectRatios = new Set([
    "1:1",
    "1:4",
    "1:8",
    "2:3",
    "3:2",
    "3:4",
    "4:1",
    "4:3",
    "4:5",
    "5:4",
    "8:1",
    "9:16",
    "16:9",
    "21:9"
  ]);
  const allowedImageSizes = new Set(["512px", "1K", "2K", "4K"]);
  const finalAspectRatio = allowedAspectRatios.has(aspectRatio)
    ? aspectRatio
    : "";
  const finalImageSize = allowedImageSizes.has(rawImageSize) ? rawImageSize : "";
  const imageConfig =
    finalAspectRatio || finalImageSize
      ? {
        ...(finalAspectRatio ? { aspectRatio: finalAspectRatio } : {}),
        ...(finalImageSize ? { imageSize: finalImageSize } : {})
      }
      : undefined;
  const rawConversationId = String((body as any).conversationId || "").trim();
  let conversationId: ObjectId;

  if (rawConversationId) {
    if (!ObjectId.isValid(rawConversationId)) {
      return Response.json({ ok: false, error: "conversationId 非法" }, { status: 400 });
    }
    conversationId = new ObjectId(rawConversationId);
    const exists = await conversationsCol.findOne({
      _id: conversationId,
      userId: user.userId
    } as any);
    if (!exists) return Response.json({ ok: false, error: "会话不存在" }, { status: 404 });
  } else {
    conversationId = new ObjectId();
    const now = new Date();
    await conversationsCol.insertOne({
      _id: conversationId,
      userId: user.userId,
      title: buildConversationTitle(prompt),
      lastMessage: prompt,
      createdAt: now,
      updatedAt: now
    });
  }

  const referenceImages = await buildReferenceImages({
    referenceImageUrls: (body as any).referenceImageUrls,
    referenceImageInline: (body as any).referenceImageInline,
  });
  const dbHistory = await loadConversationHistoryFromDb({
    conversationId,
    userId: user.userId
  });
  const requestHistory = normalizeHistory((body as any).history);
  const history = dbHistory.length > 0 ? dbHistory : requestHistory;
  const useStream = Boolean((body as any).stream);

  try {
    const client = new GeminiClient({});
    const contents = buildContentsFromHistory({
      history,
      currentPrompt: prompt,
      referenceImages,
    });
    if (useStream) {
      const encoder = new TextEncoder();
      const stream = new ReadableStream({
        start(controller) {
          const push = (payload: any) => {
            controller.enqueue(
              encoder.encode(`${JSON.stringify(payload)}\n`)
            );
          };
          (async () => {
            try {
              let streamedThought = "";
              const generated = await client.generateImageStream(
                prompt,
                {
                  responseModalities: ["TEXT", "IMAGE"],
                  ...(imageConfig ? { imageConfig } : {}),
                  generationConfig: { temperature: finalTemperature },
                  thinkingConfig: { thinkingLevel },
                  contents,
                },
                { role: guard.authz?.role, isAdmin: guard.authz?.isSuperAdmin },
                (deltaText) => {
                  if (!deltaText) return;
                  streamedThought += deltaText;
                  push({ type: "thought", text: deltaText });
                }
              );

              const now = new Date();
              const finalThoughtProcess =
                String(generated.thoughtText || "").trim() ||
                String(streamedThought || "").trim() ||
                undefined;
              await messagesCol.insertMany([
                {
                  conversationId,
                  userId: user.userId,
                  role: "user",
                  text: prompt,
                  createdAt: now
                },
                {
                  conversationId,
                  userId: user.userId,
                  role: "assistant",
                  text: "",
                  thoughtProcess: finalThoughtProcess,
                  imageBase64: generated.data,
                  imageMimeType: generated.mimeType || "image/png",
                  thoughtSignature: generated.thoughtSignature || undefined,
                  modelParts: Array.isArray(generated.modelPartsForNextTurn)
                    ? generated.modelPartsForNextTurn
                    : undefined,
                  createdAt: now
                }
              ] as any);
              await conversationsCol.updateOne(
                { _id: conversationId, userId: user.userId } as any,
                {
                  $set: {
                    lastMessage: prompt,
                    updatedAt: now,
                    ...(rawConversationId ? {} : { title: buildConversationTitle(prompt) })
                  }
                } as any
              );

              push({
                type: "done",
                conversationId: String(conversationId),
                imageBase64: generated.data,
                mimeType: generated.mimeType || "image/png",
                thoughtSignature: generated.thoughtSignature || undefined,
                thoughtProcess: finalThoughtProcess || "",
                usedReferenceImages: referenceImages.length
              });
              controller.close();
            } catch (e: any) {
              const msg = e instanceof Error ? e.message : String(e);
              push({ type: "error", error: msg });
              controller.close();
            }
          })();
        }
      });
      return new Response(stream, {
        headers: {
          "Content-Type": "application/x-ndjson; charset=utf-8",
          "Cache-Control": "no-cache, no-transform",
          Connection: "keep-alive"
        }
      });
    }

    const generated = await client.generateImage(
      prompt,
      {
        responseModalities: ["TEXT", "IMAGE"],
        ...(imageConfig ? { imageConfig } : {}),
        generationConfig: { temperature: finalTemperature },
        thinkingConfig: { thinkingLevel },
        // Use multi-turn contents so Gemini can apply edits iteratively.
        contents,
      },
      { role: guard.authz?.role, isAdmin: guard.authz?.isSuperAdmin }
    );

    const now = new Date();
    await messagesCol.insertMany([
      {
        conversationId,
        userId: user.userId,
        role: "user",
        text: prompt,
        createdAt: now
      },
      {
        conversationId,
        userId: user.userId,
        role: "assistant",
        text: "",
        thoughtProcess: generated.thoughtText || undefined,
        imageBase64: generated.data,
        imageMimeType: generated.mimeType || "image/png",
        thoughtSignature: generated.thoughtSignature || undefined,
        modelParts: Array.isArray(generated.modelPartsForNextTurn)
          ? generated.modelPartsForNextTurn
          : undefined,
        createdAt: now
      }
    ] as any);
    await conversationsCol.updateOne(
      { _id: conversationId, userId: user.userId } as any,
      {
        $set: {
          lastMessage: prompt,
          updatedAt: now,
          ...(rawConversationId ? {} : { title: buildConversationTitle(prompt) })
        }
      } as any
    );

    return Response.json({
      ok: true,
      conversationId: String(conversationId),
      imageBase64: generated.data,
      mimeType: generated.mimeType || "image/png",
      thoughtSignature: generated.thoughtSignature || undefined,
      thoughtProcess: generated.thoughtText || "",
      usedReferenceImages: referenceImages.length,
    });
  } catch (e: any) {
    const msg = e instanceof Error ? e.message : String(e);
    return Response.json({ ok: false, error: msg }, { status: 500 });
  }
}

