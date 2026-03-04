"use client";

export type PendingImage = {
  url: string;
  file: File;
  base64: string;
  mimeType: string;
};

export type GeneratedImage = {
  imageBase64: string;
  imageMimeType: string;
};

export type Message = {
  id: string;
  role: "user" | "assistant";
  content?: string;
  imageBase64?: string;
  imageMimeType?: string;
  generatedImages?: GeneratedImage[];
  referenceImages?: PendingImage[];
  loading?: boolean;
};

export type ConversationItem = {
  id: string;
  title: string;
  lastMessage?: string;
  isGenerating?: boolean;
  generationSettings?: Partial<ImageGenerationSettings> | null;
  createdAt?: string;
  updatedAt?: string;
};

export type ImageGenerationSettings = {
  enableImageSettings: boolean;
  aspectRatio?: string;
  imageSize?: string;
  thinkingLevel: "high" | "minimal";
  temperature: 0.5 | 1 | 1.5 | 2;
  outputCount: number;
};

export const NEW_CONVERSATION_SETTINGS_KEY = "__new_conversation__";

export const DEFAULT_IMAGE_GENERATION_SETTINGS: ImageGenerationSettings = {
  enableImageSettings: false,
  aspectRatio: undefined,
  imageSize: undefined,
  thinkingLevel: "minimal",
  temperature: 1,
  outputCount: 1
};

export function buildWelcomeMessage(): Message {
  return {
    id: "welcome",
    role: "assistant",
    content:
      "你好！我是基于 Gemini 的图像生成助手。你可以输入提示词让我生成图片，或者上传参考图并告诉我如何修改它。"
  };
}
