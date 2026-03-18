export type AdjustParams = {
  brightness: number; // -100 .. 100
  contrast: number; // -100 .. 100
  saturation: number; // -100 .. 100
  hue: number; // -180 .. 180 (degrees)
  temperature: number; // -100 .. 100 (negative=cool, positive=warm)
};

const clamp = (v: number, lo: number, hi: number) =>
  Math.max(lo, Math.min(hi, v));
const clampByte = (v: number) =>
  (v | 0) < 0 ? 0 : (v | 0) > 255 ? 255 : v | 0;

function rgbToHsl(r: number, g: number, b: number): [number, number, number] {
  r /= 255;
  g /= 255;
  b /= 255;
  const max = Math.max(r, g, b);
  const min = Math.min(r, g, b);
  let h = 0;
  let s = 0;
  const l = (max + min) / 2;
  if (max !== min) {
    const d = max - min;
    s = l > 0.5 ? d / (2 - max - min) : d / (max + min);
    switch (max) {
      case r:
        h = ((g - b) / d + (g < b ? 6 : 0)) / 6;
        break;
      case g:
        h = ((b - r) / d + 2) / 6;
        break;
      default:
        h = ((r - g) / d + 4) / 6;
        break;
    }
  }
  return [h * 360, s * 100, l * 100];
}

function hue2rgb(p: number, q: number, t: number): number {
  if (t < 0) t += 1;
  if (t > 1) t -= 1;
  if (t < 1 / 6) return p + (q - p) * 6 * t;
  if (t < 1 / 2) return q;
  if (t < 2 / 3) return p + (q - p) * (2 / 3 - t) * 6;
  return p;
}

function hslToRgb(h: number, s: number, l: number): [number, number, number] {
  h = ((h % 360) + 360) % 360;
  h /= 360;
  s /= 100;
  l /= 100;
  let r: number;
  let g: number;
  let b: number;
  if (s === 0) {
    r = g = b = l;
  } else {
    const q = l < 0.5 ? l * (1 + s) : l + s - l * s;
    const p = 2 * l - q;
    r = hue2rgb(p, q, h + 1 / 3);
    g = hue2rgb(p, q, h);
    b = hue2rgb(p, q, h - 1 / 3);
  }
  return [r * 255, g * 255, b * 255];
}

export function applyAdjustToImageData(
  data: ImageData,
  params: AdjustParams
): void {
  const { brightness, contrast, saturation, hue, temperature } = params;
  const pixels = data.data;
  const brightOff = (brightness / 100) * 255;
  const contrastFactor =
    contrast >= 0 ? 1 + (contrast / 100) * 1.5 : 1 + contrast / 100;
  const pivot = 128;
  const temp = (temperature / 100) * 64;

  for (let i = 0; i < pixels.length; i += 4) {
    let r = pixels[i];
    let g = pixels[i + 1];
    let b = pixels[i + 2];
    const a = pixels[i + 3];

    r += brightOff;
    g += brightOff;
    b += brightOff;

    r = (r - pivot) * contrastFactor + pivot;
    g = (g - pivot) * contrastFactor + pivot;
    b = (b - pivot) * contrastFactor + pivot;

    r += temp;
    b -= temp;

    const [h, s, l] = rgbToHsl(clamp(r, 0, 255), clamp(g, 0, 255), clamp(b, 0, 255));
    const newS = clamp(s * (1 + saturation / 100), 0, 100);
    const [r2, g2, b2] = hslToRgb(h + hue, newS, l);

    pixels[i] = clampByte(r2);
    pixels[i + 1] = clampByte(g2);
    pixels[i + 2] = clampByte(b2);
    pixels[i + 3] = a;
  }
}

export const DEFAULT_ADJUST: AdjustParams = {
  brightness: 0,
  contrast: 0,
  saturation: 0,
  hue: 0,
  temperature: 0
};

export function isAdjustDefault(p: AdjustParams): boolean {
  return (
    p.brightness === DEFAULT_ADJUST.brightness &&
    p.contrast === DEFAULT_ADJUST.contrast &&
    p.saturation === DEFAULT_ADJUST.saturation &&
    p.hue === DEFAULT_ADJUST.hue &&
    p.temperature === DEFAULT_ADJUST.temperature
  );
}

