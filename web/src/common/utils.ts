// @ts-expect-error - piexifjs 没有类型定义
import piexif from "piexifjs";

export function getRatioDesc(aspectRatio?: string): string {
  if (!aspectRatio) return '';
  const ratio = aspectRatio.trim();
  if (ratio === '1:1') return '1:1的方图';
  if (ratio === '4:5') return '4:5的竖图';
  if (ratio === '16:9') return '16:9的长图';
  if (ratio === '9:16') return '9:16的竖图';
  return `${ratio}比例的图片`;
}

/**
 * 图片元数据接口（用于打元标记）
 */
export interface ImageMetadata {
  /** 作者/创建者 */
  artist?: string;
  /** 描述信息 */
  description?: string;
  /** 版权信息 */
  copyright?: string;
  /** 软件名称 */
  software?: string;
  /** 用户评论 */
  userComment?: string;
  /** 自定义键值对（会序列化为 JSON 写入 EXIF UserComment，或按 key 写入 PNG tEXt） */
  custom?: Record<string, string | number | boolean>;
}

/**
 * 默认写入到图片中的元数据（用于标记生成来源）
 */
export const DEFAULT_IMAGE_METADATA: ImageMetadata = {
  custom: {
    tableName: "d-404",
    id: "d-404",
    userId: "d-404",
    designer: "d-404",
  },
};

/**
 * 给图片添加元数据（EXIF/PNG tEXt）
 * @param imageBuffer 图片的 ArrayBuffer
 * @param mimeType 图片 MIME 类型（如 'image/jpeg', 'image/png'）
 * @param metadata 要添加的元数据
 * @returns 带有元数据的 ArrayBuffer
 */
export function addMetadataToImage(
  imageBuffer: ArrayBuffer,
  mimeType: string,
  metadata: ImageMetadata
): ArrayBuffer {
  const uint8Array = new Uint8Array(imageBuffer);

  function addMetadataToJpeg(imageData: Uint8Array, meta: ImageMetadata): ArrayBuffer {
    try {
      const toBase64 = (u8: Uint8Array) => {
        try {
          // Node/现代运行时：避免大图片走字符串拼接导致不稳定
          if (typeof Buffer !== 'undefined') return Buffer.from(u8 as any).toString('base64');
        } catch {
        }
        let binary = '';
        for (let i = 0; i < u8.length; i++) binary += String.fromCharCode(u8[i]);
        return btoa(binary);
      };
      const base64 = toBase64(imageData);
      const jpeg = `data:image/jpeg;base64,${base64}`;

      let exifObj: Record<string, unknown> = {};
      try {
        exifObj = piexif.load(jpeg) as Record<string, unknown>;
      } catch {
        exifObj = {
          '0th': {},
          Exif: {},
          GPS: {},
          Interop: {},
          '1st': {},
          thumbnail: null,
        };
      }

      const ifd0 = (exifObj['0th'] || {}) as Record<number, string>;
      const exif = (exifObj.Exif || {}) as Record<number, string>;
      if (meta.artist) ifd0[piexif.ImageIFD.Artist] = meta.artist;
      if (meta.description) ifd0[piexif.ImageIFD.ImageDescription] = meta.description;
      if (meta.copyright) ifd0[piexif.ImageIFD.Copyright] = meta.copyright;
      if (meta.software) ifd0[piexif.ImageIFD.Software] = meta.software;
      const commentText = meta.custom ? JSON.stringify(meta.custom) : (meta.userComment || '');
      if (commentText) {
        try {
          const helper = (piexif as any)?.helper?.UserComment;
          exif[piexif.ExifIFD.UserComment] = helper?.encode ? helper.encode(commentText) : commentText;
        } catch {
          exif[piexif.ExifIFD.UserComment] = commentText;
        }
      }
      exifObj['0th'] = ifd0;
      exifObj.Exif = exif;

      const exifStr = piexif.dump(exifObj);
      const newJpeg = piexif.insert(exifStr, jpeg);
      const base64Data = newJpeg.split(',')[1];
      if (!base64Data) return imageData.buffer.slice(0) as ArrayBuffer;
      try {
        if (typeof Buffer !== 'undefined') {
          const buf = Buffer.from(base64Data, 'base64');
          return buf.buffer.slice(buf.byteOffset, buf.byteOffset + buf.byteLength) as ArrayBuffer;
        }
      } catch {
      }
      const binaryData = atob(base64Data);
      const newBuffer = new Uint8Array(binaryData.length);
      for (let i = 0; i < binaryData.length; i++) newBuffer[i] = binaryData.charCodeAt(i);
      return newBuffer.buffer as ArrayBuffer;
    } catch (error) {
      console.error('添加 JPEG 元数据失败:', error);
      return imageData.buffer.slice(0) as ArrayBuffer;
    }
  }

  function addMetadataToPng(imageData: Uint8Array, meta: ImageMetadata): ArrayBuffer {
    try {
      const iendMarker = new Uint8Array([0x49, 0x45, 0x4e, 0x44, 0xae, 0x42, 0x60, 0x82]);
      let iendIndex = -1;
      for (let i = 0; i <= imageData.length - iendMarker.length; i++) {
        let match = true;
        for (let j = 0; j < iendMarker.length; j++) {
          if (imageData[i + j] !== iendMarker[j]) {
            match = false;
            break;
          }
        }
        if (match) {
          iendIndex = i;
          break;
        }
      }
      if (iendIndex === -1) {
        throw new Error('无法找到 PNG IEND 标记');
      }

      const textChunks: Uint8Array[] = [];
      const addTextChunk = (keyword: string, text: string) => {
        const keywordBytes = new TextEncoder().encode(keyword);
        const textBytes = new TextEncoder().encode(text);
        const chunkData = new Uint8Array(keywordBytes.length + 1 + textBytes.length);
        chunkData.set(keywordBytes, 0);
        chunkData[keywordBytes.length] = 0x00;
        chunkData.set(textBytes, keywordBytes.length + 1);

        const length = new Uint8Array(4);
        new DataView(length.buffer).setUint32(0, chunkData.length, false);
        const type = new TextEncoder().encode('tEXt');
        const crc = new Uint8Array(4);

        const chunk = new Uint8Array(4 + 4 + chunkData.length + 4);
        chunk.set(length, 0);
        chunk.set(type, 4);
        chunk.set(chunkData, 8);
        chunk.set(crc, 8 + chunkData.length);
        textChunks.push(chunk);
      };

      if (meta.artist) addTextChunk('Artist', meta.artist);
      if (meta.description) addTextChunk('Description', meta.description);
      if (meta.copyright) addTextChunk('Copyright', meta.copyright);
      if (meta.software) addTextChunk('Software', meta.software);
      if (meta.userComment) addTextChunk('Comment', meta.userComment);
      if (meta.custom) {
        for (const [key, value] of Object.entries(meta.custom)) {
          addTextChunk(key, String(value));
        }
      }

      if (textChunks.length === 0) {
        return imageData.buffer.slice(0) as ArrayBuffer;
      }

      const beforeIend = imageData.slice(0, iendIndex);
      const iend = imageData.slice(iendIndex);
      const totalLength =
        beforeIend.length + textChunks.reduce((sum, c) => sum + c.length, 0) + iend.length;
      const newImage = new Uint8Array(totalLength);
      let offset = 0;
      newImage.set(beforeIend, offset);
      offset += beforeIend.length;
      for (const chunk of textChunks) {
        newImage.set(chunk, offset);
        offset += chunk.length;
      }
      newImage.set(iend, offset);
      return newImage.buffer as ArrayBuffer;
    } catch (error) {
      console.error('添加 PNG 元数据失败:', error);
      return imageData.buffer.slice(0) as ArrayBuffer;
    }
  }

  if (mimeType === 'image/jpeg' || mimeType === 'image/jpg') {
    return addMetadataToJpeg(uint8Array, metadata);
  }
  if (mimeType === 'image/png') {
    return addMetadataToPng(uint8Array, metadata);
  }
  console.warn(`不支持为 ${mimeType} 格式添加元数据，返回原图`);
  return imageBuffer;
}