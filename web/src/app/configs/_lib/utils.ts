export const MODEL_PROVIDER_OPTIONS = [
  { label: "谷歌", value: "gemini" },
  { label: "即梦", value: "jimeng" }
];

export const THINKING_LEVEL_OPTIONS = [
  { label: "High", value: "High" },
  { label: "minimal", value: "minimal" }
];

export function normalizeThinkingLevel(input: unknown): "High" | "minimal" {
  return String(input || "").trim() === "minimal" ? "minimal" : "High";
}

function gcd(a: number, b: number): number {
  let x = Math.abs(Math.trunc(a));
  let y = Math.abs(Math.trunc(b));
  while (y) {
    const t = x % y;
    x = y;
    y = t;
  }
  return x || 1;
}

export function deriveAspectRatioLabel(
  width?: number,
  height?: number
): string | undefined {
  if (!width || !height || !Number.isFinite(width) || !Number.isFinite(height))
    return undefined;
  const w = Math.max(1, Math.floor(width));
  const h = Math.max(1, Math.floor(height));
  const d = gcd(w, h);
  return `${Math.floor(w / d)}:${Math.floor(h / d)}`;
}

export function deriveJimengRatioFields(
  width?: number,
  height?: number
): {
  aspectRatio?: string;
  minRatio?: number;
  maxRatio?: number;
} {
  if (
    !width ||
    !height ||
    !Number.isFinite(width) ||
    !Number.isFinite(height)
  ) {
    return {};
  }
  const w = Math.max(1, Math.floor(width));
  const h = Math.max(1, Math.floor(height));
  const ratio = Number((w / h).toFixed(6));
  return {
    aspectRatio: deriveAspectRatioLabel(w, h),
    minRatio: ratio,
    maxRatio: ratio
  };
}

const GEMINI_RATIO_BASE_SIZE_1K: Record<string, { width: number; height: number }> =
{
  "1:1": { width: 1024, height: 1024 },
  "1:4": { width: 512, height: 2048 },
  "1:8": { width: 384, height: 3072 },
  "2:3": { width: 848, height: 1264 },
  "3:2": { width: 1264, height: 848 },
  "3:4": { width: 896, height: 1200 },
  "4:1": { width: 2048, height: 512 },
  "4:3": { width: 1200, height: 896 },
  "4:5": { width: 928, height: 1152 },
  "5:4": { width: 1152, height: 928 },
  "8:1": { width: 3072, height: 384 },
  "9:16": { width: 768, height: 1376 },
  "16:9": { width: 1376, height: 768 },
  "21:9": { width: 1584, height: 672 }
};

const GEMINI_SIZE_SCALE: Record<"1K" | "2K" | "4K", number> = {
  "1K": 1,
  "2K": 2,
  "4K": 4
};

function parseAspectRatioValue(aspectRatio: string): number | undefined {
  const m = String(aspectRatio || "")
    .trim()
    .match(/^(\d+(?:\.\d+)?)\s*:\s*(\d+(?:\.\d+)?)$/);
  if (!m) return undefined;
  const w = Number(m[1]);
  const h = Number(m[2]);
  if (!Number.isFinite(w) || !Number.isFinite(h) || w <= 0 || h <= 0)
    return undefined;
  return w / h;
}

export function deriveGeminiMatchFields(
  width?: number,
  height?: number
): {
  matchedAspectRatio?: string;
  matchedResolutionText?: string;
} {
  if (
    !width ||
    !height ||
    !Number.isFinite(width) ||
    !Number.isFinite(height) ||
    width <= 0 ||
    height <= 0
  ) {
    return {};
  }
  const targetW = Math.max(1, Math.floor(width));
  const targetH = Math.max(1, Math.floor(height));
  const targetRatio = targetW / targetH;

  let bestRatio = "1:1";
  let bestRatioDiff = Number.POSITIVE_INFINITY;
  for (const ratio of Object.keys(GEMINI_RATIO_BASE_SIZE_1K)) {
    const ratioValue = parseAspectRatioValue(ratio);
    if (!ratioValue) continue;
    const diff = Math.abs(ratioValue - targetRatio);
    if (diff < bestRatioDiff) {
      bestRatioDiff = diff;
      bestRatio = ratio;
    }
  }

  const base =
    GEMINI_RATIO_BASE_SIZE_1K[bestRatio] || GEMINI_RATIO_BASE_SIZE_1K["1:1"];
  let bestSize: "1K" | "2K" | "4K" = "1K";
  let bestDist = Number.POSITIVE_INFINITY;
  for (const size of Object.keys(GEMINI_SIZE_SCALE) as Array<
    "1K" | "2K" | "4K"
  >) {
    const scale = GEMINI_SIZE_SCALE[size];
    const w = base.width * scale;
    const h = base.height * scale;
    const dist =
      Math.abs(w - targetW) / targetW + Math.abs(h - targetH) / targetH;
    if (dist < bestDist) {
      bestDist = dist;
      bestSize = size;
    }
  }
  const scale = GEMINI_SIZE_SCALE[bestSize];
  const reqW = base.width * scale;
  const reqH = base.height * scale;

  return {
    matchedAspectRatio: bestRatio,
    matchedResolutionText: `${bestSize} (${reqW}x${reqH})`
  };
}

export function splitLinesToList(input: string): string[] {
  return (
    (input || "")
      // Important: reference image paths / function names may legally contain commas.
      // The UI expects "one item per line", so we only split by newlines.
      .split(/\r?\n/)
      .map((s) => s.trim())
      .filter(Boolean)
  );
}

export function normalizeTemplateVarsForPreview(input: string): string {
  return String(input || "").replace(
    /\$\{\s*([A-Za-z_][A-Za-z0-9_]*)\s*\}/g,
    "{{$1}}"
  );
}

