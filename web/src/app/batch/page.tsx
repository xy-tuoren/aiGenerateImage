"use client";

import { useEffect, useMemo, useRef, useState } from "react";
import { Button, Card, Form, InputNumber, Progress, Select, Space, Table, Typography, message, Image } from "antd";
import type { ColumnsType } from "antd/es/table";
import { PlayCircleOutlined, ReloadOutlined } from "@ant-design/icons";
import { useSearchParams } from "next/navigation";
import AdminShell from "@/app/_components/AdminShell";

type ConfigItem = {
  id: string;
  appName?: string;
  lang?: string;
  batchFun?: string;
  aspectRatio?: string;
  prompt?: string;
  count?: number;
};

type Job = {
  id: string;
  status: string;
  concurrency: number;
  total: number;
  done: number;
  error?: string;
  createdAt?: string;
  updatedAt?: string;
};

type JobItem = {
  configId: string;
  status: string;
  total: number;
  done: number;
  error?: string;
  configMeta?: {
    appName?: string;
    lang?: string;
    batchFun?: string;
    aspectRatio?: string;
    prompt?: string;
  };
  images: Array<{ url: string; index: number; createdAt?: string; mimeType?: string }>;
};

export default function BatchPage() {
  const searchParams = useSearchParams();
  const [messageApi, contextHolder] = message.useMessage();

  const [configsLoading, setConfigsLoading] = useState(false);
  const [configs, setConfigs] = useState<ConfigItem[]>([]);
  const [job, setJob] = useState<Job | null>(null);
  const [items, setItems] = useState<JobItem[]>([]);
  const [starting, setStarting] = useState(false);
  const [polling, setPolling] = useState(false);
  const pollTimer = useRef<any>(null);
  const [form] = Form.useForm();

  const fetchConfigs = async () => {
    setConfigsLoading(true);
    try {
      const res = await fetch("/api/configs", { method: "GET" });
      const data = await res.json();
      if (!res.ok || !data?.ok) {
        messageApi.error(data?.error || "获取配置失败");
        return;
      }
      setConfigs(Array.isArray(data.items) ? data.items : []);
    } catch (e) {
      messageApi.error(e instanceof Error ? e.message : String(e));
    } finally {
      setConfigsLoading(false);
    }
  };

  const fetchJob = async (jobId: string) => {
    const res = await fetch(`/api/batch-jobs/${jobId}`, { method: "GET" });
    const data = await res.json();
    if (!res.ok || !data?.ok) throw new Error(data?.error || "获取任务失败");
    setJob(data.job || null);
    setItems(Array.isArray(data.items) ? data.items : []);
    return data.job as Job;
  };

  const startPolling = (jobId: string) => {
    if (pollTimer.current) clearInterval(pollTimer.current);
    setPolling(true);
    pollTimer.current = setInterval(async () => {
      try {
        const j = await fetchJob(jobId);
        if (j?.status === "completed" || j?.status === "failed") {
          if (pollTimer.current) clearInterval(pollTimer.current);
          pollTimer.current = null;
          setPolling(false);
        }
      } catch {
      }
    }, 1200);
  };

  useEffect(() => {
    fetchConfigs();
    const fromQs = (searchParams.get("configIds") || "").trim();
    const qsIds = fromQs ? fromQs.split(",").map((s) => s.trim()).filter(Boolean) : [];
    form.setFieldsValue({ concurrency: 64, configIds: qsIds });
    return () => {
      if (pollTimer.current) clearInterval(pollTimer.current);
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const configOptions = useMemo(() => {
    return configs.map((c) => {
      const label = `${c.appName || "-"} | ${c.lang || "-"} | ${c.batchFun || "-"} | ${c.aspectRatio || "-"} | ${c.count ?? "-"}`;
      return { label, value: c.id };
    });
  }, [configs]);

  const columns: ColumnsType<JobItem> = useMemo(
    () => [
      {
        title: "配置",
        dataIndex: "configId",
        key: "configId",
        width: 360,
        render: (_v, row) => {
          const m = row.configMeta;
          return (
            <Space orientation="vertical" size={0}>
              <Typography.Text strong>
                {(m?.appName || "-")} / {(m?.lang || "-")} / {(m?.batchFun || "-")}
              </Typography.Text>
              <Typography.Text type="secondary">
                {row.configId}
              </Typography.Text>
            </Space>
          );
        },
      },
      {
        title: "进度",
        key: "progress",
        width: 260,
        render: (_v, row) => {
          const total = Number(row.total) || 0;
          const done = Number(row.done) || 0;
          const pct = total ? Math.round((done / total) * 100) : 0;
          return (
            <Space orientation="vertical" style={{ width: "100%" }}>
              <Progress percent={pct} status={row.status === "failed" ? "exception" : undefined} />
              <Typography.Text type="secondary">
                {done} / {total}，{row.status}
              </Typography.Text>
              {row.error ? <Typography.Text type="danger">{row.error}</Typography.Text> : null}
            </Space>
          );
        },
      },
      {
        title: "最新图片",
        key: "images",
        render: (_v, row) => {
          const imgs = Array.isArray(row.images) ? row.images.slice(0, 12) : [];
          if (!imgs.length) return <Typography.Text type="secondary">-</Typography.Text>;
          return (
            <Image.PreviewGroup>
              <Space wrap size={8}>
                {imgs.map((img) => (
                  <Image key={img.url} width={64} alt={img.url} height={64} style={{ objectFit: "cover" }} src={img.url} />
                ))}
              </Space>
            </Image.PreviewGroup>
          );
        },
      },
    ],
    [],
  );

  const onStart = async () => {
    const values = await form.validateFields();
    const configIds = Array.isArray(values.configIds) ? values.configIds : [];
    if (!configIds.length) {
      messageApi.error("请先选择配置");
      return;
    }
    setStarting(true);
    try {
      const res = await fetch("/api/batch-jobs/start", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({
          configIds,
          concurrency: values.concurrency,
        }),
      });
      const data = await res.json();
      if (!res.ok || !data?.ok) {
        messageApi.error(data?.error || "启动失败");
        return;
      }
      const jobId = String(data.jobId);
      await fetchJob(jobId);
      startPolling(jobId);
      messageApi.success(`已启动任务: ${jobId}`);
    } catch (e) {
      messageApi.error(e instanceof Error ? e.message : String(e));
    } finally {
      setStarting(false);
    }
  };

  const onRefreshJob = async () => {
    if (!job?.id) return;
    try {
      await fetchJob(job.id);
    } catch (e) {
      messageApi.error(e instanceof Error ? e.message : String(e));
    }
  };

  const overallPct = job?.total ? Math.round((Number(job.done || 0) / Number(job.total || 0)) * 100) : 0;

  return (
    <AdminShell defaultSelectedKey="/batch" headerTitle="批量生成图片 - 批量生图">
      {contextHolder}
      <Space orientation="vertical" size={16} style={{ width: "100%" }}>
        <Card>
          <Form form={form} layout="inline">
            <Form.Item name="configIds" label="选择配置" rules={[{ required: true, message: "请选择配置" }]}>
              <Select
                mode="multiple"
                style={{ width: 520 }}
                placeholder="可多选"
                loading={configsLoading}
                options={configOptions}
                showSearch={{ optionFilterProp: "label" }}
              />
            </Form.Item>
            <Form.Item name="concurrency" label="并发" rules={[{ required: true }]}>
              <InputNumber min={1} max={99} />
            </Form.Item>
            <Form.Item>
              <Space>
                <Button type="primary" icon={<PlayCircleOutlined />} onClick={onStart} loading={starting}>
                  启动批量任务
                </Button>
                <Button icon={<ReloadOutlined />} onClick={fetchConfigs} loading={configsLoading}>
                  刷新配置
                </Button>
              </Space>
            </Form.Item>
          </Form>
        </Card>

        <Card>
          <Space orientation="vertical" style={{ width: "100%" }} size={8}>
            <Space wrap>
              <Typography.Text strong>任务状态：</Typography.Text>
              <Typography.Text>{job ? `${job.status}（${job.id}）` : "-"}</Typography.Text>
              {job?.error ? <Typography.Text type="danger">{job.error}</Typography.Text> : null}
            </Space>
            <Space wrap>
              <Progress percent={overallPct} status={job?.status === "failed" ? "exception" : undefined} style={{ width: 360 }} />
              <Typography.Text type="secondary">{job ? `${job.done} / ${job.total}` : "-"}</Typography.Text>
              <Button onClick={onRefreshJob} disabled={!job?.id}>
                刷新
              </Button>
              <Typography.Text type="secondary">{polling ? "轮询中..." : ""}</Typography.Text>
            </Space>
          </Space>
        </Card>

        <Card>
          <Table
            rowKey="configId"
            columns={columns}
            dataSource={items}
            pagination={{ pageSize: 20 }}
          />
        </Card>
      </Space>
    </AdminShell>
  );
}

