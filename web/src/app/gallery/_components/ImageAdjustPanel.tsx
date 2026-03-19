"use client";

import { Button, InputNumber, Slider, Spin, Typography } from "antd";
import { useCallback, useEffect, useRef, useState } from "react";

import type { GridImage } from "../_lib/types";

type AdjustParams = {
  brightness: number;
  contrast: number;
  saturation: number;
  hue: number;
  lightness: number;
  temperature: number;
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

function applyAdjustToImageData(data: ImageData, params: AdjustParams): void {
  const { brightness, contrast, saturation, hue, lightness, temperature } =
    params;
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

    const [h, s, l] = rgbToHsl(
      clamp(r, 0, 255),
      clamp(g, 0, 255),
      clamp(b, 0, 255)
    );
    const newS = clamp(s * (1 + saturation / 100), 0, 100);
    const newL = clamp(l * (1 + lightness / 100), 0, 100);
    const [r2, g2, b2] = hslToRgb(h + hue, newS, newL);

    pixels[i] = clampByte(r2);
    pixels[i + 1] = clampByte(g2);
    pixels[i + 2] = clampByte(b2);
    pixels[i + 3] = a;
  }
}

const DEFAULT_ADJUST: AdjustParams = {
  brightness: 0,
  contrast: 0,
  saturation: 0,
  hue: 0,
  lightness: 0,
  temperature: 0
};

function isAdjustDefault(p: AdjustParams): boolean {
  return (
    p.brightness === DEFAULT_ADJUST.brightness &&
    p.contrast === DEFAULT_ADJUST.contrast &&
    p.saturation === DEFAULT_ADJUST.saturation &&
    p.hue === DEFAULT_ADJUST.hue &&
    p.lightness === DEFAULT_ADJUST.lightness &&
    p.temperature === DEFAULT_ADJUST.temperature
  );
}

const MAIN_PREVIEW_MAX_EDGE = 1920;
const MAIN_PREVIEW_DEBOUNCE_MS = 24;
const PANEL_WIDTH = 220;
const PANEL_GAP = 12;
const VIEWPORT_MARGIN = 12;

function getActivePreviewImageElement(): HTMLImageElement | null {
  if (typeof document === "undefined") return null;
  const nodes = Array.from(
    document.querySelectorAll(".ant-image-preview-img")
  ) as HTMLImageElement[];
  if (!nodes.length) return null;
  const candidates = nodes
    .map((img) => {
      const rect = img.getBoundingClientRect();
      const style = window.getComputedStyle(img);
      const visible =
        img.complete &&
        img.naturalWidth > 0 &&
        rect.width > 0 &&
        rect.height > 0 &&
        style.display !== "none" &&
        style.visibility !== "hidden" &&
        Number(style.opacity || "1") > 0.01;
      return { img, rect, area: rect.width * rect.height, visible };
    })
    .filter((x) => x.visible)
    .sort((a, b) => b.area - a.area);
  return candidates[0]?.img ?? null;
}

function dataURLToBase64(dataUrl: string): string {
  const i = dataUrl.indexOf(",");
  return i >= 0 ? dataUrl.slice(i + 1) : "";
}

export function ImageAdjustPanel(props: {
  open: boolean;
  imageUrl: string;
  imageInfo: GridImage | null;
  onClose: () => void;
  onSaved: (payload: {
    type: "override";
    url: string;
    originalUrl?: string;
  }) => void;
  messageApi: { success: (s: string) => void; error: (s: string) => void };
  onMainPreviewUrlChange?: (url: string | null) => void;
}) {
  const {
    open,
    imageUrl,
    imageInfo,
    onClose,
    onSaved,
    messageApi,
    onMainPreviewUrlChange
  } = props;

  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [params, setParams] = useState<AdjustParams>({ ...DEFAULT_ADJUST });
  const [saving, setSaving] = useState(false);
  const [panelPos, setPanelPos] = useState<{
    left: number;
    top: number;
    maxHeight: number;
  } | null>(null);

  const sourceImageDataRef = useRef<ImageData | null>(null);
  const sourceWidthRef = useRef(0);
  const sourceHeightRef = useRef(0);

  const loadImage = useCallback(async () => {
    if (!imageUrl || !open) return;
    setError(null);
    setLoading(true);
    // 每次进入调色都从 0 开始。
    setParams({ ...DEFAULT_ADJUST });
    try {
      const url = imageUrl.startsWith("/")
        ? `${
            typeof window !== "undefined" ? window.location.origin : ""
          }${imageUrl}`
        : imageUrl;

      const img = new Image();
      img.crossOrigin = "anonymous";
      await new Promise<void>((resolve, reject) => {
        img.onload = () => resolve();
        img.onerror = () => reject(new Error("加载图片失败"));
        img.src = url;
      });

      const w = img.naturalWidth || img.width;
      const h = img.naturalHeight || img.height;
      if (!w || !h) {
        setError("无法获取图片尺寸");
        return;
      }

      const canvas = document.createElement("canvas");
      canvas.width = w;
      canvas.height = h;
      const ctx = canvas.getContext("2d");
      if (!ctx) {
        setError("无法创建画布");
        return;
      }
      ctx.drawImage(img, 0, 0);
      sourceImageDataRef.current = ctx.getImageData(0, 0, w, h);
      sourceWidthRef.current = w;
      sourceHeightRef.current = h;
    } catch (e) {
      setError(e instanceof Error ? e.message : "加载失败");
      sourceImageDataRef.current = null;
    } finally {
      setLoading(false);
    }
  }, [imageUrl, open]);

  useEffect(() => {
    if (open && imageUrl) void loadImage();
  }, [open, imageUrl, loadImage]);

  const mainPreviewTimerRef = useRef<ReturnType<typeof setTimeout> | null>(
    null
  );
  const mainPreviewGenRef = useRef(0);
  useEffect(() => {
    if (!onMainPreviewUrlChange) return;
    if (!open || loading || error) {
      mainPreviewGenRef.current += 1;
      onMainPreviewUrlChange(null);
      return;
    }

    const source = sourceImageDataRef.current;
    const w = sourceWidthRef.current;
    const h = sourceHeightRef.current;
    if (!source || !w || !h) return;

    if (mainPreviewTimerRef.current) clearTimeout(mainPreviewTimerRef.current);

    const pushMainPreview = () => {
      const gen = ++mainPreviewGenRef.current;
      if (isAdjustDefault(params)) {
        onMainPreviewUrlChange(null);
        return;
      }
      const canvas = document.createElement("canvas");
      canvas.width = w;
      canvas.height = h;
      const ctx = canvas.getContext("2d");
      if (!ctx) return;
      const copy = ctx.createImageData(w, h);
      copy.data.set(source.data);
      applyAdjustToImageData(copy, params);
      ctx.putImageData(copy, 0, 0);

      const publishBlob = (blob: Blob | null) => {
        if (gen !== mainPreviewGenRef.current || !blob) return;
        onMainPreviewUrlChange(URL.createObjectURL(blob));
      };

      const maxE = Math.max(w, h);
      if (maxE > MAIN_PREVIEW_MAX_EDGE) {
        const s = MAIN_PREVIEW_MAX_EDGE / maxE;
        const tw = Math.round(w * s);
        const th = Math.round(h * s);
        const scaled = document.createElement("canvas");
        scaled.width = tw;
        scaled.height = th;
        const sctx = scaled.getContext("2d");
        if (!sctx) return;
        sctx.drawImage(canvas, 0, 0, w, h, 0, 0, tw, th);
        scaled.toBlob((blob) => publishBlob(blob), "image/jpeg", 0.88);
        return;
      }
      canvas.toBlob((blob) => publishBlob(blob), "image/jpeg", 0.88);
    };

    mainPreviewTimerRef.current = setTimeout(
      pushMainPreview,
      MAIN_PREVIEW_DEBOUNCE_MS
    );
    return () => {
      if (mainPreviewTimerRef.current)
        clearTimeout(mainPreviewTimerRef.current);
    };
  }, [open, loading, error, params, imageUrl, onMainPreviewUrlChange]);

  useEffect(() => {
    if (!open) {
      setPanelPos(null);
      return;
    }
    if (typeof document === "undefined" || typeof window === "undefined") {
      return;
    }

    let stopped = false;
    let retryTimer: ReturnType<typeof setTimeout> | null = null;
    let rafId: number | null = null;
    let trackUntil = 0;
    let observedImg: HTMLImageElement | null = null;
    let imgResizeObserver: ResizeObserver | null = null;

    const clearImageObserver = () => {
      if (imgResizeObserver) {
        imgResizeObserver.disconnect();
        imgResizeObserver = null;
      }
      observedImg = null;
    };

    const bindImageObserver = (img: HTMLImageElement) => {
      if (observedImg === img && imgResizeObserver) return;
      clearImageObserver();
      observedImg = img;
      if (typeof ResizeObserver === "undefined") return;
      imgResizeObserver = new ResizeObserver(() => {
        lockPanelPosition();
      });
      imgResizeObserver.observe(img);
    };

    const lockPanelPosition = (attempt = 0) => {
      if (stopped) return;
      const previewImg = getActivePreviewImageElement();
      if (
        !previewImg ||
        !previewImg.complete ||
        previewImg.naturalWidth <= 0 ||
        previewImg.getBoundingClientRect().height <= 0
      ) {
        if (attempt < 20) {
          retryTimer = setTimeout(() => lockPanelPosition(attempt + 1), 50);
        }
        return;
      }

      bindImageObserver(previewImg);
      const rect = previewImg.getBoundingClientRect();
      const vh = window.innerHeight || 0;
      const vw = window.innerWidth || 0;
      const maxHeight = Math.max(
        260,
        Math.min(vh - VIEWPORT_MARGIN * 2, rect.height)
      );
      const top = Math.max(
        VIEWPORT_MARGIN,
        Math.min(rect.top, vh - maxHeight - VIEWPORT_MARGIN)
      );
      // 目标锚点：图片外侧右上角；若右侧空间不足，则退到左侧外侧。
      let left = rect.right + PANEL_GAP;
      if (left + PANEL_WIDTH + VIEWPORT_MARGIN > vw) {
        left = rect.left - PANEL_WIDTH - PANEL_GAP;
      }
      left = Math.max(
        VIEWPORT_MARGIN,
        Math.min(left, vw - PANEL_WIDTH - VIEWPORT_MARGIN)
      );
      setPanelPos({ left, top, maxHeight });
    };

    // 预览打开时会有缩放/位移动画，短时间持续跟踪，直到布局稳定。
    trackUntil = Date.now() + 900;
    const trackPosition = () => {
      lockPanelPosition();
      if (!stopped && Date.now() < trackUntil) {
        rafId = window.requestAnimationFrame(trackPosition);
      }
    };
    trackPosition();

    const onResize = () => lockPanelPosition();
    window.addEventListener("resize", onResize);
    return () => {
      stopped = true;
      if (retryTimer) clearTimeout(retryTimer);
      if (rafId !== null) window.cancelAnimationFrame(rafId);
      clearImageObserver();
      window.removeEventListener("resize", onResize);
    };
  }, [open, imageUrl]);

  const handleSave = useCallback(async () => {
    const source = sourceImageDataRef.current;
    const w = sourceWidthRef.current;
    const h = sourceHeightRef.current;
    if (!source || !w || !h || !imageInfo?.url) return;
    setSaving(true);
    try {
      const canvas = document.createElement("canvas");
      canvas.width = w;
      canvas.height = h;
      const ctx = canvas.getContext("2d");
      if (!ctx) {
        messageApi.error("无法创建画布");
        return;
      }
      const copy = ctx.createImageData(w, h);
      copy.data.set(source.data);
      applyAdjustToImageData(copy, params);
      ctx.putImageData(copy, 0, 0);
      const dataUrl = canvas.toDataURL("image/png");
      const base64 = dataURLToBase64(dataUrl);

      const res = await fetch("/api/image-edit/save", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({
          imageBase64: base64,
          mimeType: "image/png",
          mode: "override",
          originalUrl: imageInfo.url
        })
      });
      const data = await res.json();
      if (!res.ok || !data?.ok) {
        messageApi.error(data?.error || "保存失败");
        return;
      }
      messageApi.success("已保存");
      onSaved({
        type: "override",
        url: String(data.url),
        originalUrl: imageInfo.url
      });
      onClose();
    } catch (e) {
      messageApi.error(e instanceof Error ? e.message : "保存失败");
    } finally {
      setSaving(false);
    }
  }, [params, imageInfo, messageApi, onSaved, onClose]);

  const handleReset = useCallback(() => {
    setParams({ ...DEFAULT_ADJUST });
  }, []);

  if (!open || !panelPos) return null;

  return (
    <div
      style={{
        position: "fixed",
        top: panelPos.top,
        left: panelPos.left,
        width: PANEL_WIDTH,
        maxHeight: panelPos.maxHeight,
        background: "rgba(22,22,26,0.96)",
        borderRadius: 12,
        boxShadow: "0 8px 32px rgba(0,0,0,0.4)",
        zIndex: 1100,
        display: "flex",
        flexDirection: "column",
        overflow: "hidden",
        border: "1px solid rgba(255,255,255,0.08)"
      }}
    >
      <div
        style={{
          padding: "12px 14px",
          borderBottom: "1px solid rgba(255,255,255,0.08)"
        }}
      >
        <Typography.Text strong style={{ color: "#fff", fontSize: 14 }}>
          调色
        </Typography.Text>
      </div>

      <div style={{ padding: 12, overflowY: "auto", flex: 1, minHeight: 0 }}>
        {loading && (
          <div
            style={{
              display: "flex",
              flexDirection: "column",
              alignItems: "center",
              gap: 10,
              padding: 24
            }}
          >
            <Spin size="large" />
            <Typography.Text
              style={{ color: "rgba(255,255,255,0.65)", fontSize: 12 }}
            >
              加载中…
            </Typography.Text>
          </div>
        )}
        {error && (
          <Typography.Text type="danger" style={{ fontSize: 12 }}>
            {error}
          </Typography.Text>
        )}
        {!loading && !error && (
          <>
            <SliderRow
              label="亮度"
              value={params.brightness}
              min={-100}
              max={100}
              onChange={(v) => setParams((p) => ({ ...p, brightness: v }))}
            />
            <SliderRow
              label="对比度"
              value={params.contrast}
              min={-100}
              max={100}
              onChange={(v) => setParams((p) => ({ ...p, contrast: v }))}
            />
            <SliderRow
              label="饱和度"
              value={params.saturation}
              min={-100}
              max={100}
              onChange={(v) => setParams((p) => ({ ...p, saturation: v }))}
            />
            <SliderRow
              label="色相"
              value={params.hue}
              min={-180}
              max={180}
              onChange={(v) => setParams((p) => ({ ...p, hue: v }))}
            />
            <SliderRow
              label="明度"
              value={params.lightness}
              min={-100}
              max={100}
              onChange={(v) => setParams((p) => ({ ...p, lightness: v }))}
            />
            <SliderRow
              label="色温"
              value={params.temperature}
              min={-100}
              max={100}
              onChange={(v) => setParams((p) => ({ ...p, temperature: v }))}
            />
          </>
        )}
      </div>

      <div
        style={{
          padding: "10px 12px",
          borderTop: "1px solid rgba(255,255,255,0.08)",
          display: "flex",
          gap: 8,
          justifyContent: "flex-end"
        }}
      >
        <Button
          size="small"
          onClick={handleReset}
          disabled={loading || !!error}
        >
          重置
        </Button>
        <Button size="small" onClick={onClose} disabled={saving}>
          取消
        </Button>
        <Button
          type="primary"
          size="small"
          loading={saving}
          disabled={loading || !!error}
          onClick={handleSave}
        >
          保存
        </Button>
      </div>
    </div>
  );
}

function SliderRow(props: {
  label: string;
  value: number;
  min: number;
  max: number;
  onChange: (v: number) => void;
}) {
  const { label, value, min, max, onChange } = props;
  const clampValue = useCallback(
    (v: number) => Math.max(min, Math.min(max, Math.round(v))),
    [min, max]
  );

  return (
    <div style={{ marginBottom: 10 }}>
      <div
        style={{
          display: "flex",
          justifyContent: "space-between",
          alignItems: "center",
          marginBottom: 4
        }}
      >
        <Typography.Text
          style={{ color: "rgba(255,255,255,0.85)", fontSize: 12 }}
        >
          {label}
        </Typography.Text>
        <InputNumber
          size="small"
          min={min}
          max={max}
          step={1}
          precision={0}
          controls={false}
          value={value}
          onChange={(v) => {
            const next = typeof v === "number" ? v : Number(v);
            if (Number.isFinite(next)) onChange(clampValue(next));
          }}
          style={{ width: 64 }}
        />
      </div>
      <Slider
        min={min}
        max={max}
        value={value}
        onChange={(v) => onChange(clampValue(Array.isArray(v) ? v[0] : v))}
        style={{ marginBottom: 0 }}
        styles={{
          track: { background: "rgba(255,255,255,0.2)" },
          rail: { background: "rgba(255,255,255,0.08)" }
        }}
      />
    </div>
  );
}
