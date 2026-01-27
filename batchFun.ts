import fs from 'fs-extra';
import * as path from 'path';
import sharp from 'sharp';
import * as promptTemplates from './prompt.js';

type AnyRecord = Record<string, any>;

export type BatchFunContext = {
  /** 项目根目录：用于把 referenceImages 里的相对路径 resolve 成绝对路径来读取文件/图片元信息 */
  projectRoot: string;
};

const IMAGE_EXTS = ['.jpg', '.jpeg', '.png', '.webp', '.gif', '.bmp', '.tiff', '.tif'];

const isImageFile = (fileName: string) => IMAGE_EXTS.includes(path.extname(fileName).toLowerCase());

const parseNameList = (input: string) => input.split(/[，,]/).map((s) => s.trim()).filter(Boolean);

async function collectImagesFromRef(
  ctx: BatchFunContext,
  refPath: string
): Promise<Array<{ imagePath: string; relWithinRoot: string; absRefRoot: string }>> {
  const absRefPath = path.resolve(ctx.projectRoot, refPath);
  const stat = await fs.stat(absRefPath).catch(() => null);
  if (!stat) return [];
  if (stat.isDirectory()) {
    const collected: Array<{ imagePath: string; relWithinRoot: string; absRefRoot: string }> = [];
    const walk = async (curAbs: string) => {
      const names = await fs.readdir(curAbs);
      names.sort();
      for (const name of names) {
        const abs = path.join(curAbs, name);
        const st = await fs.stat(abs).catch(() => null);
        if (!st) continue;
        if (st.isDirectory()) {
          await walk(abs);
        } else if (st.isFile()) {
          if (!isImageFile(name)) continue;
          const relWithinRoot = path.relative(absRefPath, abs);
          const imagePath = path.join(refPath, relWithinRoot);
          collected.push({ imagePath, relWithinRoot, absRefRoot: absRefPath });
        }
      }
    };
    await walk(absRefPath);
    collected.sort((a, b) => (a.imagePath || '').localeCompare(b.imagePath || ''));
    return collected;
  }
  if (stat.isFile()) {
    if (!isImageFile(absRefPath)) return [];
    return [{ imagePath: refPath, relWithinRoot: path.basename(refPath), absRefRoot: absRefPath }];
  }
  return [];
}

function buildPromptByTemplate(templateName: string, rec: AnyRecord) {
  const fn = (promptTemplates as any)[templateName];
  if (typeof fn !== 'function') {
    throw new Error(`promptTmpFunName 指定的方法不存在或不是函数: ${templateName}`);
  }
  const templateParams = {
    ...rec,
    appName: rec.appName ? String(rec.appName) : '',
    lang: rec.lang ? String(rec.lang) : '',
    prompt: rec.prompt ? String(rec.prompt) : '',
    aspectRatio: rec.aspectRatio ? String(rec.aspectRatio) : (rec.imageConfig?.aspectRatio ? String(rec.imageConfig.aspectRatio) : '')
  };
  return fn(templateParams);
}

/**
 * 对单条配置做 batchFun 扩展（可能返回多条，也可能原样返回一条）。
 * 注意：该函数只负责“配置展开”，不负责读 xlsx。
 */
export async function expandByBatchFun(record: AnyRecord, ctx: BatchFunContext): Promise<AnyRecord[]> {
  const batchFun = record?.batchFun;
  if (!batchFun || typeof batchFun !== 'string') return [{ ...record }];

  // batch：把 referenceImages[0] 当作目录/文件，按图片列表展开
  if (batchFun === 'batch' && record.referenceImages && Array.isArray(record.referenceImages) && record.referenceImages.length > 0) {
    const refImagePath = (record.referenceImages[0] ?? '').toString().trim();
    if (!refImagePath) return [{ ...record }];
    const absRefPath = path.resolve(ctx.projectRoot, refImagePath);
    try {
      const stat = await fs.stat(absRefPath);
      const out: AnyRecord[] = [];
      const pushOne = async (imagePath: string, relWithinRoot: string) => {
        const imageNameWithoutExt = path.parse(relWithinRoot).name;
        const relDir = path.dirname(relWithinRoot);
        const newRecord = { ...record };
        newRecord.referenceImages = [imagePath];
        if (newRecord.output) {
          const outStr = String(newRecord.output);
          if (relDir && relDir !== '.') {
            newRecord.output = path.join(outStr, relDir, imageNameWithoutExt);
          } else {
            newRecord.output = path.join(outStr, imageNameWithoutExt);
          }
        } else {
          if (relDir && relDir !== '.') {
            newRecord.output = path.join(relDir, imageNameWithoutExt);
          } else {
            newRecord.output = imageNameWithoutExt;
          }
        }
        out.push(newRecord);
      };
      if (stat.isDirectory()) {
        const collected = await collectImagesFromRef(ctx, refImagePath);
        if (collected.length === 0) {
          throw new Error(`batchFun 模式下，referenceImages 文件夹中没有找到图片文件: ${refImagePath}`);
        }
        for (const it of collected) {
          await pushOne(it.imagePath, it.relWithinRoot);
        }
      } else {
        await pushOne(refImagePath, path.basename(refImagePath));
      }
      return out;
    } catch (error) {
      throw new Error(`batchFun 模式下读取 referenceImages 路径失败: ${refImagePath}, 错误: ${error}`);
    }
  }

  // translate：按图片列表展开，并为每张图自动补齐 aspectRatio + 套用 getTextTranslatePrompt
  if (batchFun === 'translate' && record.referenceImages && Array.isArray(record.referenceImages) && record.referenceImages.length > 0) {
    const refImagePath = (record.referenceImages[0] ?? '').toString().trim();
    if (!refImagePath) return [{ ...record }];
    const absRefPath = path.resolve(ctx.projectRoot, refImagePath);
    try {
      const stat = await fs.stat(absRefPath);
      const fn = (promptTemplates as any).getTextTranslatePrompt;
      if (typeof fn !== 'function') {
        throw new Error(`translate 模式需要 prompt.ts 中存在 getTextTranslatePrompt 模版函数`);
      }
      const detectAspectRatioByFixedSize = (width?: number, height?: number): string | undefined => {
        if (!width || !height) return undefined;
        if (width === 1200 && height === 628) return '16:9';
        if (width === 1024 && height === 1024) return '1:1';
        if (width === 960 && height === 1200) return '4:5';
        return undefined;
      };
      const out: AnyRecord[] = [];
      const pushOne = async (imagePath: string, relWithinRoot: string) => {
        const relDir = path.dirname(relWithinRoot);
        const newRecord: AnyRecord = { ...record };
        newRecord.referenceImages = [imagePath];
        newRecord.promptTmpFunName = 'getTextTranslatePrompt';
        try {
          const absImg = path.resolve(ctx.projectRoot, imagePath);
          const m = await sharp(absImg).metadata();
          const detected = detectAspectRatioByFixedSize(m.width, m.height);
          if (detected) {
            if (!newRecord.imageConfig || typeof newRecord.imageConfig !== 'object') newRecord.imageConfig = {};
            newRecord.imageConfig.aspectRatio = detected;
            newRecord.aspectRatio = detected;
          }
        } catch { }
        const templateParams = {
          ...newRecord,
          lang: newRecord.lang ? String(newRecord.lang) : '',
          prompt: newRecord.prompt ? String(newRecord.prompt) : '',
          aspectRatio: newRecord.aspectRatio ? String(newRecord.aspectRatio) : (newRecord.imageConfig?.aspectRatio ? String(newRecord.imageConfig.aspectRatio) : '')
        };
        newRecord.prompt = fn(templateParams);
        if (newRecord.output) {
          const outStr = String(newRecord.output);
          newRecord.output = relDir && relDir !== '.'
            ? path.join(outStr, relDir)
            : outStr;
        } else if (relDir && relDir !== '.') {
          newRecord.output = relDir;
        }
        out.push(newRecord);
      };
      if (stat.isDirectory()) {
        const collected = await collectImagesFromRef(ctx, refImagePath);
        if (collected.length === 0) {
          throw new Error(`translate 模式下，referenceImages 文件夹中没有找到图片文件: ${refImagePath}`);
        }
        for (const it of collected) {
          await pushOne(it.imagePath, it.relWithinRoot);
        }
      } else {
        await pushOne(refImagePath, path.basename(refImagePath));
      }
      return out;
    } catch (error) {
      throw new Error(`translate 模式下读取 referenceImages 路径失败: ${refImagePath}, 错误: ${error}`);
    }
  }

  // cut：把 referenceImages 里多个目录/文件合并成图片列表，再按 ratio * template 展开
  if (batchFun === 'cut' && record.referenceImages && Array.isArray(record.referenceImages) && record.referenceImages.length > 0) {
    const allImages: Array<{ imagePath: string; relWithinRoot: string }> = [];
    for (const ref of record.referenceImages) {
      const refPath = (ref ?? '').toString().trim();
      if (!refPath) continue;
      const absRefPath = path.resolve(ctx.projectRoot, refPath);
      const stat = await fs.stat(absRefPath).catch(() => null);
      if (!stat) {
        throw new Error(`cut 模式下 referenceImages 路径不存在: ${refPath}`);
      }
      if (stat.isDirectory()) {
        const collected = await collectImagesFromRef(ctx, refPath);
        for (const it of collected) {
          allImages.push({ imagePath: it.imagePath, relWithinRoot: it.relWithinRoot });
        }
      } else if (stat.isFile()) {
        if (isImageFile(absRefPath)) {
          allImages.push({ imagePath: refPath, relWithinRoot: path.basename(refPath) });
        }
      }
    }
    if (allImages.length === 0) {
      throw new Error(`cut 模式下未找到参考图片`);
    }
    allImages.sort((a, b) => (a.imagePath || '').localeCompare(b.imagePath || ''));
    const ratios: Array<{ ratio: string; outDirName: string }> = [
      { ratio: '1:1', outDirName: '方竖' },
      { ratio: '4:5', outDirName: '方竖' },
    ];
    const templateNames = ['getCutLogoFinalPrompt', 'getCutOtherFinalPrompt', 'getCutScaleFinalPrompt'];
    const out: AnyRecord[] = [];
    for (const { imagePath, relWithinRoot } of allImages) {
      const imageNameWithoutExt = path.parse(relWithinRoot).name;
      const relDir = path.dirname(relWithinRoot);
      for (const { ratio, outDirName } of ratios) {
        for (const templateName of templateNames) {
          const newRecord: AnyRecord = { ...record };
          if (newRecord.imageConfig && typeof newRecord.imageConfig === 'object') {
            newRecord.imageConfig = { ...newRecord.imageConfig };
          }
          newRecord.referenceImages = [imagePath];
          if (!newRecord.imageConfig || typeof newRecord.imageConfig !== 'object') newRecord.imageConfig = {};
          newRecord.imageConfig.aspectRatio = ratio;
          if (!newRecord.imageConfig.imageSize) newRecord.imageConfig.imageSize = '1k';
          newRecord.aspectRatio = ratio;
          newRecord.promptTmpFunName = templateName;
          newRecord.prompt = buildPromptByTemplate(templateName, newRecord);
          if (newRecord.output) {
            const outStr = String(newRecord.output);
            const needsDir = !outStr.endsWith(outDirName);
            if (relDir && relDir !== '.') {
              newRecord.output = needsDir
                ? path.join(outStr, outDirName, relDir, imageNameWithoutExt)
                : path.join(outStr, relDir, imageNameWithoutExt);
            } else {
              newRecord.output = needsDir
                ? path.join(outStr, outDirName, imageNameWithoutExt)
                : path.join(outStr, imageNameWithoutExt);
            }
          } else {
            if (relDir && relDir !== '.') {
              newRecord.output = path.join(outDirName, relDir, imageNameWithoutExt);
            } else {
              newRecord.output = path.join(outDirName, imageNameWithoutExt);
            }
          }
          out.push(newRecord);
        }
      }
    }
    return out;
  }

  // combination / combinationN：把 referenceImages 里的路径展开成图片全集，再做“组合 + 模板”对，最后按 count 取样生成多条配置
  if (batchFun.startsWith('combination')) {
    const countKey = Object.keys(record).find((k) => k.trim() === 'count' || k.replace(/[\u200B-\u200D\uFEFF]/g, '') === 'count');
    const rawCount = countKey ? (record as any)[countKey] : undefined;
    const numCount = rawCount !== undefined && rawCount !== null && !isNaN(Number(rawCount)) ? Number(rawCount) : undefined;
    const desiredCount = numCount !== undefined ? Math.floor(numCount) : 1;

    const rawTemplateNames = record.promptTmpFunName && typeof record.promptTmpFunName === 'string' ? parseNameList(record.promptTmpFunName) : [];
    const templateNames = rawTemplateNames.length ? rawTemplateNames : [''];

    if (!record.referenceImages || !Array.isArray(record.referenceImages) || record.referenceImages.length === 0) {
      throw new Error(`combination 模式下 referenceImages 不能为空`);
    }

    const match = String(batchFun).match(/^combination(\d+)?$/);
    const targetImageCount = match && match[1] ? parseInt(match[1], 10) : 1;

    const allImages: string[] = [];
    for (const ref of record.referenceImages) {
      const refPath = (ref ?? '').toString().trim();
      if (!refPath) continue;
      const collected = await collectImagesFromRef(ctx, refPath);
      if (collected.length) {
        for (const it of collected) allImages.push(it.imagePath);
        continue;
      }
      const absRefPath = path.resolve(ctx.projectRoot, refPath);
      const stat = await fs.stat(absRefPath).catch(() => null);
      if (!stat) {
        throw new Error(`combination 模式下 referenceImages 路径不存在: ${refPath}`);
      }
      if (stat.isFile() && isImageFile(absRefPath)) {
        allImages.push(refPath);
      }
    }
    if (allImages.length === 0) {
      throw new Error(`combination 模式下未找到参考图片`);
    }

    const maxGroupSize = Math.min(targetImageCount, allImages.length);
    const combos: string[][] = [];
    const buildCombos = (targetSize: number, startIndex: number, picked: string[]) => {
      if (picked.length === targetSize) {
        combos.push([...picked]);
        return;
      }
      for (let i = startIndex; i < allImages.length; i++) {
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

    const buildRecordByPair = (pair: { templateName: string; images: string[] }) => {
      const newRecord = { ...record } as any;
      newRecord.referenceImages = pair.images;
      if (countKey) {
        newRecord[countKey] = 1;
      } else {
        newRecord.count = 1;
      }
      if (pair.templateName) {
        const fn = (promptTemplates as any)[pair.templateName];
        if (typeof fn !== 'function') {
          throw new Error(`promptTmpFunName 指定的方法不存在或不是函数: ${pair.templateName}`);
        }
        const templateParams = {
          ...newRecord,
          appName: newRecord.appName ? String(newRecord.appName) : '',
          lang: newRecord.lang ? String(newRecord.lang) : '',
          prompt: newRecord.prompt ? String(newRecord.prompt) : '',
          aspectRatio: newRecord.aspectRatio ? String(newRecord.aspectRatio) : (newRecord.imageConfig?.aspectRatio ? String(newRecord.imageConfig.aspectRatio) : '')
        };
        newRecord.promptTmpFunName = pair.templateName;
        newRecord.prompt = fn(templateParams);
      }
      return newRecord as AnyRecord;
    };

    const out: AnyRecord[] = [];
    const takeCount = Math.min(desiredCount, pairs.length);
    for (let i = 0; i < takeCount; i++) {
      out.push(buildRecordByPair(pairs[i]));
    }
    for (let i = takeCount; i < desiredCount; i++) {
      const randomPair = pairs[Math.floor(Math.random() * pairs.length)];
      out.push(buildRecordByPair(randomPair));
    }
    return out;
  }

  return [{ ...record }];
}

export async function expandAllByBatchFun(records: AnyRecord[], ctx: BatchFunContext): Promise<AnyRecord[]> {
  const out: AnyRecord[] = [];
  for (const rec of records) {
    const expanded = await expandByBatchFun(rec, ctx);
    for (const it of expanded) out.push(it);
  }
  return out;
}

