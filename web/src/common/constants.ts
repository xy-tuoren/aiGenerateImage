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
    - 推广文案 **严禁** 出现任何“恐吓/欺骗式更新”措辞：不得暗示或宣称旧版本将/已无法使用、旧版本被终止服务、旧版本停止服务、停止支持、支持结束、停止维护、不再支持、旧版停用、旧版下线、强制升级等。
    - **任何语言** 的同义/变体/翻译/缩写/大小写变化/近义表达也同样禁止（只要语义等价就算违规），例如但不限于：
      - 中文：旧版停用 / 停止支持 / 支持结束 / 无法使用 / 终止服务 / 强制更新
      - 英文：OLD VERSION END / end of support / unsupported / service discontinued / forced update
      - 西语/葡语：fin del soporte / versión antigua no compatible / fim do suporte / versão antiga indisponível
      - 法语/德语/意语：fin du support / support beendet / nicht unterstützt / fine del supporto / non supportato
      - 日语/韩语：サポート終了 / 旧バージョンは利用不可 / 지원 종료 / 이전 버전 사용 불가
      - 俄语/阿语：поддержка прекращена / старая версия недоступна / انتهاء الدعم / الإصدار القديم غير متاح
    - 若参考图中出现上述文字或表达相同含义：**必须完全替换** 为中性且真实的表达（如“建议更新/立即更新/升级体验/修复优化/提升性能/新增功能”），绝对不要保留“停止/终止/无法使用/不再支持”等含义。
  【仅作为时代背景参考】
    - 现在为${new Date().getFullYear()}年
  `;
}