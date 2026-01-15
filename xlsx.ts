import fs from 'fs-extra';
import * as path from 'path';
import XLSX from 'xlsx';
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
      // 如果填写了 promptTmpFunName，则使用对应模板函数重新构建提示词（优先级高于 appName/lang 的默认逻辑）
      if (record.batchFun !== 'combination' && record.promptTmpFunName && typeof record.promptTmpFunName === 'string') {
        const fn = (promptTemplates as any)[record.promptTmpFunName];
        if (typeof fn !== 'function') {
          throw new Error(`promptTmpFunName 指定的方法不存在或不是函数: ${record.promptTmpFunName}`);
        }
        const templateParams = {
          ...record,
          appName: record.appName ? String(record.appName) : '',
          lang: record.lang ? String(record.lang) : '',
          prompt: record.prompt ? String(record.prompt) : ''
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
      console.log(record);
      // 处理 batchFun 为 "batch" 的情况
      if (record.batchFun === 'batch' && record.referenceImages && Array.isArray(record.referenceImages) && record.referenceImages.length > 0) {
        const projectRoot = path.dirname(filePath);
        const refImagePath = record.referenceImages[0];
        const absRefPath = path.resolve(projectRoot, refImagePath);
        try {
          const stat = await fs.stat(absRefPath);
          if (stat.isDirectory()) {
            // 读取文件夹下的所有图片文件
            const imageExts = ['.jpg', '.jpeg', '.png', '.webp', '.gif', '.bmp', '.tiff', '.tif'];
            const files = await fs.readdir(absRefPath);
            const imageFiles = files
              .filter(file => {
                const ext = path.extname(file).toLowerCase();
                return imageExts.includes(ext);
              })
              .sort();
            if (imageFiles.length === 0) {
              throw new Error(`batchFun 模式下，referenceImages 文件夹中没有找到图片文件: ${refImagePath}`);
            }
            // 为每张图片创建一个对象
            for (const imageFile of imageFiles) {
              const imagePath = path.join(refImagePath, imageFile);
              const imageNameWithoutExt = path.parse(imageFile).name;
              const newRecord = { ...record };
              newRecord.referenceImages = [imagePath];
              // 拼接output路径
              if (newRecord.output) {
                newRecord.output = path.join(newRecord.output, imageNameWithoutExt);
              } else {
                newRecord.output = imageNameWithoutExt;
              }
              processedItems.push(newRecord);
            }
          } else {
            // 如果是文件，则只创建一个对象
            processedItems.push(record);
          }
        } catch (error) {
          throw new Error(`batchFun 模式下读取 referenceImages 路径失败: ${refImagePath}, 错误: ${error}`);
        }
      } else if (record.batchFun === 'combination') {
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
            const files = await fs.readdir(absRefPath);
            const imageFiles = files
              .filter(file => {
                const ext = path.extname(file).toLowerCase();
                return imageExts.includes(ext);
              })
              .sort();
            for (const imageFile of imageFiles) {
              allImages.push(path.join(refPath, imageFile));
            }
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
        const maxGroupSize = Math.min(3, allImages.length);
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
        for (let size = 1; size <= maxGroupSize; size++) {
          buildCombos(size, 0, []);
        }
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
              prompt: newRecord.prompt ? String(newRecord.prompt) : ''
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