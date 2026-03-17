"use client";

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import {
  AutoComplete,
  Button,
  Card,
  Drawer,
  Dropdown,
  Form,
  Input,
  InputNumber,
  Popconfirm,
  Select,
  Space,
  Table,
  Typography,
  message
} from "antd";
import type { ColumnsType } from "antd/es/table";
import {
  PlusOutlined,
  PictureOutlined,
  EditOutlined,
  CopyOutlined,
  DeleteOutlined,
  UploadOutlined,
  FolderOutlined,
  FileImageOutlined
} from "@ant-design/icons";
import { useRouter } from "next/navigation";
import {
  ASPECT_RATIO_OPTIONS,
  BATCH_FUN_OPTIONS,
  RESPONSE_MODALITIES_OPTIONS,
  SUPPORTED_LANGUAGES
} from "@/common/constants";
import AdminShell from "@/app/_components/AdminShell";
import * as promptFns from "@/common/prompt";

type ConfigItem = {
  id: string;
  modelProvider?: "gemini" | "jimeng";
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

const MODEL_PROVIDER_OPTIONS = [
  { label: "谷歌", value: "gemini" },
  { label: "即梦", value: "jimeng" }
];

const THINKING_LEVEL_OPTIONS = [
  { label: "High", value: "High" },
  { label: "minimal", value: "minimal" }
];

function normalizeThinkingLevel(input: unknown): "High" | "minimal" {
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

function deriveAspectRatioLabel(
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

function deriveJimengRatioFields(
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

const GEMINI_RATIO_BASE_SIZE_1K: Record<
  string,
  { width: number; height: number }
> = {
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

function deriveGeminiMatchFields(
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

function splitLinesToList(input: string): string[] {
  return (
    (input || "")
      // Important: reference image paths / function names may legally contain commas.
      // The UI expects "one item per line", so we only split by newlines.
      .split(/\r?\n/)
      .map((s) => s.trim())
      .filter(Boolean)
  );
}

export default function ConfigsPage() {
  const router = useRouter();
  const [messageApi, contextHolder] = message.useMessage();
  const [loading, setLoading] = useState(false);
  const [items, setItems] = useState<ConfigItem[]>([]);
  const [savingCellMap, setSavingCellMap] = useState<Record<string, boolean>>(
    {}
  );
  const [tableEditMode, setTableEditMode] = useState(false);
  const [editModeBaseMap, setEditModeBaseMap] = useState<
    Record<string, ConfigItem>
  >({});
  const [draftMap, setDraftMap] = useState<Record<string, Partial<ConfigItem>>>(
    {}
  );
  const [savingEditMode, setSavingEditMode] = useState(false);
  const [editingCell, setEditingCell] = useState<{
    id: string;
    field:
      | "appName"
      | "lang"
      | "batchFun"
      | "promptTmpFunName"
      | "aspectRatio"
      | "count"
      | "prompt";
  } | null>(null);
  const [editingDraft, setEditingDraft] = useState<
    string | number | string[] | null
  >("");
  const [open, setOpen] = useState(false);
  const [submitting, setSubmitting] = useState(false);
  const [deletingBatch, setDeletingBatch] = useState(false);
  const [isSuperAdmin, setIsSuperAdmin] = useState(false);
  const [form] = Form.useForm();
  const [appNameOptions, setAppNameOptions] = useState<
    { label: string; value: string }[]
  >([]);
  const [editingId, setEditingId] = useState<string | null>(null);
  const [selectedRowKeys, setSelectedRowKeys] = useState<string[]>([]);
  const [filterAppName, setFilterAppName] = useState("");
  const [filterLang, setFilterLang] = useState("");
  const [configPage, setConfigPage] = useState(1);
  const [configPageSize, setConfigPageSize] = useState(10);
  const [uploadingReferenceImages, setUploadingReferenceImages] =
    useState(false);
  const watchedModelProvider =
    (Form.useWatch("modelProvider", form) as "gemini" | "jimeng" | undefined) ||
    "gemini";
  const watchedJimengWidth = Form.useWatch("imageConfig_width", form) as
    | number
    | undefined;
  const watchedJimengHeight = Form.useWatch("imageConfig_height", form) as
    | number
    | undefined;
  const refFolderInput = useRef<HTMLInputElement>(null);
  const refFilesInput = useRef<HTMLInputElement>(null);
  const [isNarrowScreen, setIsNarrowScreen] = useState(false);
  const tableWrapRef = useRef<HTMLDivElement | null>(null);
  const tableScrollElRef = useRef<HTMLElement | null>(null);
  const stickyHScrollRef = useRef<HTMLDivElement | null>(null);
  const syncScrollingRef = useRef<"table" | "sticky" | null>(null);
  const [stickyHScroll, setStickyHScroll] = useState<{
    visible: boolean;
    left: number;
    width: number;
    scrollWidth: number;
  }>({
    visible: false,
    left: 0,
    width: 0,
    scrollWidth: 0
  });

  const fetchList = useCallback(async () => {
    setLoading(true);
    try {
      const res = await fetch("/api/configs", { method: "GET" });
      const data = await res.json();
      if (!res.ok || !data?.ok) {
        messageApi.error(data?.error || "获取配置失败");
        return;
      }
      setItems(Array.isArray(data.items) ? data.items : []);
    } catch (e) {
      messageApi.error(e instanceof Error ? e.message : String(e));
    } finally {
      setLoading(false);
    }
  }, [messageApi]);

  const uploadReferenceFiles = useCallback(
    async (files: File[]) => {
      if (!files.length) return;
      const imageExt = /\.(png|jpe?g|gif|webp|bmp|tiff?|svg)$/i;
      const list = files.filter(
        (f) => imageExt.test(f.name) || (f.type && f.type.startsWith("image/"))
      );
      if (!list.length) {
        messageApi.warning("未包含有效图片文件");
        return;
      }
      setUploadingReferenceImages(true);
      try {
        const formData = new FormData();
        list.forEach((f) => formData.append("files", f));
        const res = await fetch("/api/reference-images/upload", {
          method: "POST",
          body: formData
        });
        const data = await res.json().catch(() => null);
        if (!res.ok || !data?.ok) {
          messageApi.error(data?.error || "上传失败");
          return;
        }
        const paths: string[] = Array.isArray(data.paths) ? data.paths : [];
        if (!paths.length) {
          messageApi.warning("没有可用的路径返回");
          return;
        }
        const current = form.getFieldValue("referenceImagesText") || "";
        const lines = (current + "\n" + paths.join("\n"))
          .split(/\r?\n/)
          .map((s) => s.trim())
          .filter(Boolean);
        form.setFieldValue(
          "referenceImagesText",
          [...new Set(lines)].join("\n")
        );
        messageApi.success(`已添加 ${paths.length} 个路径`);
      } catch (e) {
        messageApi.error(e instanceof Error ? e.message : "上传失败");
      } finally {
        setUploadingReferenceImages(false);
        if (refFolderInput.current) refFolderInput.current.value = "";
        if (refFilesInput.current) refFilesInput.current.value = "";
      }
    },
    [form, messageApi]
  );

  const handleCopy = useCallback(
    async (row: ConfigItem) => {
      try {
        const langs0 = Array.isArray((row as any).langs)
          ? (row as any).langs
          : row.lang
          ? [row.lang]
          : [];
        const langs = Array.from(
          new Set(
            langs0.map((s: any) => String(s ?? "").trim()).filter(Boolean)
          )
        );
        const payload = {
          modelProvider: row.modelProvider || "gemini",
          prompt: row.prompt,
          count: row.count ?? undefined,
          appName: row.appName || undefined,
          lang: langs.length ? langs[0] : row.lang || undefined,
          langs: langs.length ? langs : undefined,
          batchFun: row.batchFun || undefined,
          promptTmpFunName: row.promptTmpFunName || undefined,
          referenceImages:
            Array.isArray(row.referenceImages) && row.referenceImages.length
              ? row.referenceImages
              : undefined,
          nextPromptFun:
            Array.isArray(row.nextPromptFun) && row.nextPromptFun.length
              ? row.nextPromptFun
              : undefined,
          responseModalities:
            Array.isArray(row.responseModalities) &&
            row.responseModalities.length
              ? row.responseModalities
              : undefined,
          generationConfig:
            row.generationConfig && typeof row.generationConfig === "object"
              ? {
                  ...row.generationConfig,
                  thinkingLevel: normalizeThinkingLevel(
                    (row.generationConfig as any)?.thinkingLevel
                  )
                }
              : {
                  temperature: 1,
                  thinkingLevel: isSuperAdmin ? "High" : "minimal"
                },
          imageConfig:
            row.imageConfig && typeof row.imageConfig === "object"
              ? row.imageConfig
              : undefined,
          extra:
            row.extra && typeof row.extra === "object" ? row.extra : undefined
        };
        const res = await fetch("/api/configs", {
          method: "POST",
          headers: { "content-type": "application/json" },
          body: JSON.stringify(payload)
        });
        const data = await res.json();
        if (!res.ok || !data?.ok) {
          messageApi.error(data?.error || "复制失败");
          return;
        }
        messageApi.success("复制成功");
        await fetchList();
      } catch (e) {
        messageApi.error(e instanceof Error ? e.message : String(e));
      }
    },
    [fetchList, isSuperAdmin, messageApi]
  );

  const handleDelete = useCallback(
    async (id: string) => {
      try {
        const res = await fetch(`/api/configs/${id}`, { method: "DELETE" });
        const data = await res.json();
        if (!res.ok || !data?.ok) {
          messageApi.error(data?.error || "删除失败");
          return;
        }
        messageApi.success("删除成功");
        setSelectedRowKeys((prev) => prev.filter((k) => k !== id));
        if (editingId === id) {
          setOpen(false);
          setEditingId(null);
        }
        await fetchList();
      } catch (e) {
        messageApi.error(e instanceof Error ? e.message : String(e));
      }
    },
    [editingId, fetchList, messageApi]
  );

  const handleBatchDelete = useCallback(async () => {
    if (!selectedRowKeys.length) return;
    setDeletingBatch(true);
    try {
      const ids = [...selectedRowKeys];
      const results = await Promise.all(
        ids.map(async (id) => {
          try {
            const res = await fetch(`/api/configs/${id}`, { method: "DELETE" });
            const data = await res.json().catch(() => null);
            const ok = Boolean(res.ok && data?.ok);
            return {
              id,
              ok,
              error: ok ? "" : String(data?.error || "删除失败")
            };
          } catch (e) {
            return {
              id,
              ok: false,
              error: e instanceof Error ? e.message : String(e)
            };
          }
        })
      );

      const failed = results.filter((r) => !r.ok);
      if (failed.length) {
        messageApi.error(
          `删除失败 ${failed.length}/${results.length}：${failed[0]?.id} ${
            failed[0]?.error || ""
          }`
        );
      } else {
        messageApi.success(`删除成功：${results.length} 条`);
      }

      const deletedIds = results.filter((r) => r.ok).map((r) => r.id);
      setSelectedRowKeys((prev) => prev.filter((k) => !deletedIds.includes(k)));
      if (editingId && deletedIds.includes(editingId)) {
        setOpen(false);
        setEditingId(null);
      }
      await fetchList();
    } finally {
      setDeletingBatch(false);
    }
  }, [editingId, fetchList, messageApi, selectedRowKeys]);

  const buildPutPayload = useCallback((row: ConfigItem) => {
    const langs0 = Array.isArray((row as any).langs)
      ? (row as any).langs
      : row.lang
      ? [row.lang]
      : [];
    const langs = Array.from(
      new Set(langs0.map((s: any) => String(s ?? "").trim()).filter(Boolean))
    );
    return {
      modelProvider: row.modelProvider || "gemini",
      prompt: row.prompt,
      count: row.count ?? undefined,
      appName: row.appName || undefined,
      lang: langs.length ? langs[0] : row.lang || undefined,
      langs: langs.length ? langs : undefined,
      batchFun: row.batchFun || undefined,
      promptTmpFunName: row.promptTmpFunName || undefined,
      referenceImages:
        Array.isArray(row.referenceImages) && row.referenceImages.length
          ? row.referenceImages
          : undefined,
      nextPromptFun:
        Array.isArray(row.nextPromptFun) && row.nextPromptFun.length
          ? row.nextPromptFun
          : undefined,
      responseModalities:
        Array.isArray(row.responseModalities) && row.responseModalities.length
          ? row.responseModalities
          : undefined,
      generationConfig:
        row.generationConfig && typeof row.generationConfig === "object"
          ? {
              ...row.generationConfig,
              thinkingLevel: normalizeThinkingLevel(
                (row.generationConfig as any)?.thinkingLevel
              )
            }
          : undefined,
      imageConfig:
        row.imageConfig && typeof row.imageConfig === "object"
          ? row.imageConfig
          : undefined,
      extra: row.extra && typeof row.extra === "object" ? row.extra : undefined
    };
  }, []);

  const saveInlineRow = useCallback(
    async (
      nextRow: ConfigItem,
      prevRow: ConfigItem,
      savingKey: string,
      opts?: { silentSuccess?: boolean }
    ) => {
      setSavingCellMap((m) => ({ ...m, [savingKey]: true }));
      setItems((prev) =>
        prev.map((it) => (it.id === nextRow.id ? nextRow : it))
      );
      try {
        const res = await fetch(`/api/configs/${nextRow.id}`, {
          method: "PUT",
          headers: { "content-type": "application/json" },
          body: JSON.stringify(buildPutPayload(nextRow))
        });
        const data = await res.json().catch(() => null);
        if (!res.ok || !data?.ok) {
          setItems((prev) =>
            prev.map((it) => (it.id === prevRow.id ? prevRow : it))
          );
          messageApi.error(data?.error || "更新失败");
          return;
        }
        if (data?.item) {
          setItems((prev) =>
            prev.map((it) => (it.id === nextRow.id ? data.item : it))
          );
        }
        if (!opts?.silentSuccess) messageApi.success("已保存");
      } catch (e) {
        setItems((prev) =>
          prev.map((it) => (it.id === prevRow.id ? prevRow : it))
        );
        messageApi.error(e instanceof Error ? e.message : String(e));
      } finally {
        setSavingCellMap((m) => {
          const next = { ...m };
          delete next[savingKey];
          return next;
        });
      }
    },
    [buildPutPayload, messageApi]
  );

  const promptTmpFunNameOptions = useMemo(() => {
    return Object.keys(promptFns)
      .filter((k) => typeof (promptFns as any)[k] === "function")
      .sort()
      .map((k) => ({ label: k, value: k }));
  }, []);

  const startEditCell = useCallback(
    (
      row: ConfigItem,
      field:
        | "appName"
        | "lang"
        | "batchFun"
        | "promptTmpFunName"
        | "aspectRatio"
        | "count"
        | "prompt"
    ) => {
      if (!tableEditMode) return;
      if (!row?.id) return;
      if (field === "aspectRatio") return;
      const savingKey = `${row.id}:${field}`;
      if (savingCellMap[savingKey]) return;
      setEditingCell({ id: row.id, field });
      if (field === "count") {
        setEditingDraft(typeof row.count === "number" ? row.count : "");
        return;
      }
      if (field === "lang") {
        const langs0 = Array.isArray((row as any).langs)
          ? (row as any).langs
          : row.lang
          ? [row.lang]
          : [];
        const langs = Array.from(
          new Set<string>(
            langs0.map((s: any) => String(s ?? "").trim()).filter(Boolean)
          )
        );
        setEditingDraft(langs);
        return;
      }
      setEditingDraft(String((row as any)[field] || ""));
    },
    [savingCellMap, tableEditMode]
  );

  const cancelEditCell = useCallback(() => {
    setEditingCell(null);
    setEditingDraft("");
  }, []);

  const commitEditCell = useCallback(
    async (row: ConfigItem, overrideDraft?: string | number | null) => {
      if (!editingCell || editingCell.id !== row.id) return;
      const field = editingCell.field;
      const savingKey = `${row.id}:${field}`;
      if (savingCellMap[savingKey]) return;
      const draftVal =
        overrideDraft !== undefined ? overrideDraft : editingDraft;

      if (field === "count") {
        const raw =
          typeof draftVal === "number"
            ? String(draftVal)
            : String(draftVal || "").trim();
        const num = raw === "" ? undefined : Number(raw);
        if (
          raw !== "" &&
          !(typeof num === "number" && Number.isFinite(num) && num >= 0)
        ) {
          messageApi.error("count 必须是大于等于 0 的数字");
          return;
        }
        const nextVal = raw === "" ? undefined : num;
        if ((row.count ?? undefined) === nextVal) {
          cancelEditCell();
          return;
        }
        setDraftMap((m) => ({
          ...m,
          [row.id]: { ...(m[row.id] || {}), count: nextVal }
        }));
        setItems((prev) =>
          prev.map((it) => (it.id === row.id ? { ...it, count: nextVal } : it))
        );
        cancelEditCell();
        return;
      }

      if (field === "aspectRatio") {
        const nextVal = String(draftVal || "").trim();
        if (String(row.imageConfig?.aspectRatio || "") === nextVal) {
          cancelEditCell();
          return;
        }
        const nextImageConfig = {
          ...(row.imageConfig && typeof row.imageConfig === "object"
            ? row.imageConfig
            : {}),
          aspectRatio: nextVal
        };
        setDraftMap((m) => ({
          ...m,
          [row.id]: { ...(m[row.id] || {}), imageConfig: nextImageConfig }
        }));
        setItems((prev) =>
          prev.map((it) =>
            it.id === row.id ? { ...it, imageConfig: nextImageConfig } : it
          )
        );
        cancelEditCell();
        return;
      }

      if (field === "lang") {
        const langs0 = Array.isArray(draftVal)
          ? (draftVal as any[])
              .map((s) => String(s ?? "").trim())
              .filter(Boolean)
          : String(draftVal || "")
              .split(/\r?\n|[，,]/)
              .map((s) => s.trim())
              .filter(Boolean);
        const langs = Array.from(new Set(langs0));
        const nextLang = langs.length ? langs[0] : undefined;
        const prevLangs0 = Array.isArray((row as any).langs)
          ? (row as any).langs
          : row.lang
          ? [row.lang]
          : [];
        const prevLangs = Array.from(
          new Set(
            prevLangs0.map((s: any) => String(s ?? "").trim()).filter(Boolean)
          )
        );
        if (prevLangs.join("|") === langs.join("|")) {
          cancelEditCell();
          return;
        }
        const patched = {
          ...row,
          lang: nextLang,
          langs: langs.length ? langs : undefined
        } as any;
        setDraftMap((m) => ({
          ...m,
          [row.id]: {
            ...(m[row.id] || {}),
            lang: nextLang,
            langs: langs.length ? langs : undefined
          }
        }));
        setItems((prev) => prev.map((it) => (it.id === row.id ? patched : it)));
        cancelEditCell();
        return;
      }

      const nextVal =
        field === "prompt"
          ? String(draftVal || "")
          : String(draftVal || "").trim();
      if (String((row as any)[field] || "") === nextVal) {
        cancelEditCell();
        return;
      }
      const patched = { ...row, [field]: nextVal || undefined } as any;
      setDraftMap((m) => ({
        ...m,
        [row.id]: { ...(m[row.id] || {}), [field]: nextVal || undefined }
      }));
      setItems((prev) => prev.map((it) => (it.id === row.id ? patched : it)));
      cancelEditCell();
    },
    [cancelEditCell, editingCell, editingDraft, messageApi, savingCellMap]
  );

  const getCellDisplay = useCallback(
    (text: string, saving: boolean) => {
      const val = String(text || "");
      const display = val ? val : "（空）";
      const style: any = tableEditMode
        ? {
            padding: "2px 6px",
            border: "1px dashed #d9d9d9",
            borderRadius: 4,
            display: "inline-block",
            minWidth: 40,
            background: "#fafafa"
          }
        : {};
      const opacity = saving ? 0.6 : 1;
      return (
        <Typography.Text
          title={val}
          type={val ? undefined : "secondary"}
          style={{
            cursor: saving
              ? "not-allowed"
              : tableEditMode
              ? "pointer"
              : "default",
            opacity,
            ...style
          }}
        >
          {display}
        </Typography.Text>
      );
    },
    [tableEditMode]
  );

  const columns: ColumnsType<ConfigItem> = useMemo(
    () => [
      {
        title: "appName",
        dataIndex: "appName",
        key: "appName",
        width: 140,
        ellipsis: true,
        align: "center",
        render: (v, row) => {
          const field = "appName" as const;
          const savingKey = `${row.id}:${field}`;
          const saving = Boolean(savingCellMap[savingKey]);
          const isEditing =
            editingCell?.id === row.id && editingCell?.field === field;
          const text = String(v || "");
          if (isEditing) {
            return (
              <AutoComplete
                autoFocus
                options={appNameOptions}
                allowClear
                placeholder="请选择或输入 appName"
                value={String(editingDraft ?? "")}
                showSearch={{
                  filterOption: (inputValue, option) =>
                    String(option?.value || "")
                      .toLowerCase()
                      .includes(String(inputValue || "").toLowerCase())
                }}
                onChange={(val) => setEditingDraft(val)}
                onSelect={(val) => {
                  setEditingDraft(val);
                  void commitEditCell(row, val);
                }}
                onKeyDown={(e) => {
                  if (e.key === "Escape") cancelEditCell();
                  if (e.key === "Enter") void commitEditCell(row);
                }}
                onBlur={() => void commitEditCell(row)}
                style={{ width: "100%" }}
              />
            );
          }
          return (
            <span
              onClick={() => {
                if (saving) return;
                startEditCell(row, field);
              }}
            >
              {getCellDisplay(text, saving)}
            </span>
          );
        }
      },
      {
        title: "lang",
        dataIndex: "lang",
        key: "lang",
        width: 90,
        ellipsis: true,
        align: "center",
        render: (v, row) => {
          const field = "lang" as const;
          const savingKey = `${row.id}:${field}`;
          const saving = Boolean(savingCellMap[savingKey]);
          const isEditing =
            editingCell?.id === row.id && editingCell?.field === field;
          const text = String(v || "");
          const langs0 = Array.isArray((row as any).langs)
            ? (row as any).langs
            : [];
          const langs = Array.from(
            new Set(
              langs0.map((s: any) => String(s ?? "").trim()).filter(Boolean)
            )
          );
          const displayText = langs.length ? langs.join(",") : text;
          if (isEditing) {
            return (
              <Select
                autoFocus
                mode="tags"
                options={SUPPORTED_LANGUAGES.map((lang) => ({
                  label: lang,
                  value: lang
                }))}
                allowClear
                placeholder="请选择或输入语言代码（可多选）"
                value={Array.isArray(editingDraft) ? editingDraft : []}
                showSearch
                onChange={(vals) => setEditingDraft(vals as any)}
                onKeyDown={(e) => {
                  if (e.key === "Escape") cancelEditCell();
                }}
                onBlur={() => void commitEditCell(row)}
                style={{ width: "100%" }}
              />
            );
          }
          return (
            <span
              onClick={() => {
                if (saving) return;
                startEditCell(row, field);
              }}
            >
              {getCellDisplay(displayText, saving)}
            </span>
          );
        }
      },
      {
        title: "batchFun",
        dataIndex: "batchFun",
        key: "batchFun",
        width: 130,
        ellipsis: true,
        align: "center",
        render: (v, row) => {
          const field = "batchFun" as const;
          const savingKey = `${row.id}:${field}`;
          const saving = Boolean(savingCellMap[savingKey]);
          const isEditing =
            editingCell?.id === row.id && editingCell?.field === field;
          const text = String(v || "");
          if (isEditing) {
            return (
              <AutoComplete
                autoFocus
                options={BATCH_FUN_OPTIONS}
                allowClear
                placeholder="请选择或输入 batchFun"
                value={String(editingDraft ?? "")}
                showSearch={{
                  filterOption: (inputValue, option) =>
                    String(option?.value || "")
                      .toLowerCase()
                      .includes(String(inputValue || "").toLowerCase())
                }}
                onChange={(val) => setEditingDraft(val)}
                onSelect={(val) => {
                  setEditingDraft(val);
                  void commitEditCell(row, val);
                }}
                onKeyDown={(e) => {
                  if (e.key === "Escape") cancelEditCell();
                  if (e.key === "Enter") void commitEditCell(row);
                }}
                onBlur={() => void commitEditCell(row)}
                style={{ width: "100%" }}
              />
            );
          }
          return (
            <span
              onClick={() => {
                if (saving) return;
                startEditCell(row, field);
              }}
            >
              {getCellDisplay(text, saving)}
            </span>
          );
        }
      },
      {
        title: "promptTmpFunName",
        dataIndex: "promptTmpFunName",
        key: "promptTmpFunName",
        width: 160,
        ellipsis: true,
        align: "center",
        render: (v, row) => {
          const field = "promptTmpFunName" as const;
          const savingKey = `${row.id}:${field}`;
          const saving = Boolean(savingCellMap[savingKey]);
          const isEditing =
            editingCell?.id === row.id && editingCell?.field === field;
          const text = String(v || "");
          if (isEditing) {
            return (
              <AutoComplete
                autoFocus
                options={promptTmpFunNameOptions}
                allowClear
                placeholder="请选择或输入 prompt 函数"
                value={String(editingDraft ?? "")}
                showSearch={{
                  filterOption: (inputValue, option) =>
                    String(option?.value || "")
                      .toLowerCase()
                      .includes(String(inputValue || "").toLowerCase())
                }}
                onChange={(val) => setEditingDraft(val)}
                onSelect={(val) => {
                  setEditingDraft(val);
                  void commitEditCell(row, val);
                }}
                onKeyDown={(e) => {
                  if (e.key === "Escape") cancelEditCell();
                  if (e.key === "Enter") void commitEditCell(row);
                }}
                onBlur={() => void commitEditCell(row)}
                style={{ width: "100%" }}
              />
            );
          }
          return (
            <span
              onClick={() => {
                if (saving) return;
                startEditCell(row, field);
              }}
            >
              {getCellDisplay(text, saving)}
            </span>
          );
        }
      },
      {
        title: "aspectRatio",
        dataIndex: ["imageConfig", "aspectRatio"],
        key: "aspectRatio",
        width: 90,
        ellipsis: true,
        align: "center",
        render: (v, row) => {
          const field = "aspectRatio" as const;
          const savingKey = `${row.id}:${field}`;
          const saving = Boolean(savingCellMap[savingKey]);
          const isEditing =
            editingCell?.id === row.id && editingCell?.field === field;
          const width =
            typeof row.imageConfig?.width === "number"
              ? row.imageConfig.width
              : undefined;
          const height =
            typeof row.imageConfig?.height === "number"
              ? row.imageConfig.height
              : undefined;
          const provider = (row.modelProvider || "gemini").toLowerCase();
          const geminiMatched = deriveGeminiMatchFields(width, height);
          const text =
            provider === "gemini"
              ? String(geminiMatched.matchedAspectRatio || "")
              : String(v || "") ||
                String(deriveAspectRatioLabel(width, height) || "");
          if (isEditing) {
            return (
              <AutoComplete
                autoFocus
                options={ASPECT_RATIO_OPTIONS}
                allowClear
                placeholder="请选择或输入 aspectRatio"
                value={String(editingDraft ?? "")}
                onChange={(val) => setEditingDraft(val)}
                onSelect={(val) => {
                  setEditingDraft(val);
                  void commitEditCell(row, val);
                }}
                onKeyDown={(e) => {
                  if (e.key === "Escape") cancelEditCell();
                  if (e.key === "Enter") void commitEditCell(row);
                }}
                onBlur={() => void commitEditCell(row)}
                style={{ width: "100%" }}
              />
            );
          }
          return (
            <span
              onClick={() => {
                if (saving) return;
                startEditCell(row, field);
              }}
            >
              {getCellDisplay(text, saving)}
            </span>
          );
        }
      },
      {
        title: "count",
        dataIndex: "count",
        key: "count",
        width: 70,
        align: "center",
        render: (v, row) => {
          const field = "count" as const;
          const savingKey = `${row.id}:${field}`;
          const saving = Boolean(savingCellMap[savingKey]);
          const isEditing =
            editingCell?.id === row.id && editingCell?.field === field;
          const text = v === undefined || v === null ? "" : String(v);
          if (isEditing) {
            return (
              <InputNumber
                autoFocus
                min={0}
                style={{ width: "100%" }}
                value={
                  typeof editingDraft === "number"
                    ? editingDraft
                    : String(editingDraft || "").trim() === ""
                    ? null
                    : Number(editingDraft)
                }
                onChange={(val) =>
                  setEditingDraft(val === null ? "" : (val as any))
                }
                onKeyDown={(e) => {
                  if (e.key === "Escape") cancelEditCell();
                  if (e.key === "Enter") void commitEditCell(row);
                }}
                onBlur={() => void commitEditCell(row)}
              />
            );
          }
          return (
            <span
              onClick={() => {
                if (saving) return;
                startEditCell(row, field);
              }}
            >
              {getCellDisplay(text, saving)}
            </span>
          );
        }
      },
      {
        title: "prompt",
        dataIndex: "prompt",
        key: "prompt",
        width: 360,
        align: "center",
        onCell: () => ({ style: { whiteSpace: "normal" } }),
        render: (v, row) => {
          const field = "prompt" as const;
          const savingKey = `${row.id}:${field}`;
          const saving = Boolean(savingCellMap[savingKey]);
          const isEditing =
            editingCell?.id === row.id && editingCell?.field === field;
          const text = String(v || "");
          if (isEditing) {
            return (
              <Input.TextArea
                autoFocus
                rows={3}
                value={String(editingDraft ?? "")}
                onChange={(e) => setEditingDraft(e.target.value)}
                onKeyDown={(e) => {
                  if (e.key === "Escape") cancelEditCell();
                  if (e.key === "Enter" && (e.ctrlKey || e.metaKey))
                    void commitEditCell(row);
                }}
                onBlur={() => void commitEditCell(row)}
              />
            );
          }
          return (
            <Typography.Paragraph
              title={text}
              style={{
                margin: 0,
                cursor: saving ? "not-allowed" : "pointer",
                opacity: saving ? 0.6 : 1
              }}
              ellipsis={{
                rows: 2,
                tooltip: text,
                expandable: true,
                symbol: (
                  <span
                    onClick={(e) => {
                      e.stopPropagation();
                    }}
                  >
                    展开
                  </span>
                )
              }}
              onClick={() => {
                if (saving) return;
                startEditCell(row, field);
              }}
            >
              {text}
            </Typography.Paragraph>
          );
        }
      },
      {
        title: "操作",
        key: "actions",
        width: 180,
        align: "center",
        render: (_v, row) => (
          <Space orientation="vertical" size={6}>
            <Space size={6}>
              <Button
                size="small"
                icon={<EditOutlined />}
                onClick={() => {
                  form.resetFields();
                  const langs0 = Array.isArray((row as any).langs)
                    ? (row as any).langs
                    : row.lang
                    ? [row.lang]
                    : [];
                  const langs = Array.from(
                    new Set(
                      langs0
                        .map((s: any) => String(s ?? "").trim())
                        .filter(Boolean)
                    )
                  );
                  const rowWidth =
                    typeof row.imageConfig?.width === "number"
                      ? row.imageConfig.width
                      : undefined;
                  const rowHeight =
                    typeof row.imageConfig?.height === "number"
                      ? row.imageConfig.height
                      : undefined;
                  const geminiMatched = deriveGeminiMatchFields(
                    rowWidth,
                    rowHeight
                  );
                  form.setFieldsValue({
                    modelProvider: row.modelProvider || "gemini",
                    appName: row.appName,
                    langs,
                    batchFun: row.batchFun,
                    promptTmpFunName: row.promptTmpFunName,
                    count: row.count ?? 1,
                    prompt: row.prompt,
                    referenceImagesText: Array.isArray(row.referenceImages)
                      ? row.referenceImages.join("\n")
                      : "",
                    generationConfig_temperature:
                      row.generationConfig?.temperature ?? 1,
                    generationConfig_thinkingLevel: normalizeThinkingLevel(
                      row.generationConfig?.thinkingLevel
                    ),
                    imageConfig_width: rowWidth,
                    imageConfig_height: rowHeight,
                    imageConfig_matchedAspectRatio:
                      (row.modelProvider || "gemini") === "gemini"
                        ? geminiMatched.matchedAspectRatio
                        : undefined,
                    imageConfig_matchedResolution:
                      (row.modelProvider || "gemini") === "gemini"
                        ? geminiMatched.matchedResolutionText
                        : undefined,
                    imageConfig_minRatio:
                      typeof row.imageConfig?.minRatio === "number"
                        ? row.imageConfig.minRatio
                        : undefined,
                    imageConfig_maxRatio:
                      typeof row.imageConfig?.maxRatio === "number"
                        ? row.imageConfig.maxRatio
                        : undefined,
                    imageConfig_aspectRatio: row.imageConfig?.aspectRatio,
                    responseModalities: Array.isArray(row.responseModalities)
                      ? row.responseModalities
                      : ["IMAGE"],
                    nextPromptFunText: Array.isArray(row.nextPromptFun)
                      ? row.nextPromptFun.join("\n")
                      : "",
                    extraJson: row.extra
                      ? (() => {
                          try {
                            return JSON.stringify(row.extra);
                          } catch {
                            return "";
                          }
                        })()
                      : ""
                  });
                  setEditingId(row.id);
                  setOpen(true);
                }}
              >
                编辑
              </Button>
              <Button
                size="small"
                icon={<CopyOutlined />}
                onClick={() => handleCopy(row)}
              >
                复制
              </Button>
            </Space>
            <Space size={6}>
              <Button
                size="small"
                icon={<PictureOutlined />}
                onClick={() => {
                  router.push(
                    `/batch?configIds=${encodeURIComponent(row.id)}&autoStart=1`
                  );
                }}
              >
                生图
              </Button>
              <Popconfirm
                title="确认删除该配置？"
                okText="删除"
                cancelText="取消"
                onConfirm={() => handleDelete(row.id)}
              >
                <Button size="small" danger icon={<DeleteOutlined />}>
                  删除
                </Button>
              </Popconfirm>
            </Space>
          </Space>
        )
      }
    ],
    [
      appNameOptions,
      cancelEditCell,
      commitEditCell,
      editingCell,
      editingDraft,
      form,
      getCellDisplay,
      handleCopy,
      handleDelete,
      promptTmpFunNameOptions,
      router,
      savingCellMap,
      startEditCell
    ]
  );

  const fetchAppNameOptions = async () => {
    try {
      const res = await fetch("/api/app-names", { method: "GET" });
      const data = await res.json();
      if (res.ok && data?.ok && Array.isArray(data.items)) {
        setAppNameOptions(
          data.items.map((name: string) => ({ label: name, value: name }))
        );
      }
    } catch (e) {
      console.error("获取 appName 选项失败:", e);
    }
  };

  useEffect(() => {
    fetchList();
    fetchAppNameOptions();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  useEffect(() => {
    let mounted = true;
    (async () => {
      try {
        const res = await fetch("/api/auth/me", {
          method: "GET",
          cache: "no-store",
          credentials: "include"
        });
        const data = await res.json().catch(() => null);
        if (!mounted) return;
        setIsSuperAdmin(Boolean(data?.ok && data?.user?.isSuperAdmin));
      } catch {
        if (!mounted) return;
        setIsSuperAdmin(false);
      }
    })();
    return () => {
      mounted = false;
    };
  }, []);

  useEffect(() => {
    if (watchedModelProvider !== "jimeng") return;
    const derived = deriveJimengRatioFields(
      watchedJimengWidth,
      watchedJimengHeight
    );
    form.setFieldsValue({
      imageConfig_aspectRatio: derived.aspectRatio,
      imageConfig_minRatio: derived.minRatio,
      imageConfig_maxRatio: derived.maxRatio
    });
  }, [form, watchedJimengHeight, watchedJimengWidth, watchedModelProvider]);

  useEffect(() => {
    if (watchedModelProvider !== "gemini") {
      form.setFieldsValue({
        imageConfig_matchedAspectRatio: undefined,
        imageConfig_matchedResolution: undefined
      });
      return;
    }
    const derived = deriveGeminiMatchFields(
      watchedJimengWidth,
      watchedJimengHeight
    );
    form.setFieldsValue({
      imageConfig_matchedAspectRatio: derived.matchedAspectRatio,
      imageConfig_matchedResolution: derived.matchedResolutionText
    });
  }, [form, watchedJimengHeight, watchedJimengWidth, watchedModelProvider]);

  useEffect(() => {
    const mql = window.matchMedia("(max-width: 1919px)");
    const apply = () => setIsNarrowScreen(Boolean(mql.matches));
    apply();
    // Safari/旧浏览器兼容（matchMedia 旧 API）
    if ("addEventListener" in mql) {
      mql.addEventListener("change", apply);
      return () => mql.removeEventListener("change", apply);
    }
    (mql as any).addListener?.(apply);
    return () => (mql as any).removeListener?.(apply);
  }, []);

  // 固定屏幕底部的横向滚动条：<1920 时常驻显示，并与 AntD Table 横向滚动同步
  useEffect(() => {
    const wrap = tableWrapRef.current;
    if (!wrap) return;

    if (!isNarrowScreen) {
      setStickyHScroll((prev) =>
        prev.visible ? { ...prev, visible: false } : prev
      );
      return;
    }

    const findScrollEl = () =>
      (wrap.querySelector(".ant-table-content") as HTMLElement | null) ||
      (wrap.querySelector(".ant-table-body") as HTMLElement | null) ||
      null;

    const update = () => {
      const sc = findScrollEl();
      tableScrollElRef.current = sc;

      const rect = wrap.getBoundingClientRect();
      const width = Math.max(0, Math.floor(rect.width));
      const left = Math.floor(rect.left);

      const scrollWidth0 = sc ? Math.floor(sc.scrollWidth || 0) : 0;
      const clientWidth0 = sc ? Math.floor(sc.clientWidth || 0) : 0;
      // “常驻”：只要能找到表格滚动容器，就显示底部条；是否能滚动由 scrollWidth 决定
      const visible = Boolean(sc);
      const scrollWidth = Math.max(scrollWidth0, clientWidth0 + 2);

      setStickyHScroll((prev) => {
        const next = { visible, left, width, scrollWidth };
        if (
          prev.visible === next.visible &&
          prev.left === next.left &&
          prev.width === next.width &&
          prev.scrollWidth === next.scrollWidth
        ) {
          return prev;
        }
        return next;
      });

      // 同步当前 scrollLeft
      if (visible && sc && stickyHScrollRef.current) {
        stickyHScrollRef.current.scrollLeft = sc.scrollLeft;
      }
    };

    const onTableScroll = () => {
      const sc = tableScrollElRef.current;
      const sticky = stickyHScrollRef.current;
      if (!sc || !sticky) return;
      if (syncScrollingRef.current === "sticky") return;
      syncScrollingRef.current = "table";
      sticky.scrollLeft = sc.scrollLeft;
      queueMicrotask(() => {
        if (syncScrollingRef.current === "table")
          syncScrollingRef.current = null;
      });
    };

    const onStickyScroll = () => {
      const sc = tableScrollElRef.current;
      const sticky = stickyHScrollRef.current;
      if (!sc || !sticky) return;
      if (syncScrollingRef.current === "table") return;
      syncScrollingRef.current = "sticky";
      sc.scrollLeft = sticky.scrollLeft;
      queueMicrotask(() => {
        if (syncScrollingRef.current === "sticky")
          syncScrollingRef.current = null;
      });
    };

    const ro = new ResizeObserver(() => update());
    ro.observe(wrap);

    // 初次与后续重算
    const raf = requestAnimationFrame(update);
    window.addEventListener("resize", update);

    const sc0 = findScrollEl();
    if (sc0) sc0.addEventListener("scroll", onTableScroll, { passive: true });
    const sticky0 = stickyHScrollRef.current;
    if (sticky0)
      sticky0.addEventListener("scroll", onStickyScroll, { passive: true });

    return () => {
      cancelAnimationFrame(raf);
      window.removeEventListener("resize", update);
      ro.disconnect();
      const sc = findScrollEl();
      if (sc) sc.removeEventListener("scroll", onTableScroll as any);
      if (sticky0) sticky0.removeEventListener("scroll", onStickyScroll as any);
    };
  }, [
    configPage,
    configPageSize,
    filterAppName,
    filterLang,
    isNarrowScreen,
    items.length,
    loading,
    tableEditMode
  ]);

  useEffect(() => {
    setConfigPage(1);
  }, [filterAppName, filterLang]);

  const filteredItems = useMemo(() => {
    const qApp = String(filterAppName || "")
      .trim()
      .toLowerCase();
    const qLang = String(filterLang || "")
      .trim()
      .toLowerCase();
    if (!qApp && !qLang) return items;
    return (items || []).filter((it) => {
      if (qApp) {
        const v = String(it?.appName ?? "").toLowerCase();
        if (!v.includes(qApp)) return false;
      }
      if (qLang) {
        const langs0: any[] = Array.isArray((it as any)?.langs)
          ? (it as any).langs
          : it?.lang
          ? [it.lang]
          : [];
        const langs = Array.from(
          new Set(
            langs0.map((s: any) => String(s ?? "").trim()).filter(Boolean)
          )
        );
        if (!langs.some((x) => x.toLowerCase().includes(qLang))) return false;
      }
      return true;
    });
  }, [filterAppName, filterLang, items]);

  const openCreate = () => {
    form.resetFields();
    const geminiMatched = deriveGeminiMatchFields(1024, 1024);
    form.setFieldsValue({
      modelProvider: "gemini",
      count: 1,
      imageConfig_width: 1024,
      imageConfig_height: 1024,
      imageConfig_matchedAspectRatio: geminiMatched.matchedAspectRatio,
      imageConfig_matchedResolution: geminiMatched.matchedResolutionText,
      generationConfig_temperature: 1,
      generationConfig_thinkingLevel: isSuperAdmin ? "High" : "minimal",
      responseModalities: ["IMAGE"]
    });
    setEditingId(null);
    setOpen(true);
  };

  const submitCreate = async () => {
    const values = await form.validateFields();
    const referenceImages = splitLinesToList(values.referenceImagesText || "");
    const nextPromptFun = splitLinesToList(values.nextPromptFunText || "");
    const langs0 = Array.isArray(values.langs)
      ? values.langs.map((s: any) => String(s ?? "").trim()).filter(Boolean)
      : [];
    const langs = Array.from(new Set(langs0));
    const modelProvider =
      String(values.modelProvider || "gemini")
        .trim()
        .toLowerCase() === "jimeng"
        ? "jimeng"
        : "gemini";
    const inputWidthRaw =
      values.imageConfig_width === undefined ||
      values.imageConfig_width === null ||
      values.imageConfig_width === ""
        ? undefined
        : Number(values.imageConfig_width);
    const inputHeightRaw =
      values.imageConfig_height === undefined ||
      values.imageConfig_height === null ||
      values.imageConfig_height === ""
        ? undefined
        : Number(values.imageConfig_height);
    const inputWidth =
      typeof inputWidthRaw === "number" && Number.isFinite(inputWidthRaw)
        ? Math.floor(inputWidthRaw)
        : undefined;
    const inputHeight =
      typeof inputHeightRaw === "number" && Number.isFinite(inputHeightRaw)
        ? Math.floor(inputHeightRaw)
        : undefined;
    const jimengDerived =
      modelProvider === "jimeng"
        ? deriveJimengRatioFields(inputWidth, inputHeight)
        : {};

    if (modelProvider === "gemini") {
      if (!inputWidth || !inputHeight || inputWidth <= 0 || inputHeight <= 0) {
        messageApi.error("Gemini 模式下必须填写有效的 width 和 height");
        return;
      }
    }

    if (modelProvider === "jimeng") {
      if (!inputWidth || !inputHeight || inputWidth <= 0 || inputHeight <= 0) {
        messageApi.error("即梦模式下必须填写有效的 width 和 height");
        return;
      }
      const area = inputWidth * inputHeight;
      if (area < 1024 * 1024 || area > 4096 * 4096) {
        messageApi.error(
          "即梦模式下宽高乘积必须在 1024*1024 到 4096*4096 之间"
        );
        return;
      }
    }

    const payload = {
      modelProvider,
      prompt: values.prompt,
      count: values.count ?? undefined,
      appName: values.appName || undefined,
      lang: langs.length ? langs[0] : undefined,
      langs: langs.length ? langs : undefined,
      batchFun: values.batchFun || undefined,
      promptTmpFunName: values.promptTmpFunName || undefined,
      referenceImages: referenceImages.length ? referenceImages : undefined,
      nextPromptFun: nextPromptFun.length ? nextPromptFun : undefined,
      responseModalities: Array.isArray(values.responseModalities)
        ? modelProvider === "gemini"
          ? values.responseModalities
          : undefined
        : undefined,
      generationConfig: {
        ...(modelProvider === "gemini"
          ? { temperature: values.generationConfig_temperature }
          : {}),
        thinkingLevel: normalizeThinkingLevel(
          values.generationConfig_thinkingLevel
        )
      },
      imageConfig:
        modelProvider === "jimeng"
          ? {
              width: inputWidth,
              height: inputHeight,
              minRatio: jimengDerived.minRatio,
              maxRatio: jimengDerived.maxRatio,
              aspectRatio: jimengDerived.aspectRatio
            }
          : {
              width: inputWidth,
              height: inputHeight
            },
      extra: values.extraJson
        ? (() => {
            try {
              return JSON.parse(values.extraJson);
            } catch {
              return undefined;
            }
          })()
        : undefined
    };

    setSubmitting(true);
    try {
      const isEdit = Boolean(editingId);
      const url = isEdit ? `/api/configs/${editingId}` : "/api/configs";
      const res = await fetch(url, {
        method: isEdit ? "PUT" : "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify(payload)
      });
      const data = await res.json();
      if (!res.ok || !data?.ok) {
        messageApi.error(data?.error || (isEdit ? "更新失败" : "新增失败"));
        return;
      }
      messageApi.success(isEdit ? "更新成功" : "新增成功");
      setOpen(false);
      setEditingId(null);
      await fetchList();
    } finally {
      setSubmitting(false);
    }
  };

  return (
    <AdminShell defaultSelectedKey="/configs">
      {contextHolder}
      <Space orientation="vertical" size={16} style={{ width: "100%" }}>
        <Card>
          <Space wrap>
            <Button type="primary" icon={<PlusOutlined />} onClick={openCreate}>
              新增配置
            </Button>
            <Typography.Text strong>筛选：</Typography.Text>
            <AutoComplete
              style={{ width: 180 }}
              value={filterAppName}
              options={appNameOptions}
              onChange={(v) => setFilterAppName(String(v || ""))}
              showSearch={{
                filterOption: (inputValue, option) => {
                  const v = String(option?.value ?? "");
                  const l = String((option as any)?.label ?? "");
                  const q = String(inputValue || "").toLowerCase();
                  return (
                    v.toLowerCase().includes(q) || l.toLowerCase().includes(q)
                  );
                }
              }}
            >
              <Input allowClear placeholder="appName" />
            </AutoComplete>
            <AutoComplete
              style={{ width: 100 }}
              value={filterLang}
              options={SUPPORTED_LANGUAGES.map((x) => ({ value: x }))}
              onChange={(v) => setFilterLang(String(v || ""))}
              showSearch={{
                filterOption: (inputValue, option) =>
                  String(option?.value ?? "")
                    .toLowerCase()
                    .includes(String(inputValue || "").toLowerCase())
              }}
            >
              <Input allowClear placeholder="lang" />
            </AutoComplete>
            {!tableEditMode ? (
              <Button
                icon={<EditOutlined />}
                disabled={loading || deletingBatch}
                onClick={() => {
                  const base: Record<string, ConfigItem> = {};
                  items.forEach((it) => {
                    if (it?.id) base[it.id] = it;
                  });
                  setEditModeBaseMap(base);
                  setDraftMap({});
                  setEditingCell(null);
                  setEditingDraft("");
                  setTableEditMode(true);
                }}
              >
                进入编辑模式
              </Button>
            ) : (
              <Button
                type="primary"
                loading={savingEditMode}
                onClick={async () => {
                  const ids = Object.keys(draftMap || {});
                  if (!ids.length) {
                    setTableEditMode(false);
                    setEditModeBaseMap({});
                    setDraftMap({});
                    messageApi.success("未修改，无需保存");
                    return;
                  }
                  setSavingEditMode(true);
                  try {
                    const failures: { id: string; error: string }[] = [];
                    for (const id of ids) {
                      const baseRow = editModeBaseMap[id];
                      const currentRow = items.find((it) => it.id === id);
                      if (!baseRow || !currentRow) continue;
                      try {
                        await saveInlineRow(
                          currentRow,
                          baseRow,
                          `${id}:__editmode__`,
                          { silentSuccess: true }
                        );
                      } catch (e) {
                        failures.push({
                          id,
                          error: e instanceof Error ? e.message : String(e)
                        });
                      }
                    }
                    if (failures.length) {
                      messageApi.error(
                        `保存失败 ${failures.length}/${ids.length}：${
                          failures[0]?.id
                        } ${failures[0]?.error || ""}`
                      );
                      return;
                    }
                    messageApi.success(`保存成功：${ids.length} 条`);
                    setTableEditMode(false);
                    setEditModeBaseMap({});
                    setDraftMap({});
                    setEditingCell(null);
                    setEditingDraft("");
                  } finally {
                    setSavingEditMode(false);
                  }
                }}
              >
                退出编辑模式并保存
              </Button>
            )}
            <Button
              icon={<PictureOutlined />}
              disabled={!selectedRowKeys.length}
              onClick={() => {
                const qs = encodeURIComponent(selectedRowKeys.join(","));
                router.push(`/batch?configIds=${qs}`);
              }}
            >
              选择配置去生图
            </Button>
            <Popconfirm
              title={`确认删除选中的 ${selectedRowKeys.length} 条配置？`}
              okText="删除"
              cancelText="取消"
              onConfirm={handleBatchDelete}
              disabled={!selectedRowKeys.length}
            >
              <Button
                danger
                icon={<DeleteOutlined />}
                disabled={!selectedRowKeys.length}
                loading={deletingBatch}
              >
                删除
              </Button>
            </Popconfirm>
          </Space>
        </Card>

        <Card>
          <style jsx global>{`
            /* 固定底部横向滚动条（同步表格横向滚动） */
            .configsStickyHScroll {
              height: 14px;
              overflow-x: scroll; /* 尽量保持滚动条常驻显示 */
              overflow-y: hidden;
              background: rgba(255, 255, 255, 0.92);
              backdrop-filter: blur(6px);
              border-top: 1px solid rgba(0, 0, 0, 0.06);
            }
            .configsStickyHScroll::-webkit-scrollbar {
              height: 10px;
            }
            .configsStickyHScroll::-webkit-scrollbar-thumb {
              background: rgba(0, 0, 0, 0.18);
              border-radius: 999px;
            }
          `}</style>

          <div
            ref={tableWrapRef}
            style={{
              paddingBottom: isNarrowScreen && stickyHScroll.visible ? 14 : 0
            }}
          >
            <Table
              rowKey="id"
              loading={loading}
              columns={columns}
              dataSource={filteredItems}
              tableLayout="fixed"
              // 强制表格在窄屏使用自身横向滚动，避免 UI 直接溢出
              scroll={{ x: "max-content" }}
              pagination={{
                current: configPage,
                pageSize: configPageSize,
                showSizeChanger: true,
                pageSizeOptions: ["10", "20", "50", "100"],
                showTotal: (total) => {
                  const pages = Math.max(
                    1,
                    Math.ceil(
                      (Number(total) || 0) / (Number(configPageSize) || 10)
                    )
                  );
                  return `共 ${total} 条 / ${pages} 页`;
                },
                onChange: (page, pageSize) => {
                  if (pageSize !== configPageSize) {
                    setConfigPageSize(pageSize);
                    setConfigPage(1);
                  } else {
                    setConfigPage(page);
                  }
                }
              }}
              rowSelection={{
                selectedRowKeys,
                onChange: (keys) => setSelectedRowKeys(keys as string[])
              }}
            />
          </div>

          {isNarrowScreen && stickyHScroll.visible ? (
            <div
              ref={stickyHScrollRef}
              className="configsStickyHScroll"
              style={{
                position: "fixed",
                left: stickyHScroll.left,
                bottom: 0,
                width: stickyHScroll.width,
                zIndex: 999
              }}
            >
              {/* 只用来撑出 scrollWidth，从而生成滚动条 */}
              <div style={{ width: stickyHScroll.scrollWidth, height: 1 }} />
            </div>
          ) : null}
        </Card>
      </Space>

      <Drawer
        title={editingId ? "编辑生图配置" : "新增生图配置"}
        open={open}
        onClose={() => setOpen(false)}
        size={720}
        extra={
          <Space>
            <Button onClick={() => setOpen(false)}>取消</Button>
            <Button type="primary" loading={submitting} onClick={submitCreate}>
              保存
            </Button>
          </Space>
        }
      >
        <Form form={form} layout="vertical">
          <Form.Item name="modelProvider" label="生图模型">
            <Select options={MODEL_PROVIDER_OPTIONS} />
          </Form.Item>
          <Form.Item name="appName" label="appName">
            <AutoComplete
              options={appNameOptions}
              allowClear
              placeholder="请选择或输入 appName"
              showSearch={{
                filterOption: (inputValue, option) =>
                  String(option?.value || "")
                    .toLowerCase()
                    .includes(String(inputValue || "").toLowerCase())
              }}
            />
          </Form.Item>
          <Form.Item name="langs" label="lang">
            <Select
              mode="tags"
              options={SUPPORTED_LANGUAGES.map((lang) => ({
                label: lang,
                value: lang
              }))}
              allowClear
              placeholder="请选择或输入语言代码（可多选）"
              showSearch
            />
          </Form.Item>
          <Form.Item name="batchFun" label="batchFun">
            <AutoComplete
              options={BATCH_FUN_OPTIONS}
              allowClear
              placeholder="请选择或输入 batchFun"
              showSearch={{
                filterOption: (inputValue, option) =>
                  String(option?.value || "")
                    .toLowerCase()
                    .includes(String(inputValue || "").toLowerCase())
              }}
            />
          </Form.Item>
          <Form.Item name="promptTmpFunName" label="promptTmpFunName">
            <AutoComplete
              options={promptTmpFunNameOptions}
              allowClear
              placeholder="请选择或输入 prompt 函数"
              showSearch={{
                filterOption: (inputValue, option) =>
                  String(option?.value || "")
                    .toLowerCase()
                    .includes(String(inputValue || "").toLowerCase())
              }}
            />
          </Form.Item>
          <Form.Item name="count" label="count">
            <InputNumber min={0} style={{ width: "100%" }} />
          </Form.Item>
          <Form.Item name="prompt" label="prompt">
            <Input.TextArea rows={5} placeholder="描述要生成的图片" />
          </Form.Item>

          <Form.Item
            name="referenceImagesText"
            label={
              <Space>
                <span>referenceImages（每行一个路径/URL）</span>
                <Dropdown
                  menu={{
                    items: [
                      {
                        key: "folder",
                        icon: <FolderOutlined />,
                        label: "选择文件夹",
                        onClick: () => refFolderInput.current?.click()
                      },
                      {
                        key: "files",
                        icon: <FileImageOutlined />,
                        label: "选择多张图片",
                        onClick: () => refFilesInput.current?.click()
                      }
                    ]
                  }}
                >
                  <Button
                    size="small"
                    icon={<UploadOutlined />}
                    loading={uploadingReferenceImages}
                  >
                    上传
                  </Button>
                </Dropdown>
                <input
                  ref={refFolderInput}
                  type="file"
                  multiple
                  {...({ webkitdirectory: "", directory: "" } as any)}
                  accept="image/*"
                  style={{ display: "none" }}
                  onChange={(e) => {
                    const files = e.target.files
                      ? Array.from(e.target.files)
                      : [];
                    uploadReferenceFiles(files);
                  }}
                />
                <input
                  ref={refFilesInput}
                  type="file"
                  multiple
                  accept="image/*"
                  style={{ display: "none" }}
                  onChange={(e) => {
                    const files = e.target.files
                      ? Array.from(e.target.files)
                      : [];
                    uploadReferenceFiles(files);
                  }}
                />
              </Space>
            }
          >
            <Input.TextArea
              rows={4}
              placeholder="public/material/...\nhttps://..."
            />
          </Form.Item>

          {watchedModelProvider === "gemini" ? (
            <>
              <Form.Item
                name="generationConfig_temperature"
                label="generationConfig.temperature"
              >
                <InputNumber step={0.1} style={{ width: "100%" }} />
              </Form.Item>

              <Form.Item
                name="imageConfig_width"
                label="imageConfig.width"
                extra="输入目标输出宽度；服务端将自动匹配 Gemini 支持的比例与 1K/2K/4K 分辨率"
              >
                <InputNumber min={1} precision={0} style={{ width: "100%" }} />
              </Form.Item>
              <Form.Item
                name="imageConfig_height"
                label="imageConfig.height"
                extra="输入目标输出高度；最终会按阈值规则进行拉伸或等比缩放"
              >
                <InputNumber min={1} precision={0} style={{ width: "100%" }} />
              </Form.Item>
              <Form.Item
                name="imageConfig_matchedAspectRatio"
                label="system.matchedAspectRatio"
                extra="系统根据输入宽高自动匹配的 Gemini 支持比例（只读）"
              >
                <Input readOnly placeholder="请输入 width / height" />
              </Form.Item>
              <Form.Item
                name="imageConfig_matchedResolution"
                label="system.matchedResolution"
                extra="系统根据输入宽高自动匹配的 Gemini 分辨率档位（只读）"
              >
                <Input readOnly placeholder="请输入 width / height" />
              </Form.Item>

              <Form.Item name="responseModalities" label="responseModalities">
                <Select mode="tags" options={RESPONSE_MODALITIES_OPTIONS} />
              </Form.Item>
            </>
          ) : (
            <>
              <Form.Item
                name="imageConfig_width"
                label="imageConfig.width"
                extra="即梦模式下自定义输出宽度"
              >
                <InputNumber min={1} precision={0} style={{ width: "100%" }} />
              </Form.Item>
              <Form.Item
                name="imageConfig_height"
                label="imageConfig.height"
                extra="即梦模式下自定义输出高度"
              >
                <InputNumber min={1} precision={0} style={{ width: "100%" }} />
              </Form.Item>
              <Form.Item
                name="imageConfig_aspectRatio"
                label="imageConfig.aspectRatio"
                extra="根据宽高自动计算"
              >
                <Input readOnly />
              </Form.Item>
              <Form.Item
                name="imageConfig_minRatio"
                label="imageConfig.minRatio"
                extra="根据宽高自动填充"
              >
                <InputNumber disabled style={{ width: "100%" }} />
              </Form.Item>
              <Form.Item
                name="imageConfig_maxRatio"
                label="imageConfig.maxRatio"
                extra="根据宽高自动填充"
              >
                <InputNumber disabled style={{ width: "100%" }} />
              </Form.Item>
            </>
          )}
          <Form.Item
            name="generationConfig_thinkingLevel"
            label="思考等级（thinkingLevel）"
          >
            <Select options={THINKING_LEVEL_OPTIONS} />
          </Form.Item>
        </Form>
      </Drawer>
    </AdminShell>
  );
}
