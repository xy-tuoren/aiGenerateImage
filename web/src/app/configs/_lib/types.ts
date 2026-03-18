export type ConfigItem = {
  id: string;
  modelProvider?: "gemini" | "jimeng";
  description?: string;
  prompt: string;
  referenceImages?: string[];
  generationConfig?: {
    temperature?: number;
    thinkingLevel?: "High" | "minimal";
    [k: string]: unknown;
  };
  imageConfig?: {
    imageSize?: string;
    aspectRatio?: string;
    width?: number;
    height?: number;
    minRatio?: number;
    maxRatio?: number;
    [k: string]: unknown;
  };
  responseModalities?: string[];
  count?: number;
  nextPromptFun?: string[];
  appName?: string;
  lang?: string;
  langs?: string[];
  batchFun?: string;
  promptTmpFunName?: string;
  extra?: Record<string, unknown>;
  createdAt?: string;
};

export type PromptTemplateItem = {
  id: string;
  userId?: string;
  name: string;
  template: string;
  description?: string;
  username?: string;
  createdAt?: string;
  updatedAt?: string;
};

