import sharp from "sharp";

export function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, Math.max(0, ms || 0)));
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
  };

  const normalizedRatio = (aspectRatio || '').trim();
  const dimensions = aspectRatioMap[normalizedRatio];

  if (!dimensions) {
    return typeof input === 'string' ? input : Buffer.from(input).toString('base64');
  }

  return await resizeImage(input, dimensions.width, dimensions.height, { fit: 'cover' });
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
