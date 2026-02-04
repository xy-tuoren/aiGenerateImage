import * as fs from "fs-extra";
import sharp from "sharp";
import { join, dirname, basename } from "path";
import { isImageFileName } from "@/lib/server/utils";

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

/** 解析参考图路径：若不存在则尝试按父目录下名前缀匹配（如 NAVER Map -> NAVER Map, Navigation） */
async function resolveRefPath(r: string): Promise<string> {
  const s = String(r || "").trim();
  if (!s) throw new Error(`参考图路径为空`);
  if (/^https?:\/\//i.test(s)) return s;
  let st = await fs.stat(s).catch(() => null);
  let resolved = s;
  if (!st) {
    const parent = dirname(s);
    const namePrefix = basename(s);
    const parentSt = await fs.stat(parent).catch(() => null);
    if (parentSt?.isDirectory() && namePrefix) {
      const names = await fs.readdir(parent).catch(() => []);
      const matched = names.filter((n) => n.startsWith(namePrefix)).sort();
      if (matched.length >= 1) {
        resolved = join(parent, matched[0]);
        st = await fs.stat(resolved).catch(() => null);
      }
    }
  }
  if (!st) throw new Error(`参考图不存在: ${r}`);
  return resolved;
}

async function expandReferenceToPaths(ref: string): Promise<string[]> {
  const r = String(ref || "").trim();
  if (!r) return [];
  if (/^https?:\/\//i.test(r)) return [r];
  const resolved = await resolveRefPath(r);
  const st = await fs.stat(resolved).catch(() => null);
  if (!st) throw new Error(`参考图不存在: ${r}`);
  if (st.isDirectory()) {
    const files = await collectImagesFromDirRecursive(resolved);
    if (!files.length) throw new Error(`参考图目录下没有图片文件: ${resolved}`);
    return files;
  }
  if (!st.isFile()) throw new Error(`参考图不是文件: ${resolved}`);
  return [resolved];
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
    const ref0Resolved = await resolveRefPath(ref0);
    const st = await fs.stat(ref0Resolved).catch(() => null);
    if (!st) throw new Error(`batchFun 模式下读取 referenceImages 路径失败: ${ref0}`);
    const paths = st.isDirectory() ? await collectImagesFromDirRecursive(ref0Resolved) : [ref0Resolved];
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
    const ref0Resolved = await resolveRefPath(ref0);
    const st = await fs.stat(ref0Resolved).catch(() => null);
    if (!st) throw new Error(`translate 模式下读取 referenceImages 路径失败: ${ref0}`);
    const paths = st.isDirectory() ? await collectImagesFromDirRecursive(ref0Resolved) : [ref0Resolved];
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
    const desiredCountRaw = options?.countOverride !== undefined ? options.countOverride : Number(config.count ?? 1) || 1;
    const desiredCount = Math.max(0, Math.floor(desiredCountRaw));
    if (desiredCount <= 0) return [];

    const combinationCountCapped = (n: number, k: number, cap: number): number => {
      const nn = Math.max(0, Math.floor(n));
      let kk = Math.max(0, Math.floor(k));
      const c = Math.max(0, Math.floor(cap));
      if (kk > nn) return 0;
      kk = Math.min(kk, nn - kk);
      let res = 1;
      for (let i = 1; i <= kk; i += 1) {
        res = (res * (nn - kk + i)) / i;
        if (!Number.isFinite(res) || res > c) return c + 1;
      }
      return Math.floor(res);
    };

    const buildConfigByPair = (pair: { templateName: string; images: string[] }) => {
      const next: WebImageConfig = { ...config };
      next.referenceImages = pair.images;
      next.count = 1;
      if (pair.templateName) next.promptTmpFunName = pair.templateName;
      return next;
    };

    const out: WebImageConfig[] = [];

    const n = allImages.length;
    const k = maxGroupSize;
    const MAX_ENUM_PAIRS = 50000;
    const combosCap = Math.max(1, Math.floor(MAX_ENUM_PAIRS / Math.max(1, templateNames.length)));
    const totalCombos = combinationCountCapped(n, k, combosCap);
    const totalPairs = totalCombos * templateNames.length;

    // 小规模：枚举全部组合并洗牌后取前 N（保证完全不重复）
    if (totalPairs > 0 && totalPairs <= MAX_ENUM_PAIRS) {
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
      buildCombos(k, 0, []);

      const pairs: Array<{ templateName: string; images: string[] }> = [];
      for (const imgCombo of combos) {
        for (const templateName of templateNames) {
          pairs.push({ templateName, images: imgCombo });
        }
      }

      for (let i = pairs.length - 1; i > 0; i -= 1) {
        const j = Math.floor(Math.random() * (i + 1));
        const tmp = pairs[i];
        pairs[i] = pairs[j];
        pairs[j] = tmp;
      }
      // 参考图不够组合时用已有组合循环填充，仍达到 desiredCount 条
      for (let i = 0; i < desiredCount; i += 1) out.push(buildConfigByPair(pairs[i % pairs.length]));
      return out;
    }

    // 大规模：不枚举全量组合，按需要随机采样（不重复），不足时用已有组合重复填充
    const seen = new Set<string>();
    const maxAttempts = Math.max(200, desiredCount * 50);

    for (let attempts = 0; attempts < maxAttempts && out.length < desiredCount; attempts += 1) {
      const idxSet = new Set<number>();
      while (idxSet.size < k) idxSet.add(Math.floor(Math.random() * n));
      const idxArr = [...idxSet].sort((a, b) => a - b);
      const images = idxArr.map((idx) => allImages[idx]);
      const templateName = templateNames[Math.floor(Math.random() * templateNames.length)];
      const key = `${templateName}|${idxArr.join(",")}`;
      if (seen.has(key)) continue;
      seen.add(key);
      out.push(buildConfigByPair({ templateName, images }));
    }
    // 参考图不够组合时用已有组合循环填充到 desiredCount
    while (out.length < desiredCount && out.length > 0) {
      const pick = out[Math.floor(Math.random() * out.length)];
      out.push(buildConfigByPair({ templateName: pick.promptTmpFunName ?? "", images: pick.referenceImages ?? [] }));
    }
    return out;
  }

  const single = { ...config };
  if (options?.countOverride !== undefined) single.count = options.countOverride;
  return [single];
}

