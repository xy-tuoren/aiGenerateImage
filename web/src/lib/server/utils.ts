import sharp from "sharp";

export function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, Math.max(0, ms || 0)));
}

function mimeFromFormat(format: string) {
  const f = String(format || '').toLowerCase();
  if (f === 'jpeg' || f === 'jpg') return 'image/jpeg';
  if (f === 'webp') return 'image/webp';
  if (f === 'gif') return 'image/gif';
  if (f === 'tiff' || f === 'tif') return 'image/tiff';
  if (f === 'avif') return 'image/avif';
  if (f === 'heif' || f === 'heic') return 'image/heif';
  return 'image/png';
}

export function mimeFromExt(ext: string): string {
  const e = String(ext || "").toLowerCase();
  if (e === ".png") return "image/png";
  if (e === ".webp") return "image/webp";
  if (e === ".gif") return "image/gif";
  if (e === ".svg") return "image/svg+xml";
  if (e === ".bmp") return "image/bmp";
  if (e === ".tif" || e === ".tiff") return "image/tiff";
  if (e === ".jpg" || e === ".jpeg" || e === ".jfif") return "image/jpeg";
  return "image/jpeg";
}

export function extFromMime(mimeType: string): string {
  const t = (mimeType || "").toLowerCase();
  if (t.includes("png")) return "png";
  if (t.includes("webp")) return "webp";
  if (t.includes("gif")) return "gif";
  if (t.includes("bmp")) return "bmp";
  if (t.includes("tiff") || t.includes("tif")) return "tiff";
  if (t.includes("jpeg") || t.includes("jpg")) return "jpg";
  return "png";
}

export function guessMimeFromPath(p: string): string {
  const lower = (p || "").toLowerCase();
  if (lower.endsWith(".png")) return "image/png";
  if (lower.endsWith(".webp")) return "image/webp";
  if (lower.endsWith(".gif")) return "image/gif";
  if (lower.endsWith(".bmp")) return "image/bmp";
  if (lower.endsWith(".tif") || lower.endsWith(".tiff")) return "image/tiff";
  if (lower.endsWith(".jpg") || lower.endsWith(".jpeg") || lower.endsWith(".jfif")) return "image/jpeg";
  if (lower.endsWith(".svg")) return "image/svg+xml";
  return "image/jpeg";
}

export function isImageFileName(name: string) {
  const lower = String(name || "").toLowerCase();
  return (
    lower.endsWith(".png") ||
    lower.endsWith(".webp") ||
    lower.endsWith(".gif") ||
    lower.endsWith(".jpg") ||
    lower.endsWith(".jpeg") ||
    lower.endsWith(".jfif") ||
    lower.endsWith(".bmp") ||
    lower.endsWith(".tif") ||
    lower.endsWith(".tiff") ||
    lower.endsWith(".svg")
  );
}

export function chunkArray<T>(arr: T[], size: number): T[][] {
  const out: T[][] = [];
  for (let i = 0; i < arr.length; i += size) out.push(arr.slice(i, i + size));
  return out;
}

/**
 * 将同一张图缩放到目标分辨率的一半高度后，上下各拼接一次（更适合做参考图/预览图）。
 * 规则：先生成一张 targetWidth x floor(targetHeight/2) 的缩放图，然后上下各贴一次；输出画布为 targetWidth x targetHeight。
 */
export async function stitchLongImageToSize(
  input: string | ArrayBuffer | Buffer,
  targetWidth: number,
  targetHeight: number,
  options?: { background?: string; format?: 'png' | 'jpeg' | 'webp' }
): Promise<{ data: string; mimeType: string }> {
  const w = Math.max(1, Math.floor(Number(targetWidth) || 0));
  const h = Math.max(1, Math.floor(Number(targetHeight) || 0));
  if (!w || !h) throw new Error('目标宽度/高度不能为空');
  const inputBuffer = typeof input === 'string' ? Buffer.from(input, 'base64') : Buffer.isBuffer(input) ? input : Buffer.from(input);

  const bg = String(options?.background || '#ffffff');
  const fmt = (options?.format || 'png') as 'png' | 'jpeg' | 'webp';

  const halfH = Math.floor(h / 2);
  const bottomH = h - halfH;
  if (halfH <= 0 || bottomH <= 0) throw new Error(`目标高度过小，无法上下拼接: targetHeight=${h}`);

  // 目标：先把原图缩放成一张 tile（w x halfH），复制一份，再上下拼接
  // - 用 cover 填充整个区域，避免两边留白
  // - 奇数高度导致 bottomH 比 halfH 多 1px 时，用背景补齐 1px，而不是重新 resize
  const tileBuffer = await sharp(inputBuffer)
    .resize(w, halfH, { fit: 'cover', position: 'center' })
    .flatten({ background: bg })
    .toBuffer();

  const bottomHalfBuffer = bottomH === halfH
    ? tileBuffer
    : await sharp({
      create: {
        width: w,
        height: bottomH,
        channels: 3,
        background: bg,
      },
    }).composite([
      { input: tileBuffer, left: 0, top: 0 },
    ]).toBuffer();

  let out = sharp({
    create: {
      width: w,
      height: h,
      channels: 3,
      background: bg,
    },
  }).composite([
    { input: tileBuffer, left: 0, top: 0 },
    { input: bottomHalfBuffer, left: 0, top: halfH },
  ]);

  if (fmt === 'jpeg') out = out.jpeg({ quality: 95 });
  else if (fmt === 'webp') out = out.webp({ quality: 95 });
  else out = out.png();

  const finalBuffer = await out.toBuffer();
  return { data: finalBuffer.toString('base64'), mimeType: mimeFromFormat(fmt) };
}


/**
 * 根据 aspectRatio 裁剪图片到固定尺寸
 * @param input base64 字符串或 ArrayBuffer
 * @param aspectRatio 宽高比，支持 "4:5"、"1:1"、"16:9"
 * @returns Promise<string> 裁剪后的 base64 字符串，如果 aspectRatio 不匹配则返回原图
 */
export async function resizeImageByAspectRatio(
  input: string | ArrayBuffer,
  aspectRatio: string
): Promise<string> {
  const aspectRatioMap: Record<string, { width: number; height: number }> = {
    '4:5': { width: 960, height: 1200 },
    '1:1': { width: 1024, height: 1024 },
    '16:9': { width: 1200, height: 628 },
    '9:16': { width: 628, height: 1200 },
    '2:1': { width: 1200, height: 628 },
  };

  const normalizedRatio = (aspectRatio || '').trim();
  const dimensions = aspectRatioMap[normalizedRatio];

  if (!dimensions) {
    return typeof input === 'string' ? input : Buffer.from(input).toString('base64');
  }

  // 仅针对最终到 1.91:1（16:9 / 2:1）的链路：先等比对齐高度，再只拉伸宽度到目标宽度
  // 目的：不裁切角标/贴边元素，同时避免“模糊背景铺底”。
  if (normalizedRatio === '16:9' || normalizedRatio === '2:1') {
    return await resizeImageStretchWidthOnly(input, dimensions.width, dimensions.height);
  }

  return await resizeImage(input, dimensions.width, dimensions.height, { fit: 'cover' });
}

async function resizeImageStretchWidthOnly(
  input: string | ArrayBuffer,
  width: number,
  height: number
): Promise<string> {
  try {
    const inputBuffer = typeof input === 'string' ? Buffer.from(input, 'base64') : Buffer.from(input);
    const metadata = await sharp(inputBuffer).metadata();
    const outputFormat = (metadata.format || 'png') as keyof sharp.FormatEnum;

    // 1) 先按目标高度等比缩放（不改变高度，仅改变宽度）
    const stage1 = await sharp(inputBuffer)
      .resize({ height })
      .toBuffer();

    // 2) 再把宽度拉到目标宽度（高度已对齐，这一步主要影响宽度）
    const stage2 = await sharp(stage1)
      .resize(width, height, { fit: 'fill' })
      .toFormat(outputFormat)
      .toBuffer();

    return stage2.toString('base64');
  } catch (error) {
    throw new Error(`调整图片尺寸失败: ${error}`);
  }
}

/**
 * 使用 sharp 调整图片尺寸
 * @param input base64 字符串或 ArrayBuffer
 * @param width 目标宽度
 * @param height 目标高度
 * @param options 可选配置项
 * @returns Promise<string> 调整后的 base64 字符串
 */
export async function resizeImage(
  input: string | ArrayBuffer,
  width: number,
  height: number,
  options?: {
    /** 调整模式，默认 fill */
    fit?: 'cover' | 'contain' | 'fill' | 'inside' | 'outside';
    /** 输出格式，默认保持原格式 */
    format?: 'png' | 'jpeg' | 'webp' | 'gif' | 'tiff' | 'avif' | 'heif';
  }
): Promise<string> {
  try {
    let inputBuffer: Buffer;
    if (typeof input === 'string') {
      inputBuffer = Buffer.from(input, 'base64');
    } else {
      inputBuffer = Buffer.from(input);
    }

    const sharpInstance = sharp(inputBuffer);
    const metadata = await sharpInstance.metadata();
    let outputFormat: keyof sharp.FormatEnum = 'png';
    if (options?.format) {
      outputFormat = options.format as keyof sharp.FormatEnum;
    } else if (metadata.format) {
      outputFormat = metadata.format as keyof sharp.FormatEnum;
    }

    const resizedBuffer = await sharpInstance
      .resize(width, height, {
        fit: options?.fit || 'fill',
      })
      .toFormat(outputFormat)
      .toBuffer();

    return resizedBuffer.toString('base64');
  } catch (error) {
    throw new Error(`调整图片尺寸失败: ${error}`);
  }
}

/**
 * 裁图（/crop）链路中：按 appName + ratio 决定要跑哪些模板。
 *
 * - appName 不区分大小写（内部会 lower case）。
 * - 仅影响“发起裁图任务（/api/cut-jobs/start）”时生成哪些 items；已存在的 items（regenerate）不受影响。
 * - 默认配置保持现有行为不变。
 */
export const CUT_TEMPLATES_BY_APP_RATIO: Record<string, Partial<Record<string, string[]>>> = {
  "*": {
    "1:1": [
      "getCutLogoFinalPrompt",
      "getCutOtherFinalPrompt",
      "getCutScaleFinalPrompt",
      "stitchLongImage1024",
    ],
    "4:5": [
      "getCutLogoFinalPrompt",
      "getCutOtherFinalPrompt",
      "getCutScaleFinalPrompt",
      "getCutVerticalCollagePrompt",
    ],
  },
  buzz: {
    "1:1": ["getBuzzCutScaleFinalPrompt", "getBuzzCutChangeFinalPrompt"],
    "4:5": ["getBuzzCutScaleFinalPrompt", "getBuzzCutChangeFinalPrompt"],
  },
};

const uniqTrim = (arr: unknown): string[] => {
  const list = Array.isArray(arr) ? arr : [];
  const out: string[] = [];
  const seen = new Set<string>();
  for (const it of list) {
    const s = String(it || "").trim();
    if (!s || seen.has(s)) continue;
    seen.add(s);
    out.push(s);
  }
  return out;
};

export function getCutTemplatesForAppRatio(appName: unknown, ratio: unknown): string[] {
  const appKey = String(appName || "").trim().toLowerCase();
  const ratioKey = String(ratio || "").trim();

  const byApp = appKey ? CUT_TEMPLATES_BY_APP_RATIO[appKey] : undefined;
  const picked = uniqTrim(byApp?.[ratioKey]);
  if (picked.length) return picked;

  return uniqTrim(CUT_TEMPLATES_BY_APP_RATIO["*"]?.[ratioKey]);
}

/**
 * 裁图（/crop）链路中，不同 prompt 函数对应的 Gemini temperature。
 *
 * 只在服务端使用：你可以直接在这里改每个模板的 temperature。
 * 约定：范围 0~2；未配置/非法时默认 1。
 */
const clamp = (n: number, min: number, max: number) => Math.min(max, Math.max(min, n));

export const CUT_TEMPLATE_TEMPERATURE: Record<string, number> = {
  getCutLogoFinalPrompt: 1,
  getCutOtherFinalPrompt: 1,
  getCutScaleFinalPrompt: 1,
  getCutVerticalCollagePrompt: 1,
  getBuzzCutScaleFinalPrompt: 1,
  getBuzzCutChangeFinalPrompt: 1,
  // stitchLongImage1024 不走 Gemini 生图，这里无需配置
};

export const CUT_TEMPLATE_THINKING_LEVEL: Record<string, string> = {
  getCutLogoFinalPrompt: "minimal",
  getCutOtherFinalPrompt: "High",
  getCutScaleFinalPrompt: "minimal",
  getCutVerticalCollagePrompt: "minimal",
  getBuzzCutScaleFinalPrompt: "High",
  getBuzzCutChangeFinalPrompt: "High",
  // stitchLongImage1024 不走 Gemini 生图，这里无需配置
};

export function getCutTemplateTemperature(templateName: string): number {
  const key = String(templateName || "").trim();
  const raw = CUT_TEMPLATE_TEMPERATURE[key];
  const n = Number(raw);
  if (!Number.isFinite(n)) return 1;
  return clamp(n, 0, 2);
}

export function getCutTemplateThinkingLevel(templateName: string): string {
  const key = String(templateName || "").trim();
  const raw = CUT_TEMPLATE_THINKING_LEVEL[key];
  const v = String(raw || "").trim();
  return v || "High";
}
