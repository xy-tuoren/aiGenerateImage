"use client";

import { useCallback, useMemo } from "react";
import {
  AutoComplete,
  Button,
  Form,
  Input,
  InputNumber,
  Popconfirm,
  Select,
  Space,
  Tooltip,
  Typography
} from "antd";
import type { ColumnsType } from "antd/es/table";
import {
  EditOutlined,
  CopyOutlined,
  DeleteOutlined,
  PictureOutlined
} from "@ant-design/icons";
import {
  ASPECT_RATIO_OPTIONS,
  BATCH_FUN_OPTIONS,
  SUPPORTED_LANGUAGES
} from "@/common/constants";
import type { ConfigItem } from "../_lib/types";
import {
  deriveAspectRatioLabel,
  deriveGeminiMatchFields,
  normalizeThinkingLevel
} from "../_lib/utils";

export type EditingCell = {
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
} | null;

export type UseConfigColumnsParams = {
  tableEditMode: boolean;
  savingCellMap: Record<string, boolean>;
  editingCell: EditingCell;
  editingDraft: string | number | string[] | null;
  setEditingDraft: (v: string | number | string[] | null) => void;
  appNameOptions: { label: string; value: string }[];
  promptTmpFunNameOptions: { label: string; value: string }[];
  form: ReturnType<typeof Form.useForm>[0];
  router: { push: (href: string) => void };
  cancelEditCell: () => void;
  commitEditCell: (
    row: ConfigItem,
    overrideDraft?: string | number | null
  ) => void;
  startEditCell: (
    row: ConfigItem,
    field: UseConfigColumnsParams["editingCell"] extends { field: infer F }
      ? F
      : never
  ) => void;
  handleCopy: (row: ConfigItem) => void;
  handleDelete: (id: string) => void;
  onEditRow: (row: ConfigItem) => void;
};

export function useConfigColumns({
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
}: UseConfigColumnsParams): ColumnsType<ConfigItem> {
  const getCellDisplay = useCallback(
    (text: string, saving: boolean) => {
      const val = String(text || "");
      const display = val ? val : "（空）";
      const style: React.CSSProperties = tableEditMode
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

  return useMemo(
    () => [
      {
        title: "appName",
        dataIndex: "appName",
        key: "appName",
        width: 140,
        ellipsis: true,
        align: "center" as const,
        render: (v: unknown, row: ConfigItem) => {
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
        title: "description",
        dataIndex: "description",
        key: "description",
        width: 150,
        align: "center" as const,
        onCell: () => ({ style: { whiteSpace: "normal" as const } }),
        render: (v: unknown, row: ConfigItem) => {
          const field = "description" as const;
          const savingKey = `${row.id}:${field}`;
          const saving = Boolean(savingCellMap[savingKey]);
          const isEditing =
            editingCell?.id === row.id && editingCell?.field === field;
          const text = String(v || "");
          const displayText = text || "（空）";
          if (isEditing) {
            return (
              <Input
                autoFocus
                allowClear
                placeholder="请输入描述"
                value={String(editingDraft ?? "")}
                onChange={(e) => setEditingDraft(e.target.value)}
                onKeyDown={(e) => {
                  if (e.key === "Escape") cancelEditCell();
                  if (e.key === "Enter") void commitEditCell(row);
                }}
                onBlur={() => void commitEditCell(row)}
              />
            );
          }
          return (
            <Tooltip
              styles={{ root: { maxWidth: "none" } }}
              title={
                <div
                  style={{
                    width: "30vw",
                    maxHeight: "70vh",
                    overflowY: "auto",
                    whiteSpace: "pre-wrap",
                    wordBreak: "break-word"
                  }}
                >
                  {displayText}
                </div>
              }
            >
              <Typography.Paragraph
                type={text ? undefined : "secondary"}
                style={{
                  margin: 0,
                  cursor: saving ? "not-allowed" : "pointer",
                  opacity: saving ? 0.6 : 1
                }}
                ellipsis={{ rows: 2 }}
                onClick={() => {
                  if (saving) return;
                  startEditCell(row, field);
                }}
              >
                {displayText}
              </Typography.Paragraph>
            </Tooltip>
          );
        }
      },
      {
        title: "lang",
        dataIndex: "lang",
        key: "lang",
        width: 90,
        ellipsis: true,
        align: "center" as const,
        render: (v: unknown, row: ConfigItem) => {
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
        align: "center" as const,
        render: (v: unknown, row: ConfigItem) => {
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
        align: "center" as const,
        render: (v: unknown, row: ConfigItem) => {
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
        align: "center" as const,
        render: (v: unknown, row: ConfigItem) => {
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
        align: "center" as const,
        render: (v: unknown, row: ConfigItem) => {
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
        align: "center" as const,
        onCell: () => ({ style: { whiteSpace: "normal" as const } }),
        render: (v: unknown, row: ConfigItem) => {
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
            <Tooltip
              styles={{ root: { maxWidth: "none" } }}
              title={
                <div
                  style={{
                    width: "30vw",
                    maxHeight: "70vh",
                    overflowY: "auto",
                    whiteSpace: "pre-wrap",
                    wordBreak: "break-word"
                  }}
                >
                  {text}
                </div>
              }
            >
              <Typography.Paragraph
                style={{
                  margin: 0,
                  cursor: saving ? "not-allowed" : "pointer",
                  opacity: saving ? 0.6 : 1
                }}
                ellipsis={{ rows: 2 }}
                onClick={() => {
                  if (saving) return;
                  startEditCell(row, field);
                }}
              >
                {text}
              </Typography.Paragraph>
            </Tooltip>
          );
        }
      },
      {
        title: "操作",
        key: "actions",
        width: 180,
        align: "center" as const,
        render: (_v: unknown, row: ConfigItem) => (
          <Space orientation="vertical" size={6}>
            <Space size={6}>
              <Button
                size="small"
                icon={<EditOutlined />}
                onClick={() => onEditRow(row)}
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
                onClick={() =>
                  router.push(
                    `/batch?configIds=${encodeURIComponent(row.id)}&autoStart=1`
                  )
                }
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
      onEditRow,
      promptTmpFunNameOptions,
      savingCellMap,
      setEditingDraft,
      startEditCell
    ]
  );
}
