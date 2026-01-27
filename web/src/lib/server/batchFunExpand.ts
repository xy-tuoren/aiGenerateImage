import * as fs from "fs-extra";
import sharp from "sharp";
import { join } from "path";

export type WebImageConfig = {
  prompt: string;
  referenceImages?: string[];
  generationConfig?: Record<string, unknown>;
  imageConfig?: Record<string, any>;
  responseModalities?: string[];
  output?: string;
  count?: number;
  nextPromptFun?: string[];
  appName?: string;
  lang?: string;
  batchFun?: string;
  promptTmpFunName?: string;
  extra?: Record<string, unknown>;
};

function isImageFileName(name: string) {
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
    lower.endsWith(".tiff")
  );
}

async function collectImagesFromDirRecursive(dir: string): Promise<string[]> {
  const root = String(dir || "").trim();
  if (!root) return [];
  const st = await fs.stat(root).catch(() => null);
  if (!st) throw new Error(`参考图不存在: ${root}`);
  if (!st.isDirectory()) throw new Error(`参考图不是目录: ${root}`);

  const results: string[] = [];
  const walk = async (d: string) => {
    const names = await fs.readdir(d).catch(() => []);
    const sorted = [...names].sort();
    for (const name of sorted) {
      const abs = join(d, name);
      const s = await fs.stat(abs).catch(() => null);
      if (!s) continue;
      if (s.isDirectory()) {
        await walk(abs);
        continue;
      }
      if (s.isFile() && isImageFileName(name)) results.push(abs);
    }
  };

  await walk(root);
  return results;
}

async function expandReferenceToPaths(ref: string): Promise<string[]> {
  const r = String(ref || "").trim();
  if (!r) return [];
  if (/^https?:\/\//i.test(r)) return [r];
  const st = await fs.stat(r).catch(() => null);
  if (!st) throw new Error(`参考图不存在: ${r}`);
  if (st.isDirectory()) {
    const files = await collectImagesFromDirRecursive(r);
    if (!files.length) throw new Error(`参考图目录下没有图片文件: ${r}`);
    return files;
  }
  if (!st.isFile()) throw new Error(`参考图不是文件: ${r}`);
  return [r];
}

const parseNameList = (input: string) => input.split(/[，,]/).map((s) => s.trim()).filter(Boolean);

const detectAspectRatioByFixedSize = (width?: number, height?: number): string | undefined => {
  if (!width || !height) return undefined;
  if (width === 1200 && height === 628) return "16:9";
  if (width === 1024 && height === 1024) return "1:1";
  if (width === 960 && height === 1200) return "4:5";
  return undefined;
};

export async function expandConfigByBatchFun(
  config: WebImageConfig,
  options?: {
    /** 对非 combination：覆盖每条展开后的 count；对 combination：作为 desiredCount（展开条数） */
    countOverride?: number;
  }
): Promise<WebImageConfig[]> {
  const batchFun = config?.batchFun;
  if (!batchFun || typeof batchFun !== "string") return [{ ...config }];

  if (batchFun === "batch" && Array.isArray(config.referenceImages) && config.referenceImages.length > 0) {
    const ref0 = String(config.referenceImages[0] || "").trim();
    if (!ref0) return [{ ...config }];
    const st = await fs.stat(ref0).catch(() => null);
    if (!st) throw new Error(`batchFun 模式下读取 referenceImages 路径失败: ${ref0}`);
    const paths = st.isDirectory() ? await collectImagesFromDirRecursive(ref0) : [ref0];
    if (!paths.length) throw new Error(`batchFun 模式下，referenceImages 文件夹中没有找到图片文件: ${ref0}`);
    return paths.map((p) => {
      const next: WebImageConfig = { ...config, referenceImages: [p] };
      if (options?.countOverride !== undefined) next.count = options.countOverride;
      return next;
    });
  }

  if (batchFun === "translate" && Array.isArray(config.referenceImages) && config.referenceImages.length > 0) {
    const ref0 = String(config.referenceImages[0] || "").trim();
    if (!ref0) return [{ ...config }];
    const st = await fs.stat(ref0).catch(() => null);
    if (!st) throw new Error(`translate 模式下读取 referenceImages 路径失败: ${ref0}`);
    const paths = st.isDirectory() ? await collectImagesFromDirRecursive(ref0) : [ref0];
    if (!paths.length) throw new Error(`translate 模式下，referenceImages 文件夹中没有找到图片文件: ${ref0}`);
    const out: WebImageConfig[] = [];
    for (const p of paths) {
      const next: WebImageConfig = { ...config, referenceImages: [p], promptTmpFunName: "getTextTranslatePrompt" };
      try {
        const m = await sharp(p).metadata();
        const detected = detectAspectRatioByFixedSize(m.width, m.height);
        if (detected) {
          next.imageConfig = next.imageConfig && typeof next.imageConfig === "object" ? { ...next.imageConfig } : {};
          next.imageConfig.aspectRatio = detected;
        }
      } catch {
      }
      if (options?.countOverride !== undefined) next.count = options.countOverride;
      out.push(next);
    }
    return out;
  }

  if (batchFun.startsWith("combination")) {
    const rawTemplateNames = config.promptTmpFunName && typeof config.promptTmpFunName === "string" ? parseNameList(config.promptTmpFunName) : [];
    const templateNames = rawTemplateNames.length ? rawTemplateNames : [""];

    if (!Array.isArray(config.referenceImages) || config.referenceImages.length === 0) {
      throw new Error(`combination 模式下 referenceImages 不能为空`);
    }
    const match = String(batchFun).match(/^combination(\d+)?$/);
    const targetImageCount = match && match[1] ? parseInt(match[1], 10) : 1;

    const allImages: string[] = [];
    for (const ref of config.referenceImages) {
      const r = String(ref || "").trim();
      if (!r) continue;
      allImages.push(...(await expandReferenceToPaths(r)));
    }
    if (!allImages.length) {
      throw new Error(`combination 模式下未找到参考图片`);
    }

    const maxGroupSize = Math.min(targetImageCount, allImages.length);
    const combos: string[][] = [];
    const buildCombos = (targetSize: number, startIndex: number, picked: string[]) => {
      if (picked.length === targetSize) {
        combos.push([...picked]);
        return;
      }
      for (let i = startIndex; i < allImages.length; i += 1) {
        picked.push(allImages[i]);
        buildCombos(targetSize, i + 1, picked);
        picked.pop();
      }
    };
    buildCombos(maxGroupSize, 0, []);

    const pairs: Array<{ templateName: string; images: string[] }> = [];
    for (const imgCombo of combos) {
      for (const templateName of templateNames) {
        pairs.push({ templateName, images: imgCombo });
      }
    }
    const desiredCountRaw = options?.countOverride !== undefined ? options.countOverride : Number(config.count ?? 1) || 1;
    const desiredCount = Math.max(0, Math.floor(desiredCountRaw));
    if (desiredCount <= 0) return [];

    const buildConfigByPair = (pair: { templateName: string; images: string[] }) => {
      const next: WebImageConfig = { ...config };
      next.referenceImages = pair.images;
      next.count = 1;
      if (pair.templateName) next.promptTmpFunName = pair.templateName;
      return next;
    };

    const out: WebImageConfig[] = [];
    const takeCount = Math.min(desiredCount, pairs.length);
    for (let i = 0; i < takeCount; i += 1) out.push(buildConfigByPair(pairs[i]));
    for (let i = takeCount; i < desiredCount; i += 1) {
      const randomPair = pairs[Math.floor(Math.random() * pairs.length)];
      out.push(buildConfigByPair(randomPair));
    }
    return out;
  }

  const single = { ...config };
  if (options?.countOverride !== undefined) single.count = options.countOverride;
  return [single];
}

