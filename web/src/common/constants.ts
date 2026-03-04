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
  const appName = String(ctx?.appName || "").trim();
  const isBuzz = !!appName && appName.toLowerCase() === "buzz";
  const isKids = !!appName && appName.toLowerCase() === "kids";
  const isKids18 = !!appName && appName.toLowerCase() === "kids18";

  if (isBuzz) {
    return `
## 最高优先级｜绝对禁止事项
> 与其他任何指令冲突时，以本段为准。
## 时代背景（仅供参考不强制执行）
- **当前年份**：${new Date().getFullYear()}年
  `;
  }

  if (isKids || isKids18) {
    return `
## 最高优先级｜绝对禁止事项
> 与其他任何指令冲突时，以本段为准。
  `;
  }

  return `
## 最高优先级｜绝对禁止事项
> 与其他任何指令冲突时，以本段为准。

- **适用范围**：图片中**任何可见文字**（标题/副标题/角标/按钮/气泡/免责声明/小字/界面文字/背景装饰文字等）。
- **禁止内容**：严禁出现任何跟**更新**相关的文案；以及任何**强硬/命令式/合规要求式**措辞（例如：required / Required / REQUIRED / must / mandatory / 必填 / 必须 / 务必 / 必需 等）。
- **覆盖规则**：**任何语言**的同义/变体/翻译/缩写/大小写变化/近义表达也同样禁止。
- **冲突处理**：即使参考图或用户要求包含以上含义，也必须改写表达。
- **允许方向**：文案内容只能跟下载/获取/立即下载/立即获取等相关。

## 时代背景（仅供参考不强制执行）
- **当前年份**：${new Date().getFullYear()}年
  `;
}