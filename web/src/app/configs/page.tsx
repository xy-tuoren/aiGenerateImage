"use client";

import { useEffect, useMemo, useState } from "react";
import { Button, Card, Drawer, Form, Input, InputNumber, Layout, Menu, Select, Space, Table, Typography, message } from "antd";
import type { ColumnsType } from "antd/es/table";
import { PlusOutlined, ReloadOutlined, HomeOutlined, SettingOutlined } from "@ant-design/icons";
import Link from "next/link";
import { usePathname } from "next/navigation";

type ConfigItem = {
  id: string;
  prompt: string;
  referenceImages?: string[];
  generationConfig?: { temperature?: number; [k: string]: any };
  imageConfig?: { imageSize?: string; aspectRatio?: string; [k: string]: any };
  output?: string;
  count?: number;
  appName?: string;
  lang?: string;
  batchFun?: string;
  aspectRatio?: string;
  promptTmpFunName?: string;
  createdAt?: string;
};

function splitLinesToList(input: string): string[] {
  return (input || "")
    .split(/\r?\n|[，,]/)
    .map((s) => s.trim())
    .filter(Boolean);
}

export default function ConfigsPage() {
  const pathname = usePathname();
  const [messageApi, contextHolder] = message.useMessage();
  const [loading, setLoading] = useState(false);
  const [items, setItems] = useState<ConfigItem[]>([]);
  const [open, setOpen] = useState(false);
  const [submitting, setSubmitting] = useState(false);
  const [form] = Form.useForm();

  const columns: ColumnsType<ConfigItem> = useMemo(
    () => [
      { title: "appName", dataIndex: "appName", key: "appName", width: 120 },
      { title: "lang", dataIndex: "lang", key: "lang", width: 90 },
      { title: "batchFun", dataIndex: "batchFun", key: "batchFun", width: 140 },
      { title: "aspectRatio", dataIndex: "aspectRatio", key: "aspectRatio", width: 110 },
      { title: "count", dataIndex: "count", key: "count", width: 80 },
      {
        title: "prompt",
        dataIndex: "prompt",
        key: "prompt",
        ellipsis: true,
        render: (v) => <Typography.Text title={String(v || "")}>{String(v || "")}</Typography.Text>,
      },
      { title: "output", dataIndex: "output", key: "output", ellipsis: true },
    ],
    [],
  );

  const fetchList = async () => {
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
  };

  useEffect(() => {
    fetchList();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const openCreate = () => {
    form.resetFields();
    form.setFieldsValue({
      count: 1,
      aspectRatio: "1:1",
      imageConfig_aspectRatio: "1:1",
      imageConfig_imageSize: "1K",
      generationConfig_temperature: 0.5,
      responseModalities: ["IMAGE"],
    });
    setOpen(true);
  };

  const submitCreate = async () => {
    const values = await form.validateFields();
    const referenceImages = splitLinesToList(values.referenceImagesText || "");
    const nextPromptFun = splitLinesToList(values.nextPromptFunText || "");

    const payload = {
      prompt: values.prompt,
      output: values.output || undefined,
      count: values.count ?? undefined,
      appName: values.appName || undefined,
      lang: values.lang || undefined,
      batchFun: values.batchFun || undefined,
      aspectRatio: values.aspectRatio || undefined,
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
      const res = await fetch("/api/configs", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify(payload),
      });
      const data = await res.json();
      if (!res.ok || !data?.ok) {
        messageApi.error(data?.error || "新增失败");
        return;
      }
      messageApi.success("新增成功");
      setOpen(false);
      await fetchList();
    } finally {
      setSubmitting(false);
    }
  };

  const { Header, Content, Sider } = Layout;

  return (
    <Layout style={{ minHeight: "100vh" }}>
      <Sider width={200} style={{ background: "#fff" }}>
        <Menu
          mode="inline"
          selectedKeys={[pathname || "/configs"]}
          style={{ height: "100%", borderRight: 0 }}
          items={[
            {
              key: "/",
              icon: <HomeOutlined />,
              label: <Link href="/">首页</Link>,
            },
            {
              key: "/configs",
              icon: <SettingOutlined />,
              label: <Link href="/configs">配置管理</Link>,
            },
          ]}
        />
      </Sider>
      <Layout>
        <Header style={{ display: "flex", alignItems: "center", background: "#001529" }}>
          <Typography.Title level={4} style={{ color: "#fff", margin: 0 }}>
            批量生成图片 - 内部后台
          </Typography.Title>
        </Header>
        <Content style={{ padding: 24 }}>
          {contextHolder}
          <Space orientation="vertical" size={16} style={{ width: "100%" }}>
            <Card>
              <Space wrap>
                <Button type="primary" icon={<PlusOutlined />} onClick={openCreate}>
                  新增配置
                </Button>
                <Button icon={<ReloadOutlined />} onClick={fetchList} loading={loading}>
                  刷新
                </Button>
              </Space>
            </Card>

            <Card>
              <Table rowKey="id" loading={loading} columns={columns} dataSource={items} pagination={{ pageSize: 20 }} />
            </Card>
          </Space>

          <Drawer
            title="新增生图配置（参考 config.json）"
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
                <Input placeholder="例如：kakaotalk" />
              </Form.Item>
              <Form.Item name="lang" label="lang">
                <Input placeholder="例如：us / jp / kr" />
              </Form.Item>
              <Form.Item name="batchFun" label="batchFun">
                <Input placeholder="例如：cut / combination2" />
              </Form.Item>
              <Form.Item name="promptTmpFunName" label="promptTmpFunName">
                <Input placeholder="例如：getCutLogoFinalPrompt" />
              </Form.Item>
              <Form.Item name="aspectRatio" label="aspectRatio（meta）">
                <Select
                  options={[
                    { label: "1:1", value: "1:1" },
                    { label: "4:5", value: "4:5" },
                    { label: "16:9", value: "16:9" },
                  ]}
                />
              </Form.Item>
              <Form.Item name="count" label="count">
                <InputNumber min={0} style={{ width: "100%" }} />
              </Form.Item>
              <Form.Item name="output" label="output（输出目录）">
                <Input placeholder="例如：D:\\mog素材\\待用素材库\\xxx" />
              </Form.Item>

              <Form.Item
                name="prompt"
                label="prompt"
                rules={[{ required: true, message: "prompt 不能为空" }]}
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
                <Select
                  options={[
                    { label: "1K", value: "1K" },
                    { label: "2K", value: "2K" },
                  ]}
                />
              </Form.Item>
              <Form.Item name="imageConfig_aspectRatio" label="imageConfig.aspectRatio（Gemini）">
                <Select
                  options={[
                    { label: "1:1", value: "1:1" },
                    { label: "4:5", value: "4:5" },
                    { label: "16:9", value: "16:9" },
                  ]}
                />
              </Form.Item>

              <Form.Item name="responseModalities" label="responseModalities">
                <Select mode="multiple" options={[{ label: "IMAGE", value: "IMAGE" }]} />
              </Form.Item>

              <Form.Item name="nextPromptFunText" label="nextPromptFun（可选，每行一个函数名）">
                <Input.TextArea rows={3} placeholder="例如：getCutLogoFinalPrompt" />
              </Form.Item>

              <Form.Item name="extraJson" label="extra（可选，JSON 扩展字段）">
                <Input.TextArea rows={6} placeholder='例如：{"anyKey":"anyValue"}' />
              </Form.Item>
            </Form>
          </Drawer>
        </Content>
      </Layout>
    </Layout>
  );
}

