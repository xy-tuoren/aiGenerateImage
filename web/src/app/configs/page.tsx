"use client";

import { useCallback, useEffect, useMemo, useState } from "react";
import { AutoComplete, Button, Card, Drawer, Form, Input, InputNumber, Popconfirm, Select, Space, Table, Typography, message } from "antd";
import type { ColumnsType } from "antd/es/table";
import { PlusOutlined, PictureOutlined, EditOutlined, CopyOutlined, DeleteOutlined, CloudDownloadOutlined } from "@ant-design/icons";
import { useRouter } from "next/navigation";
import { ASPECT_RATIO_OPTIONS, BATCH_FUN_OPTIONS, IMAGE_SIZE_OPTIONS, RESPONSE_MODALITIES_OPTIONS, SUPPORTED_LANGUAGES } from "@/common/constants";
import AdminShell from "@/app/_components/AdminShell";
import * as promptFns from "@/common/prompt";

type ConfigItem = {
  id: string;
  prompt: string;
  referenceImages?: string[];
  generationConfig?: { temperature?: number; [k: string]: unknown };
  imageConfig?: { imageSize?: string; aspectRatio?: string; [k: string]: unknown };
  responseModalities?: string[];
  count?: number;
  nextPromptFun?: string[];
  appName?: string;
  lang?: string;
  batchFun?: string;
  promptTmpFunName?: string;
  extra?: Record<string, unknown>;
  createdAt?: string;
};

function splitLinesToList(input: string): string[] {
  return (input || "")
    .split(/\r?\n|[，,]/)
    .map((s) => s.trim())
    .filter(Boolean);
}

export default function ConfigsPage() {
  const router = useRouter();
  const [messageApi, contextHolder] = message.useMessage();
  const [loading, setLoading] = useState(false);
  const [items, setItems] = useState<ConfigItem[]>([]);
  const [fetchingReferenceImages, setFetchingReferenceImages] = useState(false);
  const [savingCellMap, setSavingCellMap] = useState<Record<string, boolean>>({});
  const [tableEditMode, setTableEditMode] = useState(false);
  const [editModeBaseMap, setEditModeBaseMap] = useState<Record<string, ConfigItem>>({});
  const [draftMap, setDraftMap] = useState<Record<string, Partial<ConfigItem>>>({});
  const [savingEditMode, setSavingEditMode] = useState(false);
  const [editingCell, setEditingCell] = useState<{ id: string; field: "appName" | "lang" | "batchFun" | "promptTmpFunName" | "aspectRatio" | "count" | "prompt" } | null>(null);
  const [editingDraft, setEditingDraft] = useState<string | number | null>("");
  const [open, setOpen] = useState(false);
  const [submitting, setSubmitting] = useState(false);
  const [deletingBatch, setDeletingBatch] = useState(false);
  const [form] = Form.useForm();
  const [appNameOptions, setAppNameOptions] = useState<{ label: string; value: string }[]>([]);
  const [editingId, setEditingId] = useState<string | null>(null);
  const [selectedRowKeys, setSelectedRowKeys] = useState<string[]>([]);
  const [configPage, setConfigPage] = useState(1);
  const [configPageSize, setConfigPageSize] = useState(10);

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

  const handleFetchReferenceImages = useCallback(async () => {
    setFetchingReferenceImages(true);
    try {
      const res = await fetch("/api/reference-images", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({}),
      });
      const data = await res.json().catch(() => null);
      if (!res.ok || !data?.ok) {
        messageApi.error(data?.error || "获取参考图失败");
        return;
      }
      messageApi.success(`获取参考图成功：app=${data?.appNames || 0} items=${data?.totalItems || 0} files=${data?.totalFiles || 0}`);
    } catch (e) {
      messageApi.error(e instanceof Error ? e.message : String(e));
    } finally {
      setFetchingReferenceImages(false);
    }
  }, [messageApi]);

  const handleCopy = useCallback(async (row: ConfigItem) => {
    try {
      const payload = {
        prompt: row.prompt,
        count: row.count ?? undefined,
        appName: row.appName || undefined,
        lang: row.lang || undefined,
        batchFun: row.batchFun || undefined,
        promptTmpFunName: row.promptTmpFunName || undefined,
        referenceImages: Array.isArray(row.referenceImages) && row.referenceImages.length ? row.referenceImages : undefined,
        nextPromptFun: Array.isArray(row.nextPromptFun) && row.nextPromptFun.length ? row.nextPromptFun : undefined,
        responseModalities: Array.isArray(row.responseModalities) && row.responseModalities.length ? row.responseModalities : undefined,
        generationConfig: row.generationConfig && typeof row.generationConfig === "object" ? row.generationConfig : undefined,
        imageConfig: row.imageConfig && typeof row.imageConfig === "object" ? row.imageConfig : undefined,
        extra: row.extra && typeof row.extra === "object" ? row.extra : undefined,
      };
      const res = await fetch("/api/configs", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify(payload),
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
  }, [fetchList, messageApi]);

  const handleDelete = useCallback(async (id: string) => {
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
  }, [editingId, fetchList, messageApi]);

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
            return { id, ok, error: ok ? "" : String(data?.error || "删除失败") };
          } catch (e) {
            return { id, ok: false, error: e instanceof Error ? e.message : String(e) };
          }
        })
      );

      const failed = results.filter((r) => !r.ok);
      if (failed.length) {
        messageApi.error(`删除失败 ${failed.length}/${results.length}：${failed[0]?.id} ${failed[0]?.error || ""}`);
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
    return {
      prompt: row.prompt,
      count: row.count ?? undefined,
      appName: row.appName || undefined,
      lang: row.lang || undefined,
      batchFun: row.batchFun || undefined,
      promptTmpFunName: row.promptTmpFunName || undefined,
      referenceImages: Array.isArray(row.referenceImages) && row.referenceImages.length ? row.referenceImages : undefined,
      nextPromptFun: Array.isArray(row.nextPromptFun) && row.nextPromptFun.length ? row.nextPromptFun : undefined,
      responseModalities: Array.isArray(row.responseModalities) && row.responseModalities.length ? row.responseModalities : undefined,
      generationConfig: row.generationConfig && typeof row.generationConfig === "object" ? row.generationConfig : undefined,
      imageConfig: row.imageConfig && typeof row.imageConfig === "object" ? row.imageConfig : undefined,
      extra: row.extra && typeof row.extra === "object" ? row.extra : undefined,
    };
  }, []);

  const saveInlineRow = useCallback(async (nextRow: ConfigItem, prevRow: ConfigItem, savingKey: string, opts?: { silentSuccess?: boolean }) => {
    setSavingCellMap((m) => ({ ...m, [savingKey]: true }));
    setItems((prev) => prev.map((it) => (it.id === nextRow.id ? nextRow : it)));
    try {
      const res = await fetch(`/api/configs/${nextRow.id}`, {
        method: "PUT",
        headers: { "content-type": "application/json" },
        body: JSON.stringify(buildPutPayload(nextRow)),
      });
      const data = await res.json().catch(() => null);
      if (!res.ok || !data?.ok) {
        setItems((prev) => prev.map((it) => (it.id === prevRow.id ? prevRow : it)));
        messageApi.error(data?.error || "更新失败");
        return;
      }
      if (data?.item) {
        setItems((prev) => prev.map((it) => (it.id === nextRow.id ? data.item : it)));
      }
      if (!opts?.silentSuccess) messageApi.success("已保存");
    } catch (e) {
      setItems((prev) => prev.map((it) => (it.id === prevRow.id ? prevRow : it)));
      messageApi.error(e instanceof Error ? e.message : String(e));
    } finally {
      setSavingCellMap((m) => {
        const next = { ...m };
        delete next[savingKey];
        return next;
      });
    }
  }, [buildPutPayload, messageApi]);

  const promptTmpFunNameOptions = useMemo(() => {
    return Object.keys(promptFns)
      .filter((k) => typeof (promptFns as any)[k] === "function")
      .sort()
      .map((k) => ({ label: k, value: k }));
  }, []);

  const startEditCell = useCallback((row: ConfigItem, field: "appName" | "lang" | "batchFun" | "promptTmpFunName" | "aspectRatio" | "count" | "prompt") => {
    if (!tableEditMode) return;
    if (!row?.id) return;
    const savingKey = `${row.id}:${field}`;
    if (savingCellMap[savingKey]) return;
    setEditingCell({ id: row.id, field });
    if (field === "aspectRatio") {
      setEditingDraft(String(row.imageConfig?.aspectRatio || ""));
      return;
    }
    if (field === "count") {
      setEditingDraft(typeof row.count === "number" ? row.count : "");
      return;
    }
    setEditingDraft(String((row as any)[field] || ""));
  }, [savingCellMap, tableEditMode]);

  const cancelEditCell = useCallback(() => {
    setEditingCell(null);
    setEditingDraft("");
  }, []);

  const commitEditCell = useCallback(async (row: ConfigItem, overrideDraft?: string | number | null) => {
    if (!editingCell || editingCell.id !== row.id) return;
    const field = editingCell.field;
    const savingKey = `${row.id}:${field}`;
    if (savingCellMap[savingKey]) return;
    const draftVal = overrideDraft !== undefined ? overrideDraft : editingDraft;

    if (field === "count") {
      const raw = typeof draftVal === "number" ? String(draftVal) : String(draftVal || "").trim();
      const num = raw === "" ? undefined : Number(raw);
      if (raw !== "" && !(typeof num === "number" && Number.isFinite(num) && num >= 0)) {
        messageApi.error("count 必须是大于等于 0 的数字");
        return;
      }
      const nextVal = raw === "" ? undefined : num;
      if ((row.count ?? undefined) === nextVal) {
        cancelEditCell();
        return;
      }
      setDraftMap((m) => ({ ...m, [row.id]: { ...(m[row.id] || {}), count: nextVal } }));
      setItems((prev) => prev.map((it) => (it.id === row.id ? { ...it, count: nextVal } : it)));
      cancelEditCell();
      return;
    }

    if (field === "aspectRatio") {
      const nextVal = String(draftVal || "").trim();
      if (String(row.imageConfig?.aspectRatio || "") === nextVal) {
        cancelEditCell();
        return;
      }
      const nextImageConfig = { ...(row.imageConfig && typeof row.imageConfig === "object" ? row.imageConfig : {}), aspectRatio: nextVal };
      setDraftMap((m) => ({ ...m, [row.id]: { ...(m[row.id] || {}), imageConfig: nextImageConfig } }));
      setItems((prev) => prev.map((it) => (it.id === row.id ? { ...it, imageConfig: nextImageConfig } : it)));
      cancelEditCell();
      return;
    }

    const nextVal = field === "prompt" ? String(draftVal || "") : String(draftVal || "").trim();
    if (String((row as any)[field] || "") === nextVal) {
      cancelEditCell();
      return;
    }
    const patched = { ...row, [field]: nextVal || undefined } as any;
    setDraftMap((m) => ({ ...m, [row.id]: { ...(m[row.id] || {}), [field]: nextVal || undefined } }));
    setItems((prev) => prev.map((it) => (it.id === row.id ? patched : it)));
    cancelEditCell();
  }, [cancelEditCell, editingCell, editingDraft, messageApi, savingCellMap]);

  const getCellDisplay = useCallback((text: string, saving: boolean) => {
    const val = String(text || "");
    const display = val ? val : "（空）";
    const style: any = tableEditMode ? { padding: "2px 6px", border: "1px dashed #d9d9d9", borderRadius: 4, display: "inline-block", minWidth: 40, background: "#fafafa" } : {};
    const opacity = saving ? 0.6 : 1;
    return (
      <Typography.Text
        title={val}
        type={val ? undefined : "secondary"}
        style={{ cursor: saving ? "not-allowed" : (tableEditMode ? "pointer" : "default"), opacity, ...style }}
      >
        {display}
      </Typography.Text>
    );
  }, [tableEditMode]);

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
          const isEditing = editingCell?.id === row.id && editingCell?.field === field;
          const text = String(v || "");
          if (isEditing) {
            return (
              <AutoComplete
                autoFocus
                options={appNameOptions}
                allowClear
                placeholder="请选择或输入 appName"
                value={String(editingDraft ?? "")}
                showSearch={{ filterOption: (inputValue, option) =>
                  String(option?.value || "").toLowerCase().includes(String(inputValue || "").toLowerCase())
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
        },
      },
      {
        title: "lang",
        dataIndex: "lang",
        key: "lang",
        width: 70,
        ellipsis: true,
        align: "center",
        render: (v, row) => {
          const field = "lang" as const;
          const savingKey = `${row.id}:${field}`;
          const saving = Boolean(savingCellMap[savingKey]);
          const isEditing = editingCell?.id === row.id && editingCell?.field === field;
          const text = String(v || "");
          if (isEditing) {
            return (
              <AutoComplete
                autoFocus
                options={SUPPORTED_LANGUAGES.map((lang) => ({ label: lang, value: lang }))}
                allowClear
                placeholder="请选择或输入语言代码"
                value={String(editingDraft ?? "")}
                showSearch={{ filterOption: (inputValue, option) =>
                  String(option?.value || "").toLowerCase().includes(String(inputValue || "").toLowerCase())
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
        },
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
          const isEditing = editingCell?.id === row.id && editingCell?.field === field;
          const text = String(v || "");
          if (isEditing) {
            return (
              <AutoComplete
                autoFocus
                options={BATCH_FUN_OPTIONS}
                allowClear
                placeholder="请选择或输入 batchFun"
                value={String(editingDraft ?? "")}
                showSearch={{ filterOption: (inputValue, option) =>
                  String(option?.value || "").toLowerCase().includes(String(inputValue || "").toLowerCase())
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
        },
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
          const isEditing = editingCell?.id === row.id && editingCell?.field === field;
          const text = String(v || "");
          if (isEditing) {
            return (
              <AutoComplete
                autoFocus
                options={promptTmpFunNameOptions}
                allowClear
                placeholder="请选择或输入 prompt 函数"
                value={String(editingDraft ?? "")}
                showSearch={{ filterOption: (inputValue, option) =>
                  String(option?.value || "").toLowerCase().includes(String(inputValue || "").toLowerCase())
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
        },
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
          const isEditing = editingCell?.id === row.id && editingCell?.field === field;
          const text = String(v || "");
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
        },
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
          const isEditing = editingCell?.id === row.id && editingCell?.field === field;
          const text = v === undefined || v === null ? "" : String(v);
          if (isEditing) {
            return (
              <InputNumber
                autoFocus
                min={0}
                style={{ width: "100%" }}
                value={typeof editingDraft === "number" ? editingDraft : (String(editingDraft || "").trim() === "" ? null : Number(editingDraft))}
                onChange={(val) => setEditingDraft(val === null ? "" : (val as any))}
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
        },
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
          const isEditing = editingCell?.id === row.id && editingCell?.field === field;
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
                  if (e.key === "Enter" && (e.ctrlKey || e.metaKey)) void commitEditCell(row);
                }}
                onBlur={() => void commitEditCell(row)}
              />
            );
          }
          return (
            <Typography.Paragraph
              title={text}
              style={{ margin: 0, cursor: saving ? "not-allowed" : "pointer", opacity: saving ? 0.6 : 1 }}
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
                ),
              }}
              onClick={() => {
                if (saving) return;
                startEditCell(row, field);
              }}
            >
              {text}
            </Typography.Paragraph>
          );
        },
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
                  form.setFieldsValue({
                    appName: row.appName,
                    lang: row.lang,
                    batchFun: row.batchFun,
                    promptTmpFunName: row.promptTmpFunName,
                    count: row.count ?? 1,
                    prompt: row.prompt,
                    referenceImagesText: Array.isArray(row.referenceImages) ? row.referenceImages.join("\n") : "",
                    generationConfig_temperature: row.generationConfig?.temperature ?? 1,
                    imageConfig_imageSize: row.imageConfig?.imageSize ?? "1K",
                    imageConfig_aspectRatio: row.imageConfig?.aspectRatio ?? "1:1",
                    responseModalities: Array.isArray(row.responseModalities) ? row.responseModalities : ["IMAGE"],
                    nextPromptFunText: Array.isArray(row.nextPromptFun) ? row.nextPromptFun.join("\n") : "",
                    extraJson: row.extra ? (() => {
                      try {
                        return JSON.stringify(row.extra);
                      } catch {
                        return "";
                      }
                    })() : "",
                  });
                  setEditingId(row.id);
                  setOpen(true);
                }}
              >
                编辑
              </Button>
              <Button size="small" icon={<CopyOutlined />} onClick={() => handleCopy(row)}>
                复制
              </Button>
            </Space>
            <Space size={6}>
              <Button
                size="small"
                icon={<PictureOutlined />}
                onClick={() => {
                  router.push(`/batch?configIds=${encodeURIComponent(row.id)}&autoStart=1`);
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
        ),
      },
    ],
    [appNameOptions, cancelEditCell, commitEditCell, editingCell, editingDraft, form, getCellDisplay, handleCopy, handleDelete, promptTmpFunNameOptions, router, savingCellMap, startEditCell],
  );

  const fetchAppNameOptions = async () => {
    try {
      const res = await fetch("/api/app-names", { method: "GET" });
      const data = await res.json();
      if (res.ok && data?.ok && Array.isArray(data.items)) {
        setAppNameOptions(data.items.map((name: string) => ({ label: name, value: name })));
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

  const openCreate = () => {
    form.resetFields();
    form.setFieldsValue({
      count: 1,
      imageConfig_aspectRatio: "16:9",
      imageConfig_imageSize: "1K",
      generationConfig_temperature: 1,
      responseModalities: ["IMAGE"],
    });
    setEditingId(null);
    setOpen(true);
  };

  const submitCreate = async () => {
    const values = await form.validateFields();
    const referenceImages = splitLinesToList(values.referenceImagesText || "");
    const nextPromptFun = splitLinesToList(values.nextPromptFunText || "");

    const payload = {
      prompt: values.prompt,
      count: values.count ?? undefined,
      appName: values.appName || undefined,
      lang: values.lang || undefined,
      batchFun: values.batchFun || undefined,
      promptTmpFunName: values.promptTmpFunName || undefined,
      referenceImages: referenceImages.length ? referenceImages : undefined,
      nextPromptFun: nextPromptFun.length ? nextPromptFun : undefined,
      responseModalities: Array.isArray(values.responseModalities) ? values.responseModalities : undefined,
      generationConfig: {
        temperature: values.generationConfig_temperature,
      },
      imageConfig: {
        imageSize: values.imageConfig_imageSize,
        aspectRatio: values.imageConfig_aspectRatio,
      },
      extra: values.extraJson ? (() => {
        try {
          return JSON.parse(values.extraJson);
        } catch {
          return undefined;
        }
      })() : undefined,
    };

    setSubmitting(true);
    try {
      const isEdit = Boolean(editingId);
      const url = isEdit ? `/api/configs/${editingId}` : "/api/configs";
      const res = await fetch(url, {
        method: isEdit ? "PUT" : "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify(payload),
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
            <Button
              icon={<CloudDownloadOutlined />}
              loading={fetchingReferenceImages}
              disabled={loading || deletingBatch || savingEditMode || submitting}
              onClick={handleFetchReferenceImages}
            >
              获取参考图
            </Button>
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
                        await saveInlineRow(currentRow, baseRow, `${id}:__editmode__`, { silentSuccess: true });
                      } catch (e) {
                        failures.push({ id, error: e instanceof Error ? e.message : String(e) });
                      }
                    }
                    if (failures.length) {
                      messageApi.error(`保存失败 ${failures.length}/${ids.length}：${failures[0]?.id} ${failures[0]?.error || ""}`);
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
              <Button danger icon={<DeleteOutlined />} disabled={!selectedRowKeys.length} loading={deletingBatch}>
                删除
              </Button>
            </Popconfirm>
          </Space>
        </Card>

        <Card>
          <Table
            rowKey="id"
            loading={loading}
            columns={columns}
            dataSource={items}
            tableLayout="fixed"
            pagination={{
              current: configPage,
              pageSize: configPageSize,
              showSizeChanger: true,
              pageSizeOptions: ["10", "20", "50", "100"],
              showTotal: (total) => {
                const pages = Math.max(1, Math.ceil((Number(total) || 0) / (Number(configPageSize) || 10)));
                return `共 ${total} 条 / ${pages} 页`;
              },
              onChange: (page, pageSize) => {
                if (pageSize !== configPageSize) {
                  setConfigPageSize(pageSize);
                  setConfigPage(1);
                } else {
                  setConfigPage(page);
                }
              },
            }}
            rowSelection={{
              selectedRowKeys,
              onChange: (keys) => setSelectedRowKeys(keys as string[]),
            }}
          />
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
          <Form.Item name="appName" label="appName">
            <AutoComplete
              options={appNameOptions}
              allowClear
              placeholder="请选择或输入 appName"
              showSearch={{ filterOption: (inputValue, option) =>
                String(option?.value || "").toLowerCase().includes(String(inputValue || "").toLowerCase())
              }}
            />
          </Form.Item>
          <Form.Item name="lang" label="lang">
            <AutoComplete
              options={SUPPORTED_LANGUAGES.map((lang) => ({ label: lang, value: lang }))}
              allowClear
              placeholder="请选择或输入语言代码"
              showSearch={{ filterOption: (inputValue, option) =>
                String(option?.value || "").toLowerCase().includes(String(inputValue || "").toLowerCase())
              }}
            />
          </Form.Item>
          <Form.Item name="batchFun" label="batchFun">
            <AutoComplete
              options={BATCH_FUN_OPTIONS}
              allowClear
              placeholder="请选择或输入 batchFun"
              showSearch={{ filterOption: (inputValue, option) =>
                String(option?.value || "").toLowerCase().includes(String(inputValue || "").toLowerCase())
              }}
            />
          </Form.Item>
          <Form.Item name="promptTmpFunName" label="promptTmpFunName">
            <AutoComplete
              options={promptTmpFunNameOptions}
              allowClear
              placeholder="请选择或输入 prompt 函数"
              showSearch={{ filterOption: (inputValue, option) =>
                String(option?.value || "").toLowerCase().includes(String(inputValue || "").toLowerCase())
              }}
            />
          </Form.Item>
          <Form.Item name="count" label="count">
            <InputNumber min={0} style={{ width: "100%" }} />
          </Form.Item>
          <Form.Item
            name="prompt"
            label="prompt"
          >
            <Input.TextArea rows={5} placeholder="描述要生成的图片" />
          </Form.Item>

          <Form.Item name="referenceImagesText" label="referenceImages（每行一个路径/URL）">
            <Input.TextArea rows={4} placeholder="D:\\batchGenerateImage\\referenceImages\\...\nhttps://..." />
          </Form.Item>

          <Form.Item name="generationConfig_temperature" label="generationConfig.temperature">
            <InputNumber step={0.1} style={{ width: "100%" }} />
          </Form.Item>

          <Form.Item name="imageConfig_imageSize" label="imageConfig.imageSize">
            <AutoComplete
              options={IMAGE_SIZE_OPTIONS}
              allowClear
              placeholder="请选择或输入 imageSize"
              showSearch={{ filterOption: (inputValue, option) =>
                String(option?.value || "").toLowerCase().includes(String(inputValue || "").toLowerCase())
              }}
            />
          </Form.Item>
          <Form.Item name="imageConfig_aspectRatio" label="imageConfig.aspectRatio">
            <AutoComplete
              options={ASPECT_RATIO_OPTIONS}
              allowClear
              placeholder="请选择或输入 aspectRatio"
              showSearch={{ filterOption: (inputValue, option) =>
                String(option?.value || "").toLowerCase().includes(String(inputValue || "").toLowerCase())
              }}
            />
          </Form.Item>

          <Form.Item name="responseModalities" label="responseModalities">
            <Select mode="tags" options={RESPONSE_MODALITIES_OPTIONS} />
          </Form.Item>

          <Form.Item name="nextPromptFunText" label="nextPromptFun（可选，每行一个函数名）">
            <Input.TextArea rows={3} placeholder="例如：getCutLogoFinalPrompt" />
          </Form.Item>

          <Form.Item name="extraJson" label="extra（可选，JSON 扩展字段）">
            <Input.TextArea rows={6} placeholder='例如：{"anyKey":"anyValue"}' />
          </Form.Item>
        </Form>
      </Drawer>
    </AdminShell>
  );
}

