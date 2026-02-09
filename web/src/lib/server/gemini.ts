import { addMetadataToImage, DEFAULT_IMAGE_METADATA } from "@/common/utils";
import { GoogleGenAI } from "@google/genai";
import sharp from "sharp";

const GEMINI_CONCURRENCY = 64;
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
  referenceImages?: Array<{
    data: string;
    mimeType: string;
  }>;
  /**
   * Advanced: provide full multi-turn contents. If set, `prompt` and `referenceImages`
   * will be ignored and we will send `contents` as-is.
   *
   * This is used for multi-turn image editing where the client carries history
   * (including thought signatures).
   */
  contents?: any[];
}

export interface GeneratedImage {
  mimeType: string;
  data: string;
  thoughtSignature?: string;
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
    this.model = config.model || "gemini-3-pro-image-preview";
  }

  async generateImage(prompt: string, options: GenerateImageOptions = {}, ctx?: GeminiQueueContext): Promise<GeneratedImage> {
    const body: any = (() => {
      if (Array.isArray(options.contents) && options.contents.length > 0) {
        return {
          contents: options.contents,
          responseModalities: options.responseModalities || ["IMAGE"],
          ...(options.imageConfig ? { imageConfig: options.imageConfig } : {}),
          ...(options.generationConfig ? { generationConfig: options.generationConfig } : {}),
          tools: [{ google_search: {} }],
        };
      }

      const parts: any[] = [{ text: prompt }];
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
        ...(options.imageConfig ? { imageConfig: options.imageConfig } : {}),
        ...(options.generationConfig ? { generationConfig: options.generationConfig } : {}),
        tools: [{ google_search: {} }],
      };
    })();

    const debugReq = String(process.env.DEBUG_GEMINI_REQUEST || "").toLowerCase();
    if (debugReq === "1" || debugReq === "true" || debugReq === "yes") {
      try {
        const req: any = { model: this.model, ...body };
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
      const data = await this.genAI.models.generateContent({
        model: this.model,
        ...body,
      });

      const candidates = data.candidates;
      if (!candidates || !candidates.length) {
        throw new Error("Gemini 返回结果中没有 candidates");
      }

      const contentParts = candidates[0].content?.parts;
      if (!contentParts || !contentParts.length) {
        throw new Error("Gemini 返回结果中没有内容");
      }

      const imagePart = contentParts.find((p: any) => p.inlineData?.data);
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

      const mimeType = imagePart.inlineData.mimeType || "";
      const rawBase64 = imagePart.inlineData.data || "";
      const addMetadata = ["1", "true", "yes"].includes(String(process.env.ADD_IMAGE_METADATA || "").toLowerCase());
      const imageData = addMetadata
        ? (() => {
            const rawBuffer = Buffer.from(rawBase64, "base64");
            const withMetaBuffer = addMetadataToImage(
              rawBuffer.buffer.slice(rawBuffer.byteOffset, rawBuffer.byteOffset + rawBuffer.byteLength),
              mimeType,
              DEFAULT_IMAGE_METADATA
            );
            return Buffer.from(withMetaBuffer).toString("base64");
          })()
        : rawBase64;

      const thoughtSignature =
        (imagePart as any)?.thoughtSignature ||
        (imagePart as any)?.thought_signature ||
        undefined;
      return {
        mimeType,
        data: imageData,
        thoughtSignature,
      };
    }, ctx);
  }
}


