"use client";

import { useMemo } from "react";
import {
  Button,
  Card,
  Form,
  Input,
  Modal,
  Popconfirm,
  Space,
  Table,
  Tooltip,
  Typography
} from "antd";
import type { FormInstance } from "antd/es/form";
import type { MessageInstance } from "antd/es/message/interface";
import type { ColumnsType } from "antd/es/table";
import { CopyOutlined, PlusOutlined } from "@ant-design/icons";
import type { PromptTemplateItem } from "../_lib/types";
import { normalizeTemplateVarsForPreview } from "../_lib/utils";

type PromptTemplateRow = PromptTemplateItem & { source?: "builtin" | "custom" };

type PromptTemplatesPanelProps = {
  templatesLoading: boolean;
  rows: PromptTemplateRow[];
  currentUserId: string;
  isSuperAdmin: boolean;
  messageApi: MessageInstance;
  templateModalOpen: boolean;
  templateSubmitting: boolean;
  editingTemplateId: string | null;
  templateForm: FormInstance;
  onOpenCreate: () => void;
  onRefresh: () => void;
  onEdit: (row: PromptTemplateItem) => void;
  onDelete: (id: string) => void;
  onCancelModal: () => void;
  onSubmitModal: () => void;
};

export function PromptTemplatesPanel({
  templatesLoading,
  rows,
  currentUserId,
  isSuperAdmin,
  messageApi,
  templateModalOpen,
  templateSubmitting,
  editingTemplateId,
  templateForm,
  onOpenCreate,
  onRefresh,
  onEdit,
  onDelete,
  onCancelModal,
  onSubmitModal
}: PromptTemplatesPanelProps) {
  const promptTemplateColumns: ColumnsType<PromptTemplateRow> = useMemo(
    () => [
      {
        title: "模板函数名",
        dataIndex: "name",
        key: "name",
        width: 200,
        ellipsis: { showTitle: true }
      },
      {
        title: "描述",
        dataIndex: "description",
        key: "description",
        width: 110,
        ellipsis: { showTitle: true },
        render: (v) => String(v || "—")
      },
      {
        title: "模板预览",
        dataIndex: "template",
        key: "template",
        width: 680,
        render: (v) =>
          (() => {
            const previewText = normalizeTemplateVarsForPreview(
              String(v || "")
            );
            return (
              <div
                style={{
                  display: "flex",
                  alignItems: "center",
                  gap: 6,
                  width: "100%"
                }}
              >
                <div style={{ flex: 1, minWidth: 0, overflow: "hidden" }}>
                  <Tooltip
                    styles={{ root: { maxWidth: "none" } }}
                    title={
                      <div
                        style={{
                          width: 920,
                          maxHeight: "70vh",
                          overflowY: "auto",
                          whiteSpace: "pre-wrap",
                          wordBreak: "break-word"
                        }}
                      >
                        {previewText}
                      </div>
                    }
                  >
                    <Typography.Text
                      style={{ display: "block", whiteSpace: "nowrap" }}
                      ellipsis
                    >
                      {previewText}
                    </Typography.Text>
                  </Tooltip>
                </div>
                <Tooltip title="复制模板内容">
                  <Button
                    size="small"
                    type="text"
                    icon={<CopyOutlined />}
                    onClick={async (e) => {
                      e.stopPropagation();
                      try {
                        await navigator.clipboard.writeText(previewText);
                        messageApi.success("已复制模板内容");
                      } catch (err) {
                        messageApi.error(
                          err instanceof Error ? err.message : "复制失败"
                        );
                      }
                    }}
                  />
                </Tooltip>
              </div>
            );
          })()
      },
      {
        title: "创建人",
        dataIndex: "username",
        key: "username",
        width: 80,
        ellipsis: { showTitle: true },
        align: "center",
        render: (v, row: PromptTemplateRow) =>
          row?.source === "custom" ? String(v || "—") : "system"
      },
      {
        title: "新增时间",
        dataIndex: "createdAt",
        key: "createdAt",
        width: 140,
        ellipsis: { showTitle: true },
        render: (v, row: PromptTemplateRow) => {
          if (row?.source !== "custom") return "—";
          const t = new Date(String(v || ""));
          if (!Number.isFinite(t.getTime())) return "—";
          const pad = (n: number) => String(n).padStart(2, "0");
          return `${t.getFullYear()}-${pad(t.getMonth() + 1)}-${pad(
            t.getDate()
          )} ${pad(t.getHours())}:${pad(t.getMinutes())}`;
        }
      },
      {
        title: "操作",
        key: "actions",
        width: 130,
        align: "center",
        render: (_v, row: PromptTemplateRow) => {
          if (row?.source !== "custom") return "—";
          const isOwner =
            String(row?.userId || "").trim() &&
            String(row?.userId || "").trim() ===
              String(currentUserId || "").trim();
          const canEdit = Boolean(isSuperAdmin || isOwner);
          const canDelete = Boolean(isSuperAdmin || isOwner);
          return (
            <Space size={8}>
              {canEdit ? (
                <Button
                  size="small"
                  onClick={() => onEdit(row as PromptTemplateItem)}
                >
                  修改
                </Button>
              ) : (
                <Button size="small" disabled title="仅管理员或创建者可修改">
                  修改
                </Button>
              )}
              {canDelete ? (
                <Popconfirm
                  title="确认删除该模板？"
                  okText="删除"
                  cancelText="取消"
                  onConfirm={() => onDelete(String(row.id))}
                >
                  <Button size="small" danger>
                    删除
                  </Button>
                </Popconfirm>
              ) : (
                <Button
                  size="small"
                  danger
                  disabled
                  title="仅管理员或创建者可删除"
                >
                  删除
                </Button>
              )}
            </Space>
          );
        }
      }
    ],
    [currentUserId, isSuperAdmin, messageApi, onDelete, onEdit]
  );

  return (
    <>
      <Card>
        <Space
          orientation="vertical"
          size={16}
          style={{ width: "100%", display: "flex" }}
        >
          <Space wrap>
            <Button
              type="primary"
              icon={<PlusOutlined />}
              onClick={onOpenCreate}
            >
              新增自定义提示词模板函数
            </Button>
            <Button onClick={onRefresh}>刷新模板列表</Button>
            <Typography.Text type="secondary">
              占位符支持 `{"{{appName}}"}` / `{"{{lang}}"}` / `{"{{prompt}}"}` /
              `{"{{aspectRatio}}"}`。
            </Typography.Text>
          </Space>

          <Table
            rowKey="id"
            loading={templatesLoading}
            columns={promptTemplateColumns}
            dataSource={rows as any[]}
            tableLayout="fixed"
            style={{ width: "100%" }}
            pagination={{ pageSize: 20, showSizeChanger: true }}
          />
        </Space>
      </Card>

      <Modal
        title={
          editingTemplateId
            ? "修改自定义提示词模板函数"
            : "新增自定义提示词模板函数"
        }
        open={templateModalOpen}
        onCancel={onCancelModal}
        onOk={onSubmitModal}
        okButtonProps={{ loading: templateSubmitting }}
        width={760}
      >
        <Form form={templateForm} layout="vertical">
          <Form.Item
            name="name"
            label="函数名"
            rules={[
              { required: true, message: "请输入函数名" },
              {
                pattern: /^[A-Za-z_][A-Za-z0-9_]*$/,
                message: "函数名仅支持字母/数字/下划线，且不能以数字开头"
              }
            ]}
          >
            <Input
              placeholder="例如：getPromoPromptV2"
              disabled={Boolean(editingTemplateId)}
            />
          </Form.Item>
          <Form.Item name="description" label="描述">
            <Input placeholder="例如：用于节日活动促销图" />
          </Form.Item>
          <Form.Item
            name="template"
            label="模板内容"
            rules={[{ required: true, message: "请输入模板内容" }]}
          >
            <Input.TextArea
              rows={10}
              placeholder="你是一个广告设计师，应用名是{{appName}}，语言是{{lang}}。补充要求：{{prompt}}"
            />
          </Form.Item>
        </Form>
      </Modal>
    </>
  );
}
