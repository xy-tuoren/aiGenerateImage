import fs from 'fs-extra';
import * as path from 'path';
import axios from 'axios';
import sharp from 'sharp';

/**
 * 读取 JSON 文件
 * @param filePath JSON 文件路径
 * @returns Promise<any> 解析后的 JSON 对象
 */
export async function readJsonFile(filePath: string): Promise<any> {
  try {
    const data = await fs.readJson(filePath);
    return data;
  } catch (error) {
    throw new Error(`读取 JSON 文件失败: ${filePath}, 错误: ${error}`);
  }
}

/**
 * 将 ArrayBuffer 转换为 base64 字符串
 * @param arrayBuffer ArrayBuffer 对象
 * @returns string base64 编码的字符串
 */
export function arrayBufferToBase64(arrayBuffer: ArrayBuffer): string {
  const buffer = Buffer.from(arrayBuffer);
  return buffer.toString('base64');
}

export function mimeTypeToExt(mimeType: string): string {
  const mt = (mimeType || '').toLowerCase();
  if (mt.includes('image/png')) return 'png';
  if (mt.includes('image/jpeg') || mt.includes('image/jpg')) return 'jpg';
  if (mt.includes('image/webp')) return 'webp';
  if (mt.includes('image/gif')) return 'gif';
  if (mt.includes('image/bmp')) return 'bmp';
  if (mt.includes('image/tiff')) return 'tiff';
  return 'bin';
}

export async function writeGeneratedImageFile(targetFile: string, base64Data: string): Promise<void> {
  await fs.ensureDir(path.dirname(targetFile));
  await fs.writeFile(targetFile, Buffer.from(base64Data, 'base64'));
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
  };

  const normalizedRatio = (aspectRatio || '').trim();
  const dimensions = aspectRatioMap[normalizedRatio];

  if (!dimensions) {
    return typeof input === 'string' ? input : Buffer.from(input).toString('base64');
  }

  return await resizeImage(input, dimensions.width, dimensions.height, { fit: 'cover' });
}

// ========== 以下为 readConfigJsonAsGeminiJobs 相关的内部辅助函数 ==========
namespace ConfigJsonParser {
  const ZERO_WIDTH_CHARS_RE = /[\u200B-\u200D\uFEFF]/g;

  export function cleanKeyName(key: string): string {
    return (key || '').replace(ZERO_WIDTH_CHARS_RE, '').trim();
  }

  export function getValueByCleanKey(obj: Record<string, any>, keyName: string): any {
    if (!obj || typeof obj !== 'object') return undefined;
    if (Object.prototype.hasOwnProperty.call(obj, keyName)) return obj[keyName];
    const foundKey = Object.keys(obj).find((k) => cleanKeyName(k) === keyName);
    if (!foundKey) return undefined;
    return obj[foundKey];
  }

  function isHttpUrl(input: string): boolean {
    return /^https?:\/\//i.test(input);
  }

  function guessMimeTypeByExt(ext: string): string | undefined {
    const e = (ext || '').toLowerCase();
    if (e === '.jpg' || e === '.jpeg') return 'image/jpeg';
    if (e === '.png') return 'image/png';
    if (e === '.webp') return 'image/webp';
    if (e === '.gif') return 'image/gif';
    if (e === '.bmp') return 'image/bmp';
    if (e === '.tif' || e === '.tiff') return 'image/tiff';
    return undefined;
  }

  function sniffImageMimeTypeByMagicBytes(buffer: Buffer): string | undefined {
    if (!buffer || buffer.length < 12) return undefined;
    // PNG
    if (
      buffer[0] === 0x89 &&
      buffer[1] === 0x50 &&
      buffer[2] === 0x4e &&
      buffer[3] === 0x47 &&
      buffer[4] === 0x0d &&
      buffer[5] === 0x0a &&
      buffer[6] === 0x1a &&
      buffer[7] === 0x0a
    ) return 'image/png';
    // JPEG
    if (buffer[0] === 0xff && buffer[1] === 0xd8 && buffer[2] === 0xff) return 'image/jpeg';
    // GIF
    if (buffer[0] === 0x47 && buffer[1] === 0x49 && buffer[2] === 0x46 && buffer[3] === 0x38) return 'image/gif';
    // WEBP: RIFF....WEBP
    if (
      buffer[0] === 0x52 &&
      buffer[1] === 0x49 &&
      buffer[2] === 0x46 &&
      buffer[3] === 0x46 &&
      buffer[8] === 0x57 &&
      buffer[9] === 0x45 &&
      buffer[10] === 0x42 &&
      buffer[11] === 0x50
    ) return 'image/webp';
    return undefined;
  }

  /**
   * 展开文件夹路径为所有图片文件路径
   * @param input 文件或文件夹路径
   * @param projectRoot 项目根目录
   * @returns 图片文件路径数组
   */
  export async function expandImagePaths(
    input: string,
    projectRoot: string = process.cwd(),
  ): Promise<string[]> {
    const raw = (input || '').toString().trim();
    if (!raw) {
      return [];
    }

    // HTTP URL 直接返回
    if (isHttpUrl(raw)) {
      return [raw];
    }

    const absPath = path.resolve(projectRoot, raw);
    const stat = await fs.stat(absPath).catch(() => null);
    if (!stat) {
      throw new Error(`referenceImages 路径不存在: ${raw}`);
    }

    // 如果是文件，直接返回
    if (stat.isFile()) {
      return [raw];
    }

    // 如果是文件夹，读取所有图片文件
    if (stat.isDirectory()) {
      const imageExts = ['.jpg', '.jpeg', '.png', '.webp', '.gif', '.bmp', '.tiff', '.tif'];
      const files = await fs.readdir(absPath);
      const imageFiles = files
        .filter(file => {
          const ext = path.extname(file).toLowerCase();
          return imageExts.includes(ext);
        })
        .map(file => path.join(raw, file))
        .sort();

      if (imageFiles.length === 0) {
        throw new Error(`referenceImages 文件夹中没有找到图片文件: ${raw}`);
      }

      return imageFiles;
    }

    return [raw];
  }

  export async function loadReferenceImageToInlineData(
    input: string,
    projectRoot: string = process.cwd(),
  ): Promise<{ data: string; mimeType: string }> {
    const raw = (input || '').toString().trim();
    if (!raw) {
      throw new Error('referenceImages 中存在空值');
    }

    let buffer: Buffer;
    if (isHttpUrl(raw)) {
      const res = await axios.get(raw, { responseType: 'arraybuffer' });
      buffer = Buffer.from(res.data as ArrayBuffer);
      const data = buffer.toString('base64');
      // 优先级：HTTP 响应头 > 文件头 magic bytes > URL 扩展名 > 默认值
      const contentType = (res.headers?.['content-type'] || '').toString();
      const headerMime = contentType.split(';')[0].trim();
      const sniffed = sniffImageMimeTypeByMagicBytes(buffer);
      const urlExt = path.extname(new URL(raw).pathname);
      const guessed = guessMimeTypeByExt(urlExt);
      const mimeType = headerMime || sniffed || guessed || 'application/octet-stream';
      return { data, mimeType };
    }

    const absPath = path.resolve(projectRoot, raw);
    buffer = await fs.readFile(absPath);
    const data = buffer.toString('base64');
    // 优先级：文件头 magic bytes > 文件扩展名 > 默认值
    const sniffed = sniffImageMimeTypeByMagicBytes(buffer);
    const ext = path.extname(absPath);
    const guessed = guessMimeTypeByExt(ext);
    const mimeType = sniffed || guessed || 'application/octet-stream';
    return { data, mimeType };
  }
}

export interface ConfigGenerateItem {
  prompt: string;
  referenceImages?: Array<string | { data: string; mimeType: string }>;
  generationConfig?: Record<string, any>;
  imageConfig?: Record<string, any>;
  responseModalities?: string[];
  output?: string;
  count?: number;
  [key: string]: any;
}

export async function readConfigJsonAsGeminiJobs(
  configPath: string = path.resolve(process.cwd(), 'config.json'),
): Promise<Array<{ prompt: string; options: { responseModalities?: string[]; imageConfig?: any; generationConfig?: any; referenceImages?: Array<{ data: string; mimeType: string }> }; output?: string; count?: number }>> {
  const items = await readJsonFile(configPath);
  if (!Array.isArray(items)) {
    throw new Error(`config.json 格式错误：根节点必须是数组，实际为 ${typeof items}`);
  }

  const jobs: Array<{ prompt: string; options: { responseModalities?: string[]; imageConfig?: any; generationConfig?: any; referenceImages?: Array<{ data: string; mimeType: string }> }; output?: string; count?: number }> = [];
  for (const item of items as ConfigGenerateItem[]) {
    const rawPromptValue = ConfigJsonParser.getValueByCleanKey(item as any, 'prompt');
    let prompt = (rawPromptValue ?? '').toString();

    if (!prompt) {
      throw new Error('config.json 中存在缺少 prompt 的项');
    }

    const output = ConfigJsonParser.getValueByCleanKey(item as any, 'output');
    const countRaw = ConfigJsonParser.getValueByCleanKey(item as any, 'count');
    const count = countRaw === undefined || countRaw === null ? undefined : Number(countRaw);

    const refRaw = ConfigJsonParser.getValueByCleanKey(item as any, 'referenceImages');
    let refList: Array<string | { data: string; mimeType: string }> = [];
    if (typeof refRaw === 'string') {
      refList = refRaw.split(',').map((s) => s.trim()).filter(Boolean);
    } else if (Array.isArray(refRaw)) {
      refList = refRaw as any[];
    }

    const inlineRefs: Array<{ data: string; mimeType: string }> = [];
    if (refList && refList.length) {
      for (const r of refList) {
        if (r && typeof r === 'object' && (r as any).data && (r as any).mimeType) {
          inlineRefs.push({ data: (r as any).data, mimeType: (r as any).mimeType });
        } else {
          // 展开文件夹路径为所有图片文件路径
          const expandedPaths = await ConfigJsonParser.expandImagePaths(String(r), path.dirname(configPath));
          for (const imgPath of expandedPaths) {
            inlineRefs.push(await ConfigJsonParser.loadReferenceImageToInlineData(imgPath, path.dirname(configPath)));
          }
        }
      }
    }

    const options: { responseModalities?: string[]; imageConfig?: any; generationConfig?: any; referenceImages?: Array<{ data: string; mimeType: string }> } = {};
    const responseModalities = ConfigJsonParser.getValueByCleanKey(item as any, 'responseModalities');
    if (Array.isArray(responseModalities)) options.responseModalities = responseModalities as string[];
    const imageConfig = ConfigJsonParser.getValueByCleanKey(item as any, 'imageConfig');
    if (imageConfig && typeof imageConfig === 'object') options.imageConfig = imageConfig;
    const generationConfig = ConfigJsonParser.getValueByCleanKey(item as any, 'generationConfig');
    if (generationConfig && typeof generationConfig === 'object') options.generationConfig = generationConfig;
    if (inlineRefs.length) options.referenceImages = inlineRefs;

    jobs.push({ prompt, options, output: typeof output === 'string' ? output : undefined, count: typeof count === 'number' && !Number.isNaN(count) ? count : undefined });
  }
  return jobs;
}

/**
 * 将长图拼接成指定分辨率的上下结构组合图
 * @param input 输入文件路径或文件夹路径
 * @param targetWidth 目标宽度（像素）
 * @param targetHeight 目标高度（像素）
 * @param projectRoot 项目根目录，默认为当前工作目录
 * @param filterSize 过滤尺寸，只处理指定分辨率的图片，默认为 { width: 1200, height: 628 }，设置为 null 则处理所有尺寸
 * @returns Promise<string[]> 返回生成的文件路径数组
 */
export async function splitAndStitchLongImage(
  input: string,
  targetWidth: number,
  targetHeight: number,
  projectRoot: string = process.cwd(),
  filterSize: { width: number; height: number } | null = { width: 1200, height: 628 }
): Promise<string[]> {
  const raw = (input || '').toString().trim();
  if (!raw) {
    throw new Error('输入路径不能为空');
  }

  if (targetWidth <= 0 || targetHeight <= 0) {
    throw new Error('目标宽度和高度必须大于0');
  }

  const absPath = path.resolve(projectRoot, raw);
  const stat = await fs.stat(absPath).catch(() => null);
  if (!stat) {
    throw new Error(`输入路径不存在: ${raw}`);
  }

  const imageExts = ['.jpg', '.jpeg', '.png', '.webp', '.gif', '.bmp', '.tiff', '.tif'];
  let imageFiles: string[] = [];

  // 递归获取文件夹下所有图片文件的辅助函数
  async function getAllImageFiles(dirPath: string): Promise<string[]> {
    const files: string[] = [];
    const absDirPath = path.resolve(projectRoot, dirPath);
    const entries = await fs.readdir(absDirPath, { withFileTypes: true });

    for (const entry of entries) {
      if (entry.isDirectory()) {
        // 递归处理子文件夹
        const subDirPath = path.join(dirPath, entry.name);
        const subFiles = await getAllImageFiles(subDirPath);
        files.push(...subFiles);
      } else if (entry.isFile()) {
        const ext = path.extname(entry.name).toLowerCase();
        if (imageExts.includes(ext)) {
          files.push(path.join(dirPath, entry.name));
        }
      }
    }

    return files;
  }

  // 如果是文件，直接使用
  if (stat.isFile()) {
    const ext = path.extname(absPath).toLowerCase();
    if (!imageExts.includes(ext)) {
      throw new Error(`不支持的文件格式: ${ext}`);
    }
    imageFiles = [raw];
  }
  // 如果是文件夹，递归读取所有图片文件（包括子文件夹）
  else if (stat.isDirectory()) {
    imageFiles = await getAllImageFiles(raw);
    imageFiles.sort();

    if (imageFiles.length === 0) {
      throw new Error(`文件夹及其子文件夹中没有找到图片文件: ${raw}`);
    }
  }

  const outputFiles: string[] = [];

  console.log(`找到 ${imageFiles.length} 个图片文件，开始处理...`);

  // 处理每个图片文件
  for (const imageFile of imageFiles) {
    const absImagePath = path.resolve(projectRoot, imageFile);
    console.log(`\n处理图片: ${imageFile}`);
    const imageBuffer = await fs.readFile(absImagePath);
    const image = sharp(imageBuffer);
    const metadata = await image.metadata();

    if (!metadata.width || !metadata.height) {
      throw new Error(`无法读取图片尺寸: ${imageFile}`);
    }

    const originalWidth = metadata.width;
    const originalHeight = metadata.height;
    console.log(`  原始尺寸: ${originalWidth}x${originalHeight}`);

    // 如果设置了过滤尺寸，只处理匹配的图片
    if (filterSize !== null) {
      if (originalWidth !== filterSize.width || originalHeight !== filterSize.height) {
        console.log(`  跳过: 尺寸不匹配 (需要 ${filterSize.width}x${filterSize.height})`);
        continue;
      }
    }

    const halfTargetHeight = Math.floor(targetHeight / 2);
    const bottomTargetHeight = targetHeight - halfTargetHeight;

    if (halfTargetHeight <= 0 || bottomTargetHeight <= 0) {
      throw new Error(`目标高度过小，无法上下拼接: targetHeight=${targetHeight}`);
    }

    const topHalfBuffer = await image
      .clone()
      .resize(targetWidth, halfTargetHeight, {
        fit: 'cover'
      })
      .toBuffer();

    const bottomHalfBuffer = bottomTargetHeight === halfTargetHeight
      ? topHalfBuffer
      : await image
        .clone()
        .resize(targetWidth, bottomTargetHeight, {
          fit: 'cover'
        })
        .toBuffer();

    const stitchedImage = sharp({
      create: {
        width: targetWidth,
        height: targetHeight,
        channels: 3,
        background: '#ffffff'
      }
    });

    const ext = path.extname(absImagePath);
    const extLower = ext.toLowerCase();
    let stitchedOut = stitchedImage
      .composite([
        { input: topHalfBuffer, left: 0, top: 0 },
        { input: bottomHalfBuffer, left: 0, top: halfTargetHeight }
      ]);
    if (extLower === '.jpg' || extLower === '.jpeg') {
      stitchedOut = stitchedOut.jpeg({ quality: 95 });
    } else if (extLower === '.png') {
      stitchedOut = stitchedOut.png();
    } else if (extLower === '.webp') {
      stitchedOut = stitchedOut.webp({ quality: 95 });
    }
    const finalBuffer = await stitchedOut.toBuffer();

    // 生成输出文件名：原图名_宽x高.扩展名
    const dir = path.dirname(absImagePath);
    const basename = path.basename(absImagePath, path.extname(absImagePath));
    const outputFileName = `${basename}_${targetWidth}x${targetHeight}${ext}`;
    const outputPath = path.join(dir, outputFileName);

    // 保存文件
    await fs.writeFile(outputPath, finalBuffer);
    outputFiles.push(outputPath);
    console.log(`  生成成功: ${outputPath}`);
    console.log(`  切片数量: 2, 输出尺寸: ${targetWidth}x${targetHeight}`);
  }

  console.log(`\n处理完成！共生成 ${outputFiles.length} 个文件:`);
  outputFiles.forEach((file, index) => {
    console.log(`  ${index + 1}. ${file}`);
  });

  return outputFiles;
}

/**
 * 重命名文件夹中的图片文件，根据分辨率自动分类命名
 * 首先对子文件夹按序号命名，然后对子文件夹中的图片按格式命名
 * @param folderPath 文件夹路径
 * @param projectRoot 项目根目录，默认为当前工作目录
 * @returns Promise<void>
 */
export async function renameImagesByResolution(
  folderPath: string,
  projectRoot: string = process.cwd()
): Promise<void> {
  const raw = (folderPath || '').toString().trim();
  if (!raw) {
    throw new Error('文件夹路径不能为空');
  }

  const absPath = path.resolve(projectRoot, raw);
  const stat = await fs.stat(absPath).catch(() => null);
  if (!stat) {
    throw new Error(`文件夹路径不存在: ${raw}`);
  }

  if (!stat.isDirectory()) {
    throw new Error(`路径不是文件夹: ${raw}`);
  }

  // 读取所有子文件夹
  const entries = await fs.readdir(absPath, { withFileTypes: true });
  const subFolders = entries
    .filter(entry => entry.isDirectory())
    .map(entry => entry.name)
    .sort();

  if (subFolders.length === 0) {
    throw new Error(`文件夹中没有找到子文件夹: ${raw}`);
  }

  console.log(`找到 ${subFolders.length} 个子文件夹，开始处理...\n`);

  // 第一步：对子文件夹按序号重命名
  const renamedFolders: Array<{ oldName: string; newName: string; index: number }> = [];
  for (let i = 0; i < subFolders.length; i++) {
    const oldFolderName = subFolders[i];
    const newFolderName = String(i + 1);
    const oldFolderPath = path.join(absPath, oldFolderName);
    const newFolderPath = path.join(absPath, newFolderName);

    if (oldFolderName === newFolderName) {
      console.log(`子文件夹 ${oldFolderName} 已符合命名格式，跳过重命名`);
      renamedFolders.push({ oldName: oldFolderName, newName: newFolderName, index: i + 1 });
      continue;
    }

    // 检查新文件夹名是否已存在（可能是其他文件夹）
    const exists = await fs.pathExists(newFolderPath);
    if (exists && oldFolderName !== newFolderName) {
      // 如果目标名称已存在且不是当前文件夹，需要先临时重命名
      const tempName = `_temp_${Date.now()}_${i + 1}`;
      const tempPath = path.join(absPath, tempName);
      await fs.rename(oldFolderPath, tempPath);
      await fs.rename(tempPath, newFolderPath);
      console.log(`子文件夹重命名: ${oldFolderName} -> ${newFolderName}`);
    } else {
      await fs.rename(oldFolderPath, newFolderPath);
      console.log(`子文件夹重命名: ${oldFolderName} -> ${newFolderName}`);
    }

    renamedFolders.push({ oldName: oldFolderName, newName: newFolderName, index: i + 1 });
  }

  console.log(`\n子文件夹重命名完成！\n`);

  // 第二步：对每个子文件夹中的图片按格式重命名
  const imageExts = ['.jpg', '.jpeg', '.png', '.webp', '.gif', '.bmp', '.tiff', '.tif'];

  for (const folderInfo of renamedFolders) {
    const folderIndex = folderInfo.index;
    const subFolderPath = path.join(absPath, folderInfo.newName);

    console.log(`\n处理子文件夹: ${folderInfo.newName} (序号: ${folderIndex})`);

    // 读取子文件夹中的所有图片文件
    const files = await fs.readdir(subFolderPath);
    const imageFiles = files
      .filter(file => {
        const ext = path.extname(file).toLowerCase();
        return imageExts.includes(ext);
      })
      .sort();

    if (imageFiles.length === 0) {
      console.log(`  子文件夹中没有找到图片文件，跳过`);
      continue;
    }

    console.log(`  找到 ${imageFiles.length} 个图片文件`);

    // 按类型分组计数
    const counters: { landscape: number; square: number; vertical: number } = {
      landscape: 0,
      square: 0,
      vertical: 0
    };

    // 处理每个图片文件
    for (const imageFile of imageFiles) {
      const absImagePath = path.join(subFolderPath, imageFile);
      const imageBuffer = await fs.readFile(absImagePath);
      const image = sharp(imageBuffer);
      const metadata = await image.metadata();

      if (!metadata.width || !metadata.height) {
        console.log(`    跳过 ${imageFile}: 无法读取图片尺寸`);
        continue;
      }

      const width = metadata.width;
      const height = metadata.height;
      const ext = path.extname(imageFile);

      let type: 'landscape' | 'square' | 'vertical' | null = null;
      let newName: string;

      // 判断图片类型
      if (width === 1200 && height === 628) {
        type = 'landscape';
        counters.landscape++;
        newName = `${folderIndex}@404-landscape-${counters.landscape}${ext}`;
      } else if (width === 1024 && height === 1024) {
        type = 'square';
        counters.square++;
        newName = `${folderIndex}@404-square-${counters.square}${ext}`;
      } else if (width === 960 && height === 1200) {
        type = 'vertical';
        counters.vertical++;
        newName = `${folderIndex}@404-vertical-${counters.vertical}${ext}`;
      } else {
        console.log(`    跳过 ${imageFile}: 尺寸不匹配 (${width}x${height})`);
        continue;
      }

      // 重命名文件
      const newPath = path.join(subFolderPath, newName);
      if (absImagePath === newPath) {
        console.log(`    跳过 ${imageFile}: 文件名已符合格式`);
        continue;
      }

      // 检查新文件名是否已存在
      const exists = await fs.pathExists(newPath);
      if (exists) {
        console.log(`    跳过 ${imageFile}: 目标文件名已存在 ${newName}`);
        continue;
      }

      await fs.rename(absImagePath, newPath);
      console.log(`    重命名: ${imageFile} -> ${newName} (${width}x${height})`);
    }

    console.log(`  子文件夹 ${folderInfo.newName} 处理完成:`);
    console.log(`    landscape (1200x628): ${counters.landscape} 个`);
    console.log(`    square (1024x1024): ${counters.square} 个`);
    console.log(`    vertical (960x1200): ${counters.vertical} 个`);
  }

  console.log(`\n\n所有处理完成！`);
}


// splitAndStitchLongImage("D:\\mog素材\\xjt\\谷歌地图1", 1024, 1024);
// splitAndStitchLongImage("D:\\mog素材\\xjt\\谷歌地图1", 960, 1200);
// renameImagesByResolution("D:\\mog素材\\xjt\\谷歌地图1");