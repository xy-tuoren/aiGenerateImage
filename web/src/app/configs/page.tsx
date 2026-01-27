"use client";

import { useCallback, useEffect, useMemo, useState } from "react";
import { AutoComplete, Button, Card, Drawer, Form, Input, InputNumber, Popconfirm, Select, Space, Table, Typography, message } from "antd";
import type { ColumnsType } from "antd/es/table";
import { PlusOutlined, PictureOutlined, EditOutlined, CopyOutlined, DeleteOutlined } from "@ant-design/icons";
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
  const [open, setOpen] = useState(false);
  const [submitting, setSubmitting] = useState(false);
  const [deletingBatch, setDeletingBatch] = useState(false);
  const [form] = Form.useForm();
  const [appNameOptions, setAppNameOptions] = useState<{ label: string; value: string }[]>([]);
  const [editingId, setEditingId] = useState<string | null>(null);
  const [selectedRowKeys, setSelectedRowKeys] = useState<string[]>([]);

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

  const columns: ColumnsType<ConfigItem> = useMemo(
    () => [
      { title: "appName", dataIndex: "appName", key: "appName", width: 160, ellipsis: true, align: "center" },
      { title: "lang", dataIndex: "lang", key: "lang", width: 90, ellipsis: true, align: "center" },
      { title: "batchFun", dataIndex: "batchFun", key: "batchFun", width: 160, ellipsis: true, align: "center" },
      { title: "promptTmpFunName", dataIndex: "promptTmpFunName", key: "promptTmpFunName", width: 180, ellipsis: true, align: "center" },
      { title: "aspectRatio", dataIndex: ["imageConfig", "aspectRatio"], key: "aspectRatio", width: 110, ellipsis: true, align: "center" },
      { title: "count", dataIndex: "count", key: "count", width: 80, align: "center" },
      {
        title: "prompt",
        dataIndex: "prompt",
        key: "prompt",
        width: 500,
        ellipsis: true,
        align: "center",
        render: (v) => (
          <Typography.Text title={String(v || "")} style={{ cursor: "pointer" }}>
            {String(v || "")}
          </Typography.Text>
        ),
      },
      {
        title: "操作",
        key: "actions",
        width: 220,
        fixed: "right",
        align: "center",
        render: (_v, row) => (
          <Space>
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
        ),
      },
    ],
    [form, handleCopy, handleDelete],
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

  const promptTmpFunNameOptions = useMemo(() => {
    return Object.keys(promptFns)
      .filter((k) => typeof (promptFns as any)[k] === "function")
      .sort()
      .map((k) => ({ label: k, value: k }));
  }, []);

  useEffect(() => {
    fetchList();
    fetchAppNameOptions();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const openCreate = () => {
    form.resetFields();
    form.setFieldsValue({
      count: 1,
      imageConfig_aspectRatio: "1:1",
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
            scroll={{ x: 1600 }}
            pagination={{ pageSize: 20 }}
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
              filterOption={(inputValue, option) =>
                String(option?.value || "").toLowerCase().includes(String(inputValue || "").toLowerCase())
              }
            />
          </Form.Item>
          <Form.Item name="lang" label="lang">
            <AutoComplete
              options={SUPPORTED_LANGUAGES.map((lang) => ({ label: lang, value: lang }))}
              allowClear
              placeholder="请选择或输入语言代码"
              filterOption={(inputValue, option) =>
                String(option?.value || "").toLowerCase().includes(String(inputValue || "").toLowerCase())
              }
            />
          </Form.Item>
          <Form.Item name="batchFun" label="batchFun">
            <AutoComplete
              options={BATCH_FUN_OPTIONS}
              allowClear
              placeholder="请选择或输入 batchFun"
              filterOption={(inputValue, option) =>
                String(option?.value || "").toLowerCase().includes(String(inputValue || "").toLowerCase())
              }
            />
          </Form.Item>
          <Form.Item name="promptTmpFunName" label="promptTmpFunName">
            <AutoComplete
              options={promptTmpFunNameOptions}
              allowClear
              placeholder="请选择或输入 prompt 函数"
              filterOption={(inputValue, option) =>
                String(option?.value || "").toLowerCase().includes(String(inputValue || "").toLowerCase())
              }
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
              filterOption={(inputValue, option) =>
                String(option?.value || "").toLowerCase().includes(String(inputValue || "").toLowerCase())
              }
            />
          </Form.Item>
          <Form.Item name="imageConfig_aspectRatio" label="imageConfig.aspectRatio">
            <AutoComplete
              options={ASPECT_RATIO_OPTIONS}
              allowClear
              placeholder="请选择或输入 aspectRatio"
              filterOption={(inputValue, option) =>
                String(option?.value || "").toLowerCase().includes(String(inputValue || "").toLowerCase())
              }
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

