import { addMetadataToImage, DEFAULT_IMAGE_METADATA } from "@/common/utils";
import { GoogleGenAI } from "@google/genai";
import sharp from "sharp";

const GEMINI_CONCURRENCY = 64;

function getCurrentDateTime(): { date: string; year: number } {
  const now = new Date();
  const year = now.getFullYear();
  const date = now.toISOString().slice(0, 10);
  return { date, year };
}
const NON_ADMIN_CONCURRENCY_MAX = (() => {
  const raw = String(process.env.NON_ADMIN_CONCURRENCY_MAX ?? "").trim();
  const n = raw ? Number(raw) : NaN;
  if (!Number.isFinite(n)) return 10;
  return Math.max(1, Math.floor(n));
})();

type QueuedGeminiTask = {
  run: () => Promise<unknown>;
  resolve: (value: unknown) => void;
  reject: (reason: Error) => void;
  isAdmin: boolean;
};

type GeminiQueueContext = {
  role?: string;
  isAdmin?: boolean;
};

function isAdminRole(role: unknown) {
  const r = String(role || "").trim().toLowerCase();
  return r === "admin" || r === "super" || r === "root" || r === "superadmin";
}

const pendingAdmin: QueuedGeminiTask[] = [];
const pendingOther: QueuedGeminiTask[] = [];
let runningCount = 0;
let runningAdminCount = 0;
let runningOtherCount = 0;
let drainScheduled = false;

function scheduleDrain() {
  if (drainScheduled) return;
  drainScheduled = true;
  queueMicrotask(() => {
    drainScheduled = false;
    drainGeminiQueue();
  });
}

function drainGeminiQueue() {
  while (runningCount < GEMINI_CONCURRENCY) {
    const task = (() => {
      if (pendingAdmin.length > 0) return pendingAdmin.shift();
      if (runningAdminCount > 0) return undefined;
      if (pendingOther.length > 0 && runningOtherCount < NON_ADMIN_CONCURRENCY_MAX) return pendingOther.shift();
      return undefined;
    })();
    if (!task) return;

    runningCount += 1;
    if (task.isAdmin) runningAdminCount += 1;
    else runningOtherCount += 1;

    task
      .run()
      .then((result) => {
        task.resolve(result);
      })
      .catch((err) => {
        task.reject(err instanceof Error ? err : new Error(String(err)));
      })
      .finally(() => {
        runningCount -= 1;
        if (task.isAdmin) runningAdminCount -= 1;
        else runningOtherCount -= 1;
        scheduleDrain();
      });
  }
}

/** 全局限制：同时进行中的 Gemini 生图请求数不超过 GEMINI_CONCURRENCY */
function withGeminiLimit<T>(fn: () => Promise<T>, ctx?: GeminiQueueContext): Promise<T> {
  return new Promise<T>((resolve, reject) => {
    const isAdmin = ctx?.isAdmin === true || isAdminRole(ctx?.role);
    const task: QueuedGeminiTask = {
      run: fn as () => Promise<unknown>,
      resolve: resolve as (value: unknown) => void,
      reject,
      isAdmin,
    };
    if (isAdmin) pendingAdmin.push(task);
    else pendingOther.push(task);
    scheduleDrain();
  });
}

export interface GeminiConfig {
  apiKey?: string;
  model?: string;
}

export interface GenerateImageOptions {
  responseModalities?: string[];
  imageConfig?: any;
  generationConfig?: {
    temperature?: number;
    topP?: number;
    topK?: number;
    [key: string]: any;
  };
  thinkingConfig?: {
    thinkingLevel?: string;
    includeThoughts?: boolean;
    [key: string]: any;
  };
  referenceImages?: Array<{
    data: string;
    mimeType: string;
  }>;
  contents?: any[];
}

export interface GeneratedImage {
  mimeType: string;
  data: string;
  thoughtSignature?: string;
  modelPartsForNextTurn?: any[];
}

export class GeminiClient {
  private genAI: GoogleGenAI;
  private model: string;

  constructor(config: GeminiConfig = {}) {
    const apiKey = config.apiKey || process.env.GEMINI_API_KEY;
    if (!apiKey) {
      throw new Error("Gemini API key 未配置，请设置环境变量 GEMINI_API_KEY 或在 GeminiConfig 中提供 apiKey");
    }
    this.genAI = new GoogleGenAI({ apiKey });
    //gemini-3-pro-image-preview
    this.model = config.model || "gemini-3.1-flash-image-preview";
  }

  private buildGenerateRequest(prompt: string, options: GenerateImageOptions = {}) {
    const defaultImageSize = String(process.env.GEMINI_DEFAULT_IMAGE_SIZE || "").trim() || "1K";
    const mergedImageConfig =
      options.imageConfig && typeof options.imageConfig === "object"
        ? { ...(options.imageConfig as any) }
        : undefined;
    if (mergedImageConfig && !mergedImageConfig.imageSize) {
      mergedImageConfig.imageSize = defaultImageSize;
    }

    const body: any = (() => {
      if (Array.isArray(options.contents) && options.contents.length > 0) {
        return {
          contents: options.contents,
          responseModalities: options.responseModalities || ["IMAGE"],
          ...(mergedImageConfig ? { imageConfig: mergedImageConfig } : {}),
          ...(options.generationConfig ? { generationConfig: options.generationConfig } : {}),
          tools: [{ google_search: {} }],
        };
      }

      const { date, year } = getCurrentDateTime();
      const dateContext = `[1.Context: Current date is ${date}, year ${year}. Use this when generating time-sensitive content.]\n\n[2.Generate an image]\`n\n`;
      const parts: any[] = [{ text: dateContext + prompt }];
      if (options.referenceImages && options.referenceImages.length > 0) {
        for (const refImage of options.referenceImages) {
          parts.push({
            inlineData: {
              mimeType: refImage.mimeType,
              data: refImage.data,
            },
          });
        }
      }
      return {
        contents: [
          {
            role: "user",
            parts,
          },
        ],
        responseModalities: options.responseModalities || ["IMAGE"],
        ...(mergedImageConfig ? { imageConfig: mergedImageConfig } : {}),
        ...(options.generationConfig ? { generationConfig: options.generationConfig } : {}),
        tools: [{ google_search: {} }],
      };
    })();

    const { date, year } = getCurrentDateTime();
    const systemInstruction = `For time-sensitive user queries that require up-to-date information, you MUST follow the provided current time (date and year) when formulating search queries in tool calls. Current date: ${date}. Remember it is ${year} this year.`;

    return {
      model: this.model,
      contents: body.contents,
      ...(body.tools ? { tools: body.tools } : {}),
      config: {
        systemInstruction,
        responseModalities: body.responseModalities || ["IMAGE"],
        thinkingConfig: {
          thinkingLevel: options.thinkingConfig?.thinkingLevel ?? "high",
          includeThoughts: options.thinkingConfig?.includeThoughts ?? false,
          ...(options.thinkingConfig ? options.thinkingConfig : {}),
        },
        ...(body.imageConfig ? { imageConfig: body.imageConfig } : {}),
        ...(body.generationConfig ? { generationConfig: body.generationConfig } : {}),
      },
    } as any;
  }

  private async buildGeneratedImageFromParts(
    prompt: string,
    contentParts: any[],
    skipFormatConversion?: boolean
  ): Promise<GeneratedImage> {
    if (!contentParts || !contentParts.length) {
      throw new Error("Gemini 返回结果中没有内容");
    }

    const modelPartsForNextTurn = contentParts
      .map((p: any) => {
        const sig =
          p?.thoughtSignature ||
          p?.thought_signature ||
          undefined;
        if (!sig) return null;
        const out: any = { thoughtSignature: sig };
        if (typeof p?.text === "string") out.text = p.text;
        if (p?.inlineData?.data) {
          out.inlineData = {
            mimeType: String(p.inlineData.mimeType || "image/png"),
            data: String(p.inlineData.data || "")
          };
        }
        return out;
      })
      .filter(Boolean);

    const nonThoughtImagePart = [...contentParts]
      .reverse()
      .find((p: any) => p?.inlineData?.data && p?.thought !== true);
    const anyImagePart = [...contentParts]
      .reverse()
      .find((p: any) => p?.inlineData?.data);
    const imagePart: any = nonThoughtImagePart || anyImagePart;
    if (!imagePart || !imagePart.inlineData) {
      throw new Error("Gemini 返回结果中没有图片数据 inlineData");
    }

    const debugSize = String(process.env.DEBUG_GEMINI_IMAGE_SIZE || "").toLowerCase();
    if (debugSize === "1" || debugSize === "true" || debugSize === "yes") {
      try {
        const buf = Buffer.from(imagePart.inlineData.data || "", "base64");
        const meta = await sharp(buf).metadata();
        console.log("[gemini:image]", {
          model: this.model,
          mimeType: imagePart.inlineData.mimeType || "",
          format: meta.format,
          width: meta.width,
          height: meta.height,
          sizeBytes: buf.length,
          promptChars: String(prompt || "").length,
        });
      } catch (e) {
        console.log("[gemini:image] metadata failed:", e instanceof Error ? e.message : String(e));
      }
    }

    const rawBase64 = imagePart.inlineData.data || "";
    const thoughtSignature =
      (imagePart as any)?.thoughtSignature ||
      (imagePart as any)?.thought_signature ||
      undefined;

    if (skipFormatConversion) {
      const mimeType = String(imagePart.inlineData.mimeType || "image/png").trim() || "image/png";
      return {
        mimeType,
        data: rawBase64,
        thoughtSignature,
        modelPartsForNextTurn,
      };
    }

    const rawBuffer = Buffer.from(rawBase64, "base64");
    try {
      const addMetadata = ["1", "true", "yes"].includes(String(process.env.ADD_IMAGE_METADATA || "").toLowerCase());

      let meta: any | undefined;
      try {
        meta = await sharp(rawBuffer, { failOnError: false }).metadata();
      } catch {
      }

      const isAlreadyJpeg = String(meta?.format || "").toLowerCase() === "jpeg";
      const hasAlpha = meta?.hasAlpha === true;
      const forceReencode = ["1", "true", "yes"].includes(String(process.env.GEMINI_FORCE_REENCODE_JPEG || "").toLowerCase());
      const enableSharpen = ["1", "true", "yes"].includes(String(process.env.GEMINI_JPEG_SHARPEN || "").toLowerCase());

      const qRaw = Number(String(process.env.GEMINI_JPEG_QUALITY || "").trim() || "100");
      const quality = Number.isFinite(qRaw) ? Math.max(1, Math.min(100, Math.floor(qRaw))) : 100;

      const jpgBuffer = isAlreadyJpeg && !forceReencode
        ? rawBuffer
        : await (async () => {
          let img = sharp(rawBuffer, { failOnError: false });
          if (hasAlpha) img = img.flatten({ background: { r: 255, g: 255, b: 255 } });
          if (enableSharpen) img = img.sharpen();
          return await img
            .jpeg({
              quality,
              chromaSubsampling: "4:4:4",
              optimiseCoding: true,
              optimiseScans: true,
              trellisQuantisation: true,
              overshootDeringing: true,
              mozjpeg: true,
            })
            .toBuffer();
        })();

      const imageData = addMetadata
        ? (() => {
          const jpgArrayBuffer = jpgBuffer.buffer.slice(
            jpgBuffer.byteOffset,
            jpgBuffer.byteOffset + jpgBuffer.byteLength
          ) as ArrayBuffer;
          const withMetaBuffer = addMetadataToImage(
            jpgArrayBuffer,
            "image/jpeg",
            DEFAULT_IMAGE_METADATA
          );
          return Buffer.from(withMetaBuffer).toString("base64");
        })()
        : Buffer.from(jpgBuffer).toString("base64");

      return {
        mimeType: "image/jpeg",
        data: imageData,
        thoughtSignature,
        modelPartsForNextTurn,
      };
    } catch (e) {
      throw new Error(`转为 JPG 失败: ${e instanceof Error ? e.message : String(e)}`);
    }
  }

  async generateImage(prompt: string, options: GenerateImageOptions = {}, ctx?: GeminiQueueContext): Promise<GeneratedImage> {
    const req: any = this.buildGenerateRequest(prompt, options);

    const debugReq = String(process.env.DEBUG_GEMINI_REQUEST || "").toLowerCase();
    if (debugReq === "1" || debugReq === "true" || debugReq === "yes") {
      try {
        const masked = JSON.parse(
          JSON.stringify(req, (_k, v) => {
            if (v && typeof v === "object" && typeof (v as any).inlineData?.data === "string") {
              const data = (v as any).inlineData.data as string;
              return {
                ...v,
                inlineData: {
                  ...(v as any).inlineData,
                  data: `[base64:${data.length}]`,
                },
              };
            }
            return v;
          })
        );
        console.log("[gemini:request]", masked);
      } catch (e) {
        console.log("[gemini:request] dump failed:", e instanceof Error ? e.message : String(e));
      }
    }

    return withGeminiLimit(async () => {
      const data = await this.genAI.models.generateContent(req);

      const candidates = data.candidates;
      if (!candidates || !candidates.length) {
        throw new Error("Gemini 返回结果中没有 candidates");
      }

      const contentParts = candidates[0].content?.parts || [];
      return this.buildGeneratedImageFromParts(prompt, contentParts);
    }, ctx);
  }

  async generateImageStream(
    prompt: string,
    options: GenerateImageOptions = {},
    ctx?: GeminiQueueContext
  ): Promise<GeneratedImage> {
    const req: any = this.buildGenerateRequest(prompt, options);
    return withGeminiLimit(async () => {
      const stream = await this.genAI.models.generateContentStream(req);
      const collectedParts: any[] = [];

      for await (const chunk of stream as any) {
        const parts = chunk?.candidates?.[0]?.content?.parts;
        if (!Array.isArray(parts) || parts.length === 0) continue;
        for (const p of parts) {
          collectedParts.push(p);
        }
      }

      if (!collectedParts.length) {
        throw new Error("Gemini 流式返回中没有可用内容");
      }
      return this.buildGeneratedImageFromParts(prompt, collectedParts, true);
    }, ctx);
  }
}


