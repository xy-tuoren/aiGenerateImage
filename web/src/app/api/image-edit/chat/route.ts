import { NextRequest } from "next/server";
import fs from "fs-extra";
import path from "path";
import { requireApiAccess } from "@/lib/server/auth";
import { GeminiClient } from "@/lib/server/gemini";
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

  // basic safety caps (avoid accidentally sending too many / huge refs)
  const MAX_URL_REFS = 12;
  const MAX_INLINE_REFS = 12;

  const publicDir = await resolvePublicDir();
  const urlRefs = referenceImageUrls.slice(0, MAX_URL_REFS);
  const urlRefImgs: InlineRefImage[] = [];
  for (const u of urlRefs) {
    if (isHttpUrl(u)) urlRefImgs.push(await readRefFromHttp(u));
    else urlRefImgs.push(await readRefFromPublicUrl(u, publicDir));
  }

  return [...urlRefImgs, ...inline.slice(0, MAX_INLINE_REFS)];
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

  // Keep it small: last 20 messages, but only keep the *latest* assistant image
  const tail = history.slice(Math.max(0, history.length - 20));
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

  if (lastAssistantWithImage?.imageBase64) {
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

  const aspectRatio = String((body as any).aspectRatio || "").trim();
  const referenceImages = await buildReferenceImages({
    referenceImageUrls: (body as any).referenceImageUrls,
    referenceImageInline: (body as any).referenceImageInline,
  });
  const history = normalizeHistory((body as any).history);

  try {
    const client = new GeminiClient({});
    const contents = buildContentsFromHistory({
      history,
      currentPrompt: prompt,
      referenceImages,
    });
    const generated = await client.generateImage(
      prompt,
      {
        responseModalities: ["IMAGE"],
        imageConfig: aspectRatio ? { aspectRatio, imageSize: "1K" } : { imageSize: "1K" },
        // Use multi-turn contents so Gemini can apply edits iteratively.
        contents,
      },
      { role: guard.authz?.role, isAdmin: guard.authz?.isSuperAdmin }
    );

    return Response.json({
      ok: true,
      imageBase64: generated.data,
      mimeType: generated.mimeType || "image/png",
      thoughtSignature: generated.thoughtSignature || undefined,
      usedReferenceImages: referenceImages.length,
    });
  } catch (e: any) {
    const msg = e instanceof Error ? e.message : String(e);
    return Response.json({ ok: false, error: msg }, { status: 500 });
  }
}

