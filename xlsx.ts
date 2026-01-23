import fs from 'fs-extra';
import * as path from 'path';
import XLSX from 'xlsx';
import sharp from 'sharp';
import * as promptTemplates from './prompt.js';

/**
 * 读取特定格式的 xlsx，并跳过第一行介绍，第二行为属性字段，第三行及以后为数据
 * @param filePath xlsx 文件路径
 * @param sheetName 可选，指定要读取的工作表名称
 * @returns Promise<Record<string, any>[]>
 */
interface PromptXlsxOptions {
  /** 是否写入 config.json */
  writeConfig?: boolean;
  /** 输出文件路径，默认根目录的 config.json（仅当 writeConfig 为 true 时生效） */
  outputPath?: string;
}

export async function promptXlsxToJson(
  filePath: string = path.resolve(process.cwd(), 'config.xlsx'),
  sheetName?: string,
  options: PromptXlsxOptions = { writeConfig: true, outputPath: path.resolve(process.cwd(), 'config.json') },
): Promise<{ items: Record<string, any>[]; outputPath?: string } | Record<string, any>[]> {
  try {
    const setByPath = (target: Record<string, any>, pathKey: string, value: any) => {
      const parts = pathKey.split('.').map((s) => s.trim()).filter(Boolean);
      if (!parts.length) return;
      let cur: any = target;
      for (let i = 0; i < parts.length - 1; i++) {
        const k = parts[i];
        if (cur[k] === undefined || cur[k] === null || typeof cur[k] !== 'object') cur[k] = {};
        cur = cur[k];
      }
      cur[parts[parts.length - 1]] = value;
    };
    const isRowEmpty = (row: any[]) => {
      if (!row || !row.length) return true;
      return row.every((cell) => cell === undefined || cell === null || (typeof cell === 'string' && cell.trim() === ''));
    };
    const readSheetRows = () => {
      const workbook = XLSX.readFile(filePath);
      const selectedSheetName = sheetName || workbook.SheetNames[0];
      const sheet = workbook.Sheets[selectedSheetName];
      if (!sheet) {
        throw new Error(`工作表不存在: ${selectedSheetName}`);
      }
      return XLSX.utils.sheet_to_json(sheet, { header: 1, blankrows: false }) as any[][];
    };

    const rows: any[][] = readSheetRows();
    if (rows.length < 2) {
      throw new Error('xlsx 内容不足，至少需要两行（导语和字段行）');
    }
    const fieldRow = rows[1] || [];
    const fields = fieldRow.map((value) => (value ?? '').toString().trim());
    const dataRows = rows.slice(2).filter((r) => !isRowEmpty(r));
    const processedItems: Record<string, any>[] = [];
    for (const row of dataRows) {
      const record: Record<string, any> = {};
      fields.forEach((field, index) => {
        if (!field) return;
        const cellValue = row[index];
        if (cellValue === undefined || cellValue === null || (typeof cellValue === 'string' && cellValue.trim() === '')) return;
        setByPath(record, field, cellValue);
      });
      // 处理 referenceImages 为数组
      if (record.referenceImages && typeof record.referenceImages === 'string') {
        record.referenceImages = record.referenceImages.split(/[，,]/).map((s: string) => s.trim()).filter(Boolean);
      }
      if (record.nextPromptFun && typeof record.nextPromptFun === 'string') {
        record.nextPromptFun = record.nextPromptFun.split(/[，,]/).map((s: string) => s.trim()).filter(Boolean);
      }
      if (record.next && typeof record.next === 'string') {
        record.next = record.next.split(/[，,]/).map((s: string) => s.trim()).filter(Boolean);
      }
      if (!record.nextPromptFun && record.next && Array.isArray(record.next)) {
        record.nextPromptFun = record.next;
      }
      if (!record.next && record.nextPromptFun && Array.isArray(record.nextPromptFun)) {
        record.next = record.nextPromptFun;
      }
      // 处理数值字段
      const numberFields = ['generationConfig.temperature', 'generationConfig.topP', 'generationConfig.topK', 'count'];
      numberFields.forEach((fieldPath) => {
        const parts = fieldPath.split('.');
        let cur: any = record;
        for (let i = 0; i < parts.length - 1; i++) {
          if (cur[parts[i]] === undefined || cur[parts[i]] === null) return;
          cur = cur[parts[i]];
        }
        const lastKey = parts[parts.length - 1];
        // 如果是顶级字段，尝试通过键名匹配（处理可能的特殊字符）
        if (parts.length === 1) {
          const actualKey = Object.keys(cur).find((k) => k.trim() === lastKey || k.replace(/[\u200B-\u200D\uFEFF]/g, '') === lastKey);
          if (actualKey && cur[actualKey] !== undefined && cur[actualKey] !== null) {
            const numValue = typeof cur[actualKey] === 'string' ? parseFloat(cur[actualKey]) : Number(cur[actualKey]);
            if (!isNaN(numValue)) {
              cur[actualKey] = numValue;
            }
          }
        } else {
          if (cur[lastKey] !== undefined && cur[lastKey] !== null) {
            const numValue = typeof cur[lastKey] === 'string' ? parseFloat(cur[lastKey]) : Number(cur[lastKey]);
            if (!isNaN(numValue)) {
              cur[lastKey] = numValue;
            }
          } 
        }
      });
      const isCombinationMode = typeof record.batchFun === 'string' && record.batchFun.startsWith('combination');
      // 如果填写了 promptTmpFunName，则使用对应模板函数重新构建提示词（优先级高于 appName/lang 的默认逻辑）
      if (!isCombinationMode && record.promptTmpFunName && typeof record.promptTmpFunName === 'string') {
        const fn = (promptTemplates as any)[record.promptTmpFunName];
        if (typeof fn !== 'function') {
          throw new Error(`promptTmpFunName 指定的方法不存在或不是函数: ${record.promptTmpFunName}`);
        }
        const templateParams = {
          ...record,
          appName: record.appName ? String(record.appName) : '',
          lang: record.lang ? String(record.lang) : '',
          prompt: record.prompt ? String(record.prompt) : '',
          aspectRatio: record.aspectRatio ? String(record.aspectRatio) : (record.imageConfig?.aspectRatio ? String(record.imageConfig.aspectRatio) : '')
        };
        record.prompt = fn(templateParams);
      }
      // 如果 imageConfig 没有填写，则设置默认值
      if (!record.imageConfig || (typeof record.imageConfig === 'object' && Object.keys(record.imageConfig).length === 0)) {
        record.imageConfig = {
          aspectRatio: '16:9',
          imageSize: '1k'
        };
      }
      const countKeyForSkip = Object.keys(record).find((k) => k.trim() === 'count' || k.replace(/[\u200B-\u200D\uFEFF]/g, '') === 'count');
      const rawCountForSkip = countKeyForSkip ? (record as any)[countKeyForSkip] : undefined;
      const numericCountForSkip =
        rawCountForSkip !== undefined && rawCountForSkip !== null && !isNaN(Number(rawCountForSkip))
          ? Math.floor(Number(rawCountForSkip))
          : undefined;
      if (numericCountForSkip !== undefined && numericCountForSkip <= 0) {
        continue;
      }
      console.log(record);
      // 处理 batchFun 为 "batch" 的情况
      if (record.batchFun === 'batch' && record.referenceImages && Array.isArray(record.referenceImages) && record.referenceImages.length > 0) {
        const projectRoot = path.dirname(filePath);
        const refImagePath = record.referenceImages[0];
        const absRefPath = path.resolve(projectRoot, refImagePath);
        try {
          const stat = await fs.stat(absRefPath);
          const imageExts = ['.jpg', '.jpeg', '.png', '.webp', '.gif', '.bmp', '.tiff', '.tif'];
          const pushOne = async (imagePath: string, relWithinRoot: string) => {
            const imageNameWithoutExt = path.parse(relWithinRoot).name;
            const relDir = path.dirname(relWithinRoot);
            const newRecord = { ...record };
            newRecord.referenceImages = [imagePath];
            // 拼接output路径，保持子文件夹结构
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
            processedItems.push(newRecord);
          };
          if (stat.isDirectory()) {
            const collected: Array<{ imagePath: string; relWithinRoot: string }> = [];
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
                  const ext = path.extname(name).toLowerCase();
                  if (!imageExts.includes(ext)) continue;
                  const relWithinRoot = path.relative(absRefPath, abs);
                  const imagePath = path.join(refImagePath, relWithinRoot);
                  collected.push({ imagePath, relWithinRoot });
                }
              }
            };
            await walk(absRefPath);
            if (collected.length === 0) {
              throw new Error(`batchFun 模式下，referenceImages 文件夹中没有找到图片文件: ${refImagePath}`);
            }
            collected.sort((a, b) => (a.imagePath || '').localeCompare(b.imagePath || ''));
            for (const it of collected) {
              await pushOne(it.imagePath, it.relWithinRoot);
            }
          } else {
            await pushOne(refImagePath, path.basename(refImagePath));
          }
        } catch (error) {
          throw new Error(`batchFun 模式下读取 referenceImages 路径失败: ${refImagePath}, 错误: ${error}`);
        }
      } else if (record.batchFun === 'translate' && record.referenceImages && Array.isArray(record.referenceImages) && record.referenceImages.length > 0) {
        const projectRoot = path.dirname(filePath);
        const refImagePath = record.referenceImages[0];
        const absRefPath = path.resolve(projectRoot, refImagePath);
        try {
          const stat = await fs.stat(absRefPath);
          const imageExts = ['.jpg', '.jpeg', '.png', '.webp', '.gif', '.bmp', '.tiff', '.tif'];
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
          const pushOne = async (imagePath: string, relWithinRoot: string) => {
            const imageNameWithoutExt = path.parse(relWithinRoot).name;
            const relDir = path.dirname(relWithinRoot);
            const newRecord: any = { ...record };
            newRecord.referenceImages = [imagePath];
            newRecord.promptTmpFunName = 'getTextTranslatePrompt';
            // 读取图片分辨率，自动补充/覆盖 aspectRatio
            try {
              const absImg = path.resolve(projectRoot, imagePath);
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
              // 输出目录结构与输入目录结构保持一致：只拼接相对目录，不额外追加文件名目录
              newRecord.output = relDir && relDir !== '.'
                ? path.join(outStr, relDir)
                : outStr;
            } else if (relDir && relDir !== '.') {
              newRecord.output = relDir;
            }
            processedItems.push(newRecord);
          };
          if (stat.isDirectory()) {
            const collected: Array<{ imagePath: string; relWithinRoot: string }> = [];
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
                  const ext = path.extname(name).toLowerCase();
                  if (!imageExts.includes(ext)) continue;
                  const relWithinRoot = path.relative(absRefPath, abs);
                  const imagePath = path.join(refImagePath, relWithinRoot);
                  collected.push({ imagePath, relWithinRoot });
                }
              }
            };
            await walk(absRefPath);
            if (collected.length === 0) {
              throw new Error(`translate 模式下，referenceImages 文件夹中没有找到图片文件: ${refImagePath}`);
            }
            collected.sort((a, b) => (a.imagePath || '').localeCompare(b.imagePath || ''));
            for (const it of collected) {
              await pushOne(it.imagePath, it.relWithinRoot);
            }
          } else {
            await pushOne(refImagePath, path.basename(refImagePath));
          }
        } catch (error) {
          throw new Error(`translate 模式下读取 referenceImages 路径失败: ${refImagePath}, 错误: ${error}`);
        }
      } else if (record.batchFun === 'cut' && record.referenceImages && Array.isArray(record.referenceImages) && record.referenceImages.length > 0) {
        const projectRoot = path.dirname(filePath);
        const imageExts = ['.jpg', '.jpeg', '.png', '.webp', '.gif', '.bmp', '.tiff', '.tif'];
        const allImages: Array<{ imagePath: string; relWithinRoot: string }> = [];
        for (const ref of record.referenceImages) {
          const refPath = (ref ?? '').toString().trim();
          if (!refPath) continue;
          const absRefPath = path.resolve(projectRoot, refPath);
          const stat = await fs.stat(absRefPath).catch(() => null);
          if (!stat) {
            throw new Error(`cut 模式下 referenceImages 路径不存在: ${refPath}`);
          }
          if (stat.isDirectory()) {
            const walk = async (curAbs: string, baseRefPath: string) => {
              const names = await fs.readdir(curAbs);
              names.sort();
              for (const name of names) {
                const abs = path.join(curAbs, name);
                const st = await fs.stat(abs).catch(() => null);
                if (!st) continue;
                if (st.isDirectory()) {
                  await walk(abs, baseRefPath);
                } else if (st.isFile()) {
                  const ext = path.extname(name).toLowerCase();
                  if (!imageExts.includes(ext)) continue;
                  const relWithinRoot = path.relative(absRefPath, abs);
                  const imagePath = path.join(refPath, relWithinRoot);
                  allImages.push({ imagePath, relWithinRoot });
                }
              }
            };
            await walk(absRefPath, refPath);
          } else if (stat.isFile()) {
            const ext = path.extname(absRefPath).toLowerCase();
            if (imageExts.includes(ext)) {
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
        const buildPromptByTemplate = (templateName: string, rec: any) => {
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
        };
        for (const { imagePath, relWithinRoot } of allImages) {
          const imageNameWithoutExt = path.parse(relWithinRoot).name;
          const relDir = path.dirname(relWithinRoot);
          for (const { ratio, outDirName } of ratios) {
            for (const templateName of templateNames) {
              const newRecord: any = { ...record };
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
              processedItems.push(newRecord);
            }
          }
        }
      } else if (record.batchFun && typeof record.batchFun === 'string' && record.batchFun.startsWith('combination')) {
        const projectRoot = path.dirname(filePath);
        const countKey = Object.keys(record).find((k) => k.trim() === 'count' || k.replace(/[\u200B-\u200D\uFEFF]/g, '') === 'count');
        const rawCount = countKey ? (record as any)[countKey] : undefined;
        const numCount = rawCount !== undefined && rawCount !== null && !isNaN(Number(rawCount)) ? Number(rawCount) : undefined;
        const desiredCount = numCount !== undefined ? Math.floor(numCount) : 1;
        const parseNameList = (input: string) => input.split(/[，,]/).map((s) => s.trim()).filter(Boolean);
        const rawTemplateNames = record.promptTmpFunName && typeof record.promptTmpFunName === 'string' ? parseNameList(record.promptTmpFunName) : [];
        const templateNames = rawTemplateNames.length ? rawTemplateNames : [''];
        if (!record.referenceImages || !Array.isArray(record.referenceImages) || record.referenceImages.length === 0) {
          throw new Error(`combination 模式下 referenceImages 不能为空`);
        }
        const batchFunStr = String(record.batchFun);
        const match = batchFunStr.match(/^combination(\d+)?$/);
        const targetImageCount = match && match[1] ? parseInt(match[1], 10) : 1;
        const imageExts = ['.jpg', '.jpeg', '.png', '.webp', '.gif', '.bmp', '.tiff', '.tif'];
        const allImages: string[] = [];
        for (const ref of record.referenceImages) {
          const refPath = (ref ?? '').toString().trim();
          if (!refPath) continue;
          const absRefPath = path.resolve(projectRoot, refPath);
          const stat = await fs.stat(absRefPath).catch(() => null);
          if (!stat) {
            throw new Error(`combination 模式下 referenceImages 路径不存在: ${refPath}`);
          }
          if (stat.isDirectory()) {
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
                  const ext = path.extname(name).toLowerCase();
                  if (!imageExts.includes(ext)) continue;
                  const relWithinRoot = path.relative(absRefPath, abs);
                  const imagePath = path.join(refPath, relWithinRoot);
                  allImages.push(imagePath);
                }
              }
            };
            await walk(absRefPath);
          } else if (stat.isFile()) {
            const ext = path.extname(absRefPath).toLowerCase();
            if (imageExts.includes(ext)) {
              allImages.push(refPath);
            }
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
          return newRecord;
        };
        const takeCount = Math.min(desiredCount, pairs.length);
        for (let i = 0; i < takeCount; i++) {
          processedItems.push(buildRecordByPair(pairs[i]));
        }
        for (let i = takeCount; i < desiredCount; i++) {
          const randomPair = pairs[Math.floor(Math.random() * pairs.length)];
          processedItems.push(buildRecordByPair(randomPair));
        }
      } else {
        // 非 batch 模式，直接添加
        processedItems.push(record);
      }
    }
    const items = processedItems.filter((item) => Object.keys(item).length > 0);
    if (options?.writeConfig) {
      const targetPath = options.outputPath
        ? path.resolve(options.outputPath)
        : path.resolve(process.cwd(), 'config.json');
      await fs.writeJson(targetPath, items, { spaces: 2 });
      return { items, outputPath: targetPath };
    }
    return items;
  } catch (error) {
    throw new Error(`读取定制 xlsx 失败: ${filePath}, 错误: ${error}`);
  }
}

promptXlsxToJson().catch((err) => {
  console.error(err);
  process.exit(1);
});