"use client";

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import {
  AutoComplete,
  Button,
  Card,
  Form,
  Input,
  Popconfirm,
  Space,
  Table,
  Tabs,
  Typography,
  message
} from "antd";
import {
  PlusOutlined,
  PictureOutlined,
  EditOutlined,
  DeleteOutlined
} from "@ant-design/icons";
import { useRouter } from "next/navigation";
import { SUPPORTED_LANGUAGES } from "@/common/constants";
import AdminShell from "@/app/_components/AdminShell";
import * as promptFns from "@/common/prompt";
import { ConfigFormDrawer } from "./_components/ConfigFormDrawer";
import { PromptTemplatesPanel } from "./_components/PromptTemplatesPanel";
import { useConfigColumns } from "./_hooks/useConfigColumns";
import { useStickyTableScroll } from "./_hooks/useStickyTableScroll";
import type { ConfigItem, PromptTemplateItem } from "./_lib/types";
import {
  deriveGeminiMatchFields,
  deriveJimengRatioFields,
  normalizeTemplateVarsForPreview,
  normalizeThinkingLevel,
  splitLinesToList
} from "./_lib/utils";

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
      | "description"
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
  const [currentUserId, setCurrentUserId] = useState("");
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
  const [activeTab, setActiveTab] = useState("configs");
  const [templateItems, setTemplateItems] = useState<PromptTemplateItem[]>([]);
  const [templatesLoading, setTemplatesLoading] = useState(false);
  const [templateModalOpen, setTemplateModalOpen] = useState(false);
  const [templateSubmitting, setTemplateSubmitting] = useState(false);
  const [editingTemplateId, setEditingTemplateId] = useState<string | null>(
    null
  );
  const [templateForm] = Form.useForm();

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

  const fetchPromptTemplates = useCallback(async () => {
    setTemplatesLoading(true);
    try {
      const res = await fetch("/api/prompt-templates", { method: "GET" });
      const data = await res.json().catch(() => null);
      if (!res.ok || !data?.ok) {
        messageApi.error(data?.error || "获取提示词模板失败");
        return;
      }
      setTemplateItems(Array.isArray(data.items) ? data.items : []);
    } catch (e) {
      messageApi.error(e instanceof Error ? e.message : String(e));
    } finally {
      setTemplatesLoading(false);
    }
  }, [messageApi]);

  const handleSubmitPromptTemplate = useCallback(async () => {
    const values = await templateForm.validateFields();
    setTemplateSubmitting(true);
    try {
      const isEdit = Boolean(editingTemplateId);
      const res = await fetch(
        isEdit
          ? `/api/prompt-templates/${editingTemplateId}`
          : "/api/prompt-templates",
        {
          method: isEdit ? "PUT" : "POST",
          headers: { "content-type": "application/json" },
          body: JSON.stringify({
            ...(isEdit ? {} : { name: String(values.name || "").trim() }),
            description: String(values.description || "").trim() || undefined,
            template: String(values.template || "")
          })
        }
      );
      const data = await res.json().catch(() => null);
      if (!res.ok || !data?.ok) {
        messageApi.error(
          data?.error || (isEdit ? "修改模板失败" : "新增模板失败")
        );
        return;
      }
      messageApi.success(isEdit ? "修改模板成功" : "新增模板成功");
      setEditingTemplateId(null);
      setTemplateModalOpen(false);
      templateForm.resetFields();
      await fetchPromptTemplates();
    } catch (e) {
      messageApi.error(e instanceof Error ? e.message : String(e));
    } finally {
      setTemplateSubmitting(false);
    }
  }, [editingTemplateId, fetchPromptTemplates, messageApi, templateForm]);

  const handleEditPromptTemplate = useCallback(
    (row: PromptTemplateItem) => {
      setEditingTemplateId(String(row.id));
      templateForm.resetFields();
      templateForm.setFieldsValue({
        name: String(row.name || ""),
        description: String(row.description || ""),
        template: String(row.template || "")
      });
      setTemplateModalOpen(true);
    },
    [templateForm]
  );

  const handleDeletePromptTemplate = useCallback(
    async (id: string) => {
      try {
        const res = await fetch(`/api/prompt-templates/${id}`, {
          method: "DELETE"
        });
        const data = await res.json().catch(() => null);
        if (!res.ok || !data?.ok) {
          messageApi.error(data?.error || "删除模板失败");
          return;
        }
        messageApi.success("删除模板成功");
        await fetchPromptTemplates();
      } catch (e) {
        messageApi.error(e instanceof Error ? e.message : String(e));
      }
    },
    [fetchPromptTemplates, messageApi]
  );

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
          description: String(row.description || "").trim() || undefined,
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
      description: String(row.description || "").trim() || undefined,
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

  const builtinPromptTemplateRows = useMemo(() => {
    const demoParams = {
      appName: "{{appName}}",
      lang: "{{lang}}",
      prompt: "{{prompt}}",
      aspectRatio: "{{aspectRatio}}"
    };
    return Object.keys(promptFns)
      .filter((k) => typeof (promptFns as any)[k] === "function")
      .sort()
      .map((k) => {
        const fn = (promptFns as any)[k];
        let preview = "";
        try {
          preview = normalizeTemplateVarsForPreview(
            String(fn(demoParams) || "")
          );
        } catch {
          preview = "";
        }
        return {
          id: `builtin:${k}`,
          name: k,
          template: preview || "（内置函数动态生成模板）",
          description: "内置模板",
          username: "system",
          source: "builtin" as const
        };
      });
  }, []);

  const promptTmpFunNameOptions = useMemo(() => {
    const names = new Set<string>();
    const out: { label: string; value: string }[] = [];
    for (const row of builtinPromptTemplateRows) {
      if (names.has(row.name)) continue;
      names.add(row.name);
      out.push({ label: `${row.name}（内置）`, value: row.name });
    }
    for (const row of templateItems) {
      const name = String(row?.name || "").trim();
      if (!name || names.has(name)) continue;
      names.add(name);
      out.push({ label: `${name}（自定义）`, value: name });
    }
    return out.sort((a, b) => String(a.value).localeCompare(String(b.value)));
  }, [builtinPromptTemplateRows, templateItems]);

  const allPromptTemplateRows = useMemo(() => {
    const customRows = (templateItems || []).map((it) => ({
      id: it.id,
      name: String(it.name || ""),
      template: String(it.template || ""),
      description: it.description || "",
      username: it.username || "",
      createdAt: it.createdAt || "",
      updatedAt: it.updatedAt || it.createdAt || "",
      source: "custom" as const
    }));
    customRows.sort((a, b) => {
      const ta = new Date(String(a.createdAt || "")).getTime();
      const tb = new Date(String(b.createdAt || "")).getTime();
      return (Number.isFinite(tb) ? tb : 0) - (Number.isFinite(ta) ? ta : 0);
    });
    return [...customRows, ...builtinPromptTemplateRows];
  }, [builtinPromptTemplateRows, templateItems]);

  const startEditCell = useCallback(
    (
      row: ConfigItem,
      field:
        | "appName"
        | "description"
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

  const onEditRow = useCallback(
    (row: ConfigItem) => {
      form.resetFields();
      const langs0 = Array.isArray((row as any).langs)
        ? (row as any).langs
        : row.lang
        ? [row.lang]
        : [];
      const langs = Array.from(
        new Set(langs0.map((s: any) => String(s ?? "").trim()).filter(Boolean))
      );
      const rowWidth =
        typeof row.imageConfig?.width === "number"
          ? row.imageConfig.width
          : undefined;
      const rowHeight =
        typeof row.imageConfig?.height === "number"
          ? row.imageConfig.height
          : undefined;
      const geminiMatched = deriveGeminiMatchFields(rowWidth, rowHeight);
      form.setFieldsValue({
        modelProvider: row.modelProvider || "gemini",
        appName: row.appName,
        description: row.description,
        langs,
        batchFun: row.batchFun,
        promptTmpFunName: row.promptTmpFunName,
        count: row.count ?? 1,
        prompt: row.prompt,
        referenceImagesText: Array.isArray(row.referenceImages)
          ? row.referenceImages.join("\n")
          : "",
        generationConfig_temperature: row.generationConfig?.temperature ?? 1,
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
    },
    [form]
  );

  const columns = useConfigColumns({
    tableEditMode,
    savingCellMap,
    editingCell,
    editingDraft,
    setEditingDraft,
    appNameOptions,
    promptTmpFunNameOptions,
    form,
    router,
    cancelEditCell,
    commitEditCell,
    startEditCell,
    handleCopy,
    handleDelete,
    onEditRow
  });

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
    fetchPromptTemplates();
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
        setCurrentUserId(String(data?.ok ? data?.user?.userId || "" : ""));
      } catch {
        if (!mounted) return;
        setIsSuperAdmin(false);
        setCurrentUserId("");
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

  useStickyTableScroll({
    tableWrapRef,
    isNarrowScreen,
    setStickyHScroll,
    stickyHScrollRef,
    tableScrollElRef,
    syncScrollingRef,
    deps: [
      configPage,
      configPageSize,
      filterAppName,
      filterLang,
      items.length,
      loading,
      tableEditMode
    ]
  });

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
      description: String(values.description || "").trim() || undefined,
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
      <Tabs
        activeKey={activeTab}
        onChange={setActiveTab}
        items={[
          { key: "configs", label: "配置表格" },
          { key: "templates", label: "提示词模板" }
        ]}
      />
      {activeTab === "configs" ? (
        <Space orientation="vertical" size={16} style={{ width: "100%" }}>
          <Card>
            <Space wrap>
              <Button
                type="primary"
                icon={<PlusOutlined />}
                onClick={openCreate}
              >
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
      ) : (
        <PromptTemplatesPanel
          templatesLoading={templatesLoading}
          rows={allPromptTemplateRows as any[]}
          currentUserId={currentUserId}
          isSuperAdmin={isSuperAdmin}
          messageApi={messageApi}
          templateModalOpen={templateModalOpen}
          templateSubmitting={templateSubmitting}
          editingTemplateId={editingTemplateId}
          templateForm={templateForm}
          onOpenCreate={() => {
            setEditingTemplateId(null);
            templateForm.resetFields();
            setTemplateModalOpen(true);
          }}
          onRefresh={() => {
            void fetchPromptTemplates();
          }}
          onEdit={handleEditPromptTemplate}
          onDelete={(id) => {
            void handleDeletePromptTemplate(id);
          }}
          onCancelModal={() => {
            setTemplateModalOpen(false);
            setEditingTemplateId(null);
          }}
          onSubmitModal={() => {
            void handleSubmitPromptTemplate();
          }}
        />
      )}

      <ConfigFormDrawer
        editingId={editingId}
        open={open}
        submitting={submitting}
        form={form}
        appNameOptions={appNameOptions}
        promptTmpFunNameOptions={promptTmpFunNameOptions}
        uploadingReferenceImages={uploadingReferenceImages}
        watchedModelProvider={watchedModelProvider}
        refFolderInput={refFolderInput}
        refFilesInput={refFilesInput}
        onClose={() => setOpen(false)}
        onSubmit={() => {
          void submitCreate();
        }}
        uploadReferenceFiles={(files) => {
          void uploadReferenceFiles(files);
        }}
      />
    </AdminShell>
  );
}
