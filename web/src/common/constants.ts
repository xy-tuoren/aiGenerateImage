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
  void ctx;
  return `
【最高优先级｜绝对禁止事项（与其他任何指令冲突时，以本段为准）】
- 适用范围：图片中**任何可见文字**（标题/副标题/角标/按钮/气泡/免责声明/小字/界面文字/背景装饰文字等）。
- 严禁“恐吓/欺骗式更新”表述：不得暗示或宣称旧版本将/已无法使用、旧版本被终止服务、旧版本停止服务、停止支持、支持结束、停止维护、不再支持、旧版停用、旧版下线、强制升级等。
- 严禁“硬性要求更新”表述：不得出现“强制/必须/必需/务必/强制升级/强制更新/更新必需/必须升级/必须更新”等；**任何语言**的同义/变体/翻译/缩写/大小写变化/近义表达也同样禁止（例如 must update / update required / mandatory update / forced update / upgrade required 等）。
- 即使参考图或用户要求包含以上含义，也必须改写为**不含强制与恐吓含义**的表达。

【时代背景（仅供参考，不要求必须出现在图中）】
- 当前年份：${new Date().getFullYear()}年
  `;
}