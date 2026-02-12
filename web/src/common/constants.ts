// 支持的语言配置
export const SUPPORTED_LANGUAGES = [
  "US",
  "AR",
  "DE",
  "ES",
  "FR",
  "BR",
  "ID",
  "IT",
  "JP",
  "KR",
  "RO",
  "NL",
  "PL",
  "TH",
  "TR",
  "TW",
  "VN",
  "RU",
  "PT",
  "SV",
  "FI",
  "MS",
  "HI",
  "BN"
];

export const IMAGE_SIZE_OPTIONS = [
  { label: "1K", value: "1K" },
  { label: "2K", value: "2K" },
  { label: "4K", value: "4K" },
];

export const ASPECT_RATIO_OPTIONS = [
  { label: "2:1", value: "2:1" },
  { label: "1:1", value: "1:1" },
  { label: "4:5", value: "4:5" },
  { label: "16:9", value: "16:9" },
  { label: "9:16", value: "9:16" }
];

export const RESPONSE_MODALITIES_OPTIONS = [
  { label: "IMAGE", value: "IMAGE" }
];

export const BATCH_FUN_OPTIONS = [
  { label: "batch", value: "batch" },
  { label: "translate", value: "translate" },
  { label: "combination", value: "combination" },
  { label: "combination2", value: "combination2" },
  { label: "combination3", value: "combination3" },
];

export type GlobalPromptContext = {
  appName?: string;
  lang?: string;
  aspectRatio?: string;
  [k: string]: unknown;
};

/**
 * 全局提示词后缀（会拼到所有 prompt.ts 模板生成的提示词末尾）。
 * 这里放“跨模板的硬性约束”，避免在每个模板里重复写。
 */
export function buildGlobalPromptSuffix(ctx?: GlobalPromptContext): string {
  return `
  【绝对禁止事项】
    - 推广文案不能出现如:"旧版本无法使用、旧版本终止服务、旧版本支持结束"等不真实欺骗文案
  【仅作为补充参考】
    - 现在为${new Date().getFullYear()}年
  `;
}