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
  generationSettings?: {
    enableImageSettings: boolean;
    outputCount: number;
    thinkingLevel: "high" | "minimal";
    temperature: 0.5 | 1 | 1.5 | 2;
    aspectRatio?: string;
    imageSize?: string;
  };
  createdAt: Date;
  updatedAt: Date;
};

type ImageEditMessageDoc = {
  _id?: ObjectId;
  conversationId: ObjectId;
  userId: string;
  role: "user" | "assistant";
  text?: string;
  loading?: boolean;
  imageBase64?: string;
  imageMimeType?: string;
  thoughtSignature?: string;
  modelParts?: any[];
  createdAt: Date;
};

type ImageEditMessageImageDoc = {
  _id?: ObjectId;
  conversationId: ObjectId;
  messageId: ObjectId;
  userId: string;
  index: number;
  imageBase64: string;
  imageMimeType: string;
  kind?: "generated" | "reference";
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
  seedModelParts?: any[];
  seedImageBase64?: string;
  seedImageMimeType?: string;
  seedThoughtSignature?: string;
}) {
  const {
    history,
    currentPrompt,
    referenceImages,
    seedModelParts,
    seedImageBase64,
    seedImageMimeType,
    seedThoughtSignature
  } = args;

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

  if (Array.isArray(seedModelParts) && seedModelParts.length > 0) {
    contents.push({ role: "model", parts: seedModelParts });
  } else if (seedImageBase64) {
    const mimeType = seedImageMimeType || "image/png";
    const part: any = {
      inlineData: {
        mimeType,
        data: seedImageBase64
      }
    };
    if (seedThoughtSignature) part.thoughtSignature = seedThoughtSignature;
    contents.push({ role: "model", parts: [part] });
  } else if (lastAssistantWithModelParts?.modelParts?.length) {
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
  const messageImagesCol = db.collection<ImageEditMessageImageDoc>("image_edit_message_images");

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

    const msgObjectIds = messages
      .map((m) => m?._id)
      .filter(Boolean) as ObjectId[];
    const imageRows = msgObjectIds.length
      ? await messageImagesCol
        .find(
          {
            conversationId: convObjectId,
            userId: user.userId,
            messageId: { $in: msgObjectIds }
          } as any,
          { sort: { messageId: 1, index: 1 } } as any
        )
        .toArray()
      : [];
    const msgIdToGeneratedImages = new Map<
      string,
      Array<{ imageBase64: string; imageMimeType: string }>
    >();
    const msgIdToReferenceImages = new Map<
      string,
      Array<{ imageBase64: string; imageMimeType: string }>
    >();
    for (const row of imageRows) {
      const k = String(row.messageId);
      const item = {
        imageBase64: String(row.imageBase64 || ""),
        imageMimeType: String(row.imageMimeType || "image/png") || "image/png"
      };
      if ((row as any)?.kind === "reference") {
        const arr = msgIdToReferenceImages.get(k) || [];
        arr.push(item);
        msgIdToReferenceImages.set(k, arr);
        continue;
      }
      const arr = msgIdToGeneratedImages.get(k) || [];
      arr.push(item);
      msgIdToGeneratedImages.set(k, arr);
    }
    return Response.json({
      ok: true,
      conversation: {
        id: String(conv._id),
        title: conv.title || "新对话",
        lastMessage: conv.lastMessage || "",
        generationSettings: conv.generationSettings || null,
        createdAt: conv.createdAt,
        updatedAt: conv.updatedAt
      },
      messages: messages.map((m) => ({
        id: String(m._id),
        role: m.role,
        text: m.text || "",
        loading: Boolean((m as any).loading),
        imageBase64: m.imageBase64,
        imageMimeType: m.imageMimeType,
        generatedImages: msgIdToGeneratedImages.get(String(m._id)) || undefined,
        referenceImages: msgIdToReferenceImages.get(String(m._id)) || undefined,
        thoughtSignature: m.thoughtSignature,
        modelParts: Array.isArray(m.modelParts) ? m.modelParts : undefined,
        createdAt: m.createdAt
      }))
    });
  }

  const list = await conversationsCol
    .find({ userId: user.userId } as any, { sort: { updatedAt: -1 }, limit: 100 } as any)
    .toArray();
  const listConversationIds = list
    .map((x) => x?._id)
    .filter(Boolean) as ObjectId[];
  const loadingRows = listConversationIds.length
    ? await messagesCol
      .aggregate([
        {
          $match: {
            userId: user.userId,
            loading: true,
            conversationId: { $in: listConversationIds }
          }
        },
        { $group: { _id: "$conversationId", count: { $sum: 1 } } }
      ] as any)
      .toArray()
    : [];
  const generatingConversationIdSet = new Set(
    loadingRows.map((x: any) => String(x?._id || ""))
  );
  return Response.json({
    ok: true,
    items: list.map((x) => ({
      id: String(x._id),
      title: x.title || "新对话",
      lastMessage: x.lastMessage || "",
      isGenerating: generatingConversationIdSet.has(String(x._id)),
      generationSettings: x.generationSettings || null,
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
  const messageImagesCol = db.collection<ImageEditMessageImageDoc>("image_edit_message_images");
  const aspectRatio = String((body as any).aspectRatio || "").trim();
  const rawImageSize = String((body as any).imageSize || "").trim();
  const rawThinkingLevel = String((body as any).thinkingLevel || "").trim().toLowerCase();
  const thinkingLevel: "high" | "minimal" =
    rawThinkingLevel === "high" ? "high" : "minimal";
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
  const rawEnableImageSettings = Boolean((body as any).enableImageSettings);
  const rawOutputCount = Number((body as any).outputCount);
  const finalOutputCount = Number.isFinite(rawOutputCount)
    ? Math.max(1, Math.min(4, Math.floor(rawOutputCount)))
    : 1;
  const generationSettings = {
    enableImageSettings: rawEnableImageSettings,
    outputCount: finalOutputCount,
    thinkingLevel,
    temperature: finalTemperature as 0.5 | 1 | 1.5 | 2,
    ...(finalAspectRatio ? { aspectRatio: finalAspectRatio } : {}),
    ...(finalImageSize ? { imageSize: finalImageSize } : {})
  };
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
      generationSettings,
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
  const targetMessageIdRaw = String((body as any).targetMessageId || "").trim();
  const targetImageIndicesRaw = Array.isArray((body as any).targetImageIndices)
    ? ((body as any).targetImageIndices as any[])
    : [];
  const targetImageIndices = Array.from(
    new Set(
      targetImageIndicesRaw
        .map((x) => Number(x))
        .filter((n) => Number.isFinite(n) && n >= 0)
        .map((n) => Math.floor(n))
    )
  ).sort((a, b) => a - b);
  let hasPersistedMessages = false;
  let hasPersistedConversationMeta = false;

  try {
    const client = new GeminiClient({});
    const resolvedSeedMessageId = await (async () => {
      if (targetMessageIdRaw && ObjectId.isValid(targetMessageIdRaw)) {
        const id = new ObjectId(targetMessageIdRaw);
        const ok = await messagesCol.findOne({
          _id: id,
          conversationId,
          userId: user.userId,
          role: "assistant"
        } as any);
        if (ok) return id;
      }
      const latestAssistantRows = await messagesCol
        .find(
          { conversationId, userId: user.userId, role: "assistant" } as any,
          { sort: { createdAt: -1 }, limit: 1 } as any
        )
        .toArray();
      return (latestAssistantRows?.[0]?._id as ObjectId | undefined) || undefined;
    })();

    const latestSeeds = resolvedSeedMessageId
      ? await messageImagesCol
        .find(
          {
            conversationId,
            userId: user.userId,
            messageId: resolvedSeedMessageId
          } as any,
          { sort: { index: 1 } } as any
        )
        .toArray()
      : [];
    const selectionMode = latestSeeds.length > 0 && targetImageIndices.length > 0;
    const baseCount =
      latestSeeds.length > 0
        ? selectionMode
          ? latestSeeds.length
          : Math.min(finalOutputCount, latestSeeds.length)
        : finalOutputCount;
    const indicesToModify = (() => {
      if (latestSeeds.length === 0) {
        return Array.from({ length: baseCount }, (_, i) => i);
      }
      if (selectionMode) {
        const maxIdx = baseCount - 1;
        return targetImageIndices.filter((i) => i <= maxIdx);
      }
      return Array.from({ length: baseCount }, (_, i) => i);
    })();

    const buildContentsForIndex = (i: number) => {
      const seed = latestSeeds[i];
      return buildContentsFromHistory({
        history,
        currentPrompt: prompt,
        referenceImages,
        seedModelParts: Array.isArray(seed?.modelParts)
          ? (seed!.modelParts as any[])
          : undefined,
        seedImageBase64: seed?.imageBase64 ? String(seed.imageBase64) : undefined,
        seedImageMimeType: seed?.imageMimeType
          ? String(seed.imageMimeType)
          : undefined,
        seedThoughtSignature: seed?.thoughtSignature
          ? String(seed.thoughtSignature)
          : undefined
      });
    };
    const generated = await client.generateImage(
      prompt,
      {
        responseModalities: ["IMAGE"],
        ...(imageConfig ? { imageConfig } : {}),
        generationConfig: { temperature: finalTemperature },
        thinkingConfig: { thinkingLevel },
        // Use multi-turn contents so Gemini can apply edits iteratively.
        contents: buildContentsForIndex(indicesToModify[0] ?? 0),
      },
      { role: guard.authz?.role, isAdmin: guard.authz?.isSuperAdmin }
    );

    const generatedAll: Array<{
      mimeType: string;
      data: string;
      text?: string;
      thoughtSignature?: string;
      modelPartsForNextTurn?: any[];
    }> = [generated as any];
    for (let j = 1; j < indicesToModify.length; j += 1) {
      const i = indicesToModify[j];
      const next = await client.generateImage(
        prompt,
        {
          responseModalities: ["IMAGE"],
          ...(imageConfig ? { imageConfig } : {}),
          generationConfig: { temperature: finalTemperature },
          thinkingConfig: { thinkingLevel },
          // Use multi-turn contents so Gemini can apply edits iteratively.
          contents: buildContentsForIndex(i),
        },
        { role: guard.authz?.role, isAdmin: guard.authz?.isSuperAdmin }
      );
      generatedAll.push(next as any);
    }
    const modifiedByIndex = new Map<number, any>();
    for (let j = 0; j < indicesToModify.length; j += 1) {
      modifiedByIndex.set(indicesToModify[j], generatedAll[j]);
    }
    const finalImages: Array<{
      imageBase64: string;
      imageMimeType: string;
      thoughtSignature?: string;
      modelParts?: any[];
    }> = [];
    for (let i = 0; i < baseCount; i += 1) {
      const mod = modifiedByIndex.get(i);
      if (mod?.data) {
        finalImages.push({
          imageBase64: String(mod.data || ""),
          imageMimeType: String(mod.mimeType || "image/png") || "image/png",
          thoughtSignature: mod.thoughtSignature || undefined,
          modelParts: Array.isArray(mod.modelPartsForNextTurn)
            ? mod.modelPartsForNextTurn
            : undefined
        });
        continue;
      }
      const seed = latestSeeds[i];
      if (selectionMode && seed?.imageBase64) {
        finalImages.push({
          imageBase64: String(seed.imageBase64 || ""),
          imageMimeType: String(seed.imageMimeType || "image/png") || "image/png",
          thoughtSignature: seed.thoughtSignature
            ? String(seed.thoughtSignature)
            : undefined,
          modelParts: Array.isArray(seed.modelParts) ? seed.modelParts : undefined
        });
        continue;
      }
    }
    const firstGenerated = finalImages[0];
    const lastModified =
      indicesToModify.length > 0
        ? modifiedByIndex.get(indicesToModify[indicesToModify.length - 1])
        : null;
    const assistantText = (() => {
      const texts = generatedAll
        .map((x: any) => (typeof x?.text === "string" ? x.text.trim() : ""))
        .filter(Boolean);
      return texts.length ? texts[texts.length - 1] : "";
    })();
    const generatedImagesForDb = finalImages
      .map((x) => ({
        imageBase64: String(x.imageBase64 || ""),
        imageMimeType: String(x.imageMimeType || "image/png") || "image/png",
        thoughtSignature: x.thoughtSignature,
        modelParts: x.modelParts
      }))
      .filter((x) => x.imageBase64);
    const now = new Date();
    const userMsgId = new ObjectId();
    const assistantMsgId = new ObjectId();
    await messagesCol.insertMany([
      {
        _id: userMsgId,
        conversationId,
        userId: user.userId,
        role: "user",
        text: prompt,
        createdAt: now
      },
      {
        _id: assistantMsgId,
        conversationId,
        userId: user.userId,
        role: "assistant",
        text: assistantText,
        imageBase64: firstGenerated?.imageBase64,
        imageMimeType: firstGenerated?.imageMimeType || "image/png",
        thoughtSignature: lastModified?.thoughtSignature || undefined,
        modelParts: Array.isArray(lastModified?.modelPartsForNextTurn)
          ? lastModified.modelPartsForNextTurn
          : undefined,
        createdAt: now
      }
    ] as any);
    hasPersistedMessages = true;
    if (referenceImages.length > 0) {
      await messageImagesCol.insertMany(
        referenceImages.map((img, idx) => ({
          conversationId,
          messageId: userMsgId,
          userId: user.userId,
          index: idx,
          imageBase64: String(img.data || ""),
          imageMimeType: String(img.mimeType || "image/png") || "image/png",
          kind: "reference" as const,
          createdAt: now
        })) as any
      );
    }
    if (generatedImagesForDb.length) {
      await messageImagesCol.insertMany(
        generatedImagesForDb.map((img, idx) => ({
          conversationId,
          messageId: assistantMsgId,
          userId: user.userId,
          index: idx,
          imageBase64: img.imageBase64,
          imageMimeType: img.imageMimeType,
          kind: "generated" as const,
          thoughtSignature: img.thoughtSignature || undefined,
          modelParts: Array.isArray(img.modelParts) ? img.modelParts : undefined,
          createdAt: now
        })) as any
      );
    }
    await conversationsCol.updateOne(
      { _id: conversationId, userId: user.userId } as any,
      {
        $set: {
          lastMessage: prompt,
          generationSettings,
          updatedAt: now,
          ...(rawConversationId ? {} : { title: buildConversationTitle(prompt) })
        }
      } as any
    );
    hasPersistedConversationMeta = true;

    return Response.json({
      ok: true,
      assistantMessageId: String(assistantMsgId),
      conversationId: String(conversationId),
      assistantText: assistantText || undefined,
      imageBase64: firstGenerated?.imageBase64,
      mimeType: firstGenerated?.imageMimeType || "image/png",
      generatedImages: generatedImagesForDb.length
        ? generatedImagesForDb
        : undefined,
      thoughtSignature: lastModified?.thoughtSignature || undefined,
      usedReferenceImages: referenceImages.length,
    });
  } catch (e: any) {
    const msg = e instanceof Error ? e.message : String(e);
    if (!hasPersistedMessages) {
      const now = new Date();
      const userMsgId = new ObjectId();
      const assistantMsgId = new ObjectId();
      try {
        await messagesCol.insertMany([
          {
            _id: userMsgId,
            conversationId,
            userId: user.userId,
            role: "user",
            text: prompt,
            createdAt: now
          },
          {
            _id: assistantMsgId,
            conversationId,
            userId: user.userId,
            role: "assistant",
            text: `生成失败：${msg}`,
            createdAt: now
          }
        ] as any);
        if (referenceImages.length > 0) {
          await messageImagesCol.insertMany(
            referenceImages.map((img, idx) => ({
              conversationId,
              messageId: userMsgId,
              userId: user.userId,
              index: idx,
              imageBase64: String(img.data || ""),
              imageMimeType: String(img.mimeType || "image/png") || "image/png",
              kind: "reference" as const,
              createdAt: now
            })) as any
          );
        }
        hasPersistedMessages = true;
      } catch { }
    }
    if (!hasPersistedConversationMeta) {
      try {
        await conversationsCol.updateOne(
          { _id: conversationId, userId: user.userId } as any,
          {
            $set: {
              lastMessage: prompt,
              generationSettings,
              updatedAt: new Date(),
              ...(rawConversationId ? {} : { title: buildConversationTitle(prompt) })
            }
          } as any
        );
      } catch { }
    }
    return Response.json({ ok: false, error: msg }, { status: 500 });
  }
}

export async function DELETE(req: NextRequest) {
  const guard = requireApiAccess(req);
  if (!guard.ok) return Response.json({ ok: false, error: guard.error }, { status: guard.status });
  const user = guard.user;
  const { searchParams } = new URL(req.url);
  const conversationId = String(searchParams.get("conversationId") || "").trim();
  if (!conversationId) {
    return Response.json({ ok: false, error: "conversationId 不能为空" }, { status: 400 });
  }
  if (!ObjectId.isValid(conversationId)) {
    return Response.json({ ok: false, error: "conversationId 非法" }, { status: 400 });
  }
  const convObjectId = new ObjectId(conversationId);
  const db = await getMongoDb();
  const conversationsCol = db.collection<ImageEditConversationDoc>("image_edit_conversations");
  const messagesCol = db.collection<ImageEditMessageDoc>("image_edit_messages");
  const messageImagesCol = db.collection<ImageEditMessageImageDoc>("image_edit_message_images");

  const exists = await conversationsCol.findOne({
    _id: convObjectId,
    userId: user.userId
  } as any);
  if (!exists) return Response.json({ ok: false, error: "会话不存在" }, { status: 404 });

  const delConv = await conversationsCol.deleteOne({
    _id: convObjectId,
    userId: user.userId
  } as any);
  const delMsg = await messagesCol.deleteMany({
    conversationId: convObjectId,
    userId: user.userId
  } as any);
  const delImgs = await messageImagesCol.deleteMany({
    conversationId: convObjectId,
    userId: user.userId
  } as any);

  return Response.json({
    ok: true,
    deletedConversationCount: delConv?.deletedCount || 0,
    deletedMessageCount: delMsg?.deletedCount || 0,
    deletedImageCount: delImgs?.deletedCount || 0
  });
}

