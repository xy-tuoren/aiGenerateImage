"use client";

import { useEffect, useMemo, useRef, useState } from "react";
import { Button, Card, Form, InputNumber, Progress, Select, Space, Table, Tabs, Typography, message, Image, Tooltip } from "antd";
import type { ColumnsType } from "antd/es/table";
import { PlayCircleOutlined, ReloadOutlined } from "@ant-design/icons";
import { useRouter, useSearchParams } from "next/navigation";
import AdminShell from "@/app/_components/AdminShell";

type ConfigItem = {
  id: string;
  appName?: string;
  lang?: string;
  batchFun?: string;
  imageConfig?: { aspectRatio?: string; [k: string]: any };
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

type JobSummary = {
  id: string;
  status: string;
  total: number;
  done: number;
  error?: string;
  createdAt?: string;
  updatedAt?: string;
};

type JobItem = {
  id?: string;
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

type HistoryItem = {
  id?: string;
  jobId: string;
  configId: string;
  index: number;
  status: string;
  prompt?: string;
  error?: string;
  url?: string;
  createdAt?: string;
  configMeta?: {
    appName?: string;
    lang?: string;
    batchFun?: string;
    aspectRatio?: string;
    prompt?: string;
  };
};

export default function BatchPage() {
  const router = useRouter();
  const searchParams = useSearchParams();
  const [messageApi, contextHolder] = message.useMessage();
  const lastJobIdKey = "batch:lastJobId";
  const recentJobIdsKey = "batch:recentJobIds";

  const [configsLoading, setConfigsLoading] = useState(false);
  const [configs, setConfigs] = useState<ConfigItem[]>([]);
  const [job, setJob] = useState<Job | null>(null);
  const [items, setItems] = useState<JobItem[]>([]);
  const [jobListLoading, setJobListLoading] = useState(false);
  const [jobList, setJobList] = useState<JobSummary[]>([]);
  const [historyLoading, setHistoryLoading] = useState(false);
  const [history, setHistory] = useState<HistoryItem[]>([]);
  const [activeTab, setActiveTab] = useState<"live" | "history">("live");
  const [starting, setStarting] = useState(false);
  const [refreshingAll, setRefreshingAll] = useState(false);
  const [polling, setPolling] = useState(false);
  const pollTimer = useRef<any>(null);
  const [form] = Form.useForm();
  const [livePage, setLivePage] = useState(1);
  const [livePageSize, setLivePageSize] = useState(10);
  const [historyPage, setHistoryPage] = useState(1);
  const [historyPageSize, setHistoryPageSize] = useState(10);

  const readRecentJobIds = () => {
    try {
      const raw = localStorage.getItem(recentJobIdsKey);
      const arr = raw ? JSON.parse(raw) : [];
      return Array.isArray(arr) ? arr.map((x) => String(x || "").trim()).filter(Boolean) : [];
    } catch {
      return [];
    }
  };

  const rememberJobId = (jobId: string) => {
    const id = String(jobId || "").trim();
    if (!id) return;
    try {
      localStorage.setItem(lastJobIdKey, id);
    } catch {
    }
    try {
      const prev = readRecentJobIds();
      const next = [id, ...prev.filter((x) => x !== id)].slice(0, 50);
      localStorage.setItem(recentJobIdsKey, JSON.stringify(next));
    } catch {
    }
  };

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

  const fetchJobList = async () => {
    setJobListLoading(true);
    try {
      const res = await fetch("/api/batch-jobs?limit=200", { method: "GET" });
      const data = await res.json();
      if (!res.ok || !data?.ok) throw new Error(data?.error || "获取任务列表失败");
      setJobList(Array.isArray(data.items) ? data.items : []);
    } catch (e) {
      messageApi.error(e instanceof Error ? e.message : String(e));
    } finally {
      setJobListLoading(false);
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

  const fetchHistory = async () => {
    setHistoryLoading(true);
    try {
      const res = await fetch("/api/generation-records?limit=200", { method: "GET" });
      const data = await res.json();
      if (!res.ok || !data?.ok) {
        messageApi.error(data?.error || "获取历史记录失败");
        return;
      }
      setHistory(Array.isArray(data.items) ? data.items : []);
    } catch (e) {
      messageApi.error(e instanceof Error ? e.message : String(e));
    } finally {
      setHistoryLoading(false);
    }
  };

  const startPolling = (jobId: string) => {
    if (pollTimer.current) clearInterval(pollTimer.current);
    setPolling(true);
    pollTimer.current = setInterval(async () => {
      try {
        const j = await fetchJob(jobId);
        setJobList((prev) => {
          const next = Array.isArray(prev) ? [...prev] : [];
          const idx = next.findIndex((x) => x.id === j?.id);
          const patch = j
            ? {
                id: j.id,
                status: j.status,
                total: j.total,
                done: j.done,
                error: j.error,
                createdAt: j.createdAt,
                updatedAt: j.updatedAt,
              }
            : null;
          if (!patch) return next;
          if (idx >= 0) next[idx] = { ...next[idx], ...patch };
          else next.unshift(patch);
          return next;
        });
        if (j?.status === "completed" || j?.status === "failed") {
          if (pollTimer.current) clearInterval(pollTimer.current);
          pollTimer.current = null;
          setPolling(false);
          fetchHistory();
        }
      } catch {
      }
    }, 1200);
  };

  const openJob = async (jobId: string) => {
    const id = String(jobId || "").trim();
    if (!id) return;
    if (pollTimer.current) clearInterval(pollTimer.current);
    pollTimer.current = null;
    setPolling(false);
    rememberJobId(id);
    try {
      const qs = new URLSearchParams();
      qs.set("jobId", id);
      router.replace(`/batch?${qs.toString()}`);
    } catch {
    }
    try {
      const j = await fetchJob(id);
      if (j?.status !== "completed" && j?.status !== "failed") startPolling(id);
    } catch (e) {
      messageApi.error(e instanceof Error ? e.message : String(e));
    }
  };

  useEffect(() => {
    fetchConfigs();
    fetchHistory();
    const jobIdFromQs = (searchParams.get("jobId") || "").trim();
    const jobIdFromLocal = (() => {
      try {
        return (localStorage.getItem(lastJobIdKey) || "").trim();
      } catch {
        return "";
      }
    })();
    fetchJobList();
    const jobIdFromRecent = (() => {
      const ids = readRecentJobIds();
      return ids[0] || "";
    })();
    const jobId = jobIdFromQs || jobIdFromLocal || jobIdFromRecent;
    if (jobId) openJob(jobId);
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
      const label = `${c.appName || ""}/${c.lang || ""}/${c.imageConfig?.aspectRatio || ""}/${c.count ?? ""}/${c.batchFun || ""}`;
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

  const historyColumns: ColumnsType<HistoryItem> = useMemo(
    () => [
      {
        title: "时间",
        dataIndex: "createdAt",
        key: "createdAt",
        width: 190,
        render: (v) => {
          const s = v ? String(v) : "";
          if (!s) return <Typography.Text type="secondary">-</Typography.Text>;
          const d = new Date(s);
          return <Typography.Text>{Number.isNaN(d.getTime()) ? s : d.toLocaleString()}</Typography.Text>;
        },
      },
      {
        title: "状态",
        dataIndex: "status",
        key: "status",
        width: 110,
        render: (v) => {
          const s = String(v || "-");
          if (s === "failed") return <Typography.Text type="danger">failed</Typography.Text>;
          if (s === "completed") return <Typography.Text type="success">completed</Typography.Text>;
          return <Typography.Text>{s}</Typography.Text>;
        },
      },
      {
        title: "配置",
        key: "config",
        width: 320,
        render: (_v, row) => {
          const m = row.configMeta;
          const idx = Number(row.index);
          const idxText = Number.isFinite(idx) && idx >= 0 ? `#${idx + 1}` : "-";
          return (
            <Space orientation="vertical" size={0}>
              <Typography.Text strong>
                {(m?.appName || "-")} / {(m?.lang || "-")} / {(m?.batchFun || "-")}
              </Typography.Text>
              <Typography.Text type="secondary">
                {row.configId} / {idxText}
              </Typography.Text>
            </Space>
          );
        },
      },
      {
        title: "提示词（实际）",
        dataIndex: "prompt",
        key: "prompt",
        render: (v) => {
          const s = v ? String(v) : "";
          if (!s) return <Typography.Text type="secondary">-</Typography.Text>;
          return <Typography.Paragraph style={{ margin: 0 }} ellipsis={{ rows: 3, expandable: true, symbol: "展开" }}>{s}</Typography.Paragraph>;
        },
      },
      {
        title: "结果",
        key: "result",
        width: 240,
        render: (_v, row) => {
          if (row.url) return <Image width={80} height={80} style={{ objectFit: "cover" }} src={row.url} alt={row.url} />;
          if (row.error) return <Typography.Text type="danger">{row.error}</Typography.Text>;
          return <Typography.Text type="secondary">-</Typography.Text>;
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
      rememberJobId(jobId);
      try {
        const qs = new URLSearchParams();
        qs.set("jobId", jobId);
        qs.set("configIds", configIds.join(","));
        router.replace(`/batch?${qs.toString()}`);
      } catch {
      }
      await fetchJob(jobId);
      startPolling(jobId);
      fetchJobList();
      fetchHistory();
      messageApi.success(`已启动任务: ${jobId}`);
    } catch (e) {
      messageApi.error(e instanceof Error ? e.message : String(e));
    } finally {
      setStarting(false);
    }
  };

  const onRefreshAll = async () => {
    setRefreshingAll(true);
    try {
      const promises: Promise<any>[] = [];
      promises.push(fetchConfigs());
      promises.push(fetchJobList());
      if (job?.id) promises.push(fetchJob(job.id));
      await Promise.all(promises);
    } catch (e) {
      messageApi.error(e instanceof Error ? e.message : String(e));
    } finally {
      setRefreshingAll(false);
    }
  };

  const overallPct = job?.total ? Math.round((Number(job.done || 0) / Number(job.total || 0)) * 100) : 0;

  const jobOptions = useMemo(() => {
    const list = Array.isArray(jobList) ? jobList : [];
    const byId = new Map<string, JobSummary>(list.map((x) => [String(x.id), x]));
    const recent = readRecentJobIds();
    const merged: JobSummary[] = [];
    for (const id of recent) {
      const hit = byId.get(id);
      if (hit) merged.push(hit);
      else merged.push({ id, status: "unknown", total: 0, done: 0 });
    }
    for (const x of list) {
      if (!recent.includes(String(x.id))) merged.push(x);
    }
    return merged.slice(0, 200).map((x) => {
      const pct = x.total ? Math.round((Number(x.done || 0) / Number(x.total || 0)) * 100) : 0;
      const label = `${x.status} ${pct}% ${x.done}/${x.total} ${x.id}`;
      return { label, value: x.id };
    });
  }, [jobList]);

  return (
    <AdminShell defaultSelectedKey="/batch" headerTitle="批量生成图片 - 批量生图">
      {contextHolder}
      <Space orientation="vertical" size={12} style={{ width: "100%" }}>
        <Card styles={{ body: { padding: 12 } }}>
          <Form form={form} layout="inline" size="small">
            <Form.Item name="configIds" label="配置" rules={[{ required: true, message: "请选择配置" }]}>
              <Select
                mode="multiple"
                style={{ width: 260 }}
                placeholder="可多选"
                allowClear
                loading={configsLoading}
                options={configOptions}
                showSearch={{ optionFilterProp: "label" }}
                maxTagCount="responsive"
              />
            </Form.Item>
            <Form.Item name="concurrency" label="并发" rules={[{ required: true }]}>
              <InputNumber min={1} max={99} style={{ width: 90 }} />
            </Form.Item>
            <Form.Item label="任务">
              <Select
                style={{ width: 360 }}
                placeholder="选择任务"
                value={job?.id || undefined}
                options={jobOptions}
                loading={jobListLoading}
                showSearch={{ optionFilterProp: "label" }}
                onChange={(v) => openJob(String(v))}
                allowClear={false}
              />
            </Form.Item>
            <Form.Item>
              <Space.Compact>
                <Tooltip title="启动新的批量任务">
                  <Button size="small" type="primary" icon={<PlayCircleOutlined />} onClick={onStart} loading={starting}>
                    启动
                  </Button>
                </Tooltip>
                <Tooltip title="一键刷新：配置 + 任务列表 + 当前任务">
                  <Button
                    size="small"
                    icon={<ReloadOutlined />}
                    onClick={onRefreshAll}
                    loading={refreshingAll}
                    disabled={configsLoading || jobListLoading || starting}
                  >
                    刷新
                  </Button>
                </Tooltip>
              </Space.Compact>
            </Form.Item>
            <Form.Item>
              <Space wrap size={8} align="center">
                <Typography.Text type="secondary">{job ? job.status : "-"}</Typography.Text>
                <Typography.Text
                  type="secondary"
                  style={{ maxWidth: 220 }}
                  ellipsis
                  copyable={job?.id ? { text: job.id } : false}
                >
                  {job?.id || ""}
                </Typography.Text>
                {job?.error ? <Typography.Text type="danger">{job.error}</Typography.Text> : null}
                <Progress percent={overallPct} size="small" status={job?.status === "failed" ? "exception" : undefined} style={{ width: 140 }} />
                <Typography.Text type="secondary">{job ? `${job.done}/${job.total}` : "-"}</Typography.Text>
                {polling ? <Typography.Text type="secondary">轮询中</Typography.Text> : null}
              </Space>
            </Form.Item>
          </Form>
        </Card>

        <Card styles={{ body: { padding: 0 } }}>
          <Tabs
            activeKey={activeTab}
            onChange={(k) => setActiveTab((k as any) || "live")}
            tabBarStyle={{ paddingLeft: 12, paddingRight: 12, marginBottom: 0 }}
            tabBarExtraContent={
              activeTab === "history" ? (
                <Button size="small" icon={<ReloadOutlined />} onClick={fetchHistory} loading={historyLoading}>
                  刷新历史
                </Button>
              ) : (
                <Typography.Text type="secondary" style={{ paddingRight: 8 }}>
                  {job?.id ? `当前任务：${job.id}` : ""}
                </Typography.Text>
              )
            }
            items={[
              {
                key: "live",
                label: "实时任务",
                children: (
                  <div style={{ padding: 12 }}>
                    <Table
                      rowKey={(row) => (row as any).id || (row as any).configId}
                      columns={columns}
                      dataSource={items}
                      pagination={{
                        current: livePage,
                        pageSize: livePageSize,
                        defaultPageSize: 10,
                        showSizeChanger: true,
                        pageSizeOptions: ["10", "20", "50", "100"],
                        showTotal: (total) => {
                          const pages = Math.max(1, Math.ceil((Number(total) || 0) / (Number(livePageSize) || 10)));
                          return `${pages} 页/共 ${total} 条`;
                        },
                        onChange: (page, pageSize) => {
                          setLivePage(page);
                          if (pageSize !== livePageSize) {
                            setLivePageSize(pageSize);
                            setLivePage(1);
                          }
                        },
                      }}
                    />
                  </div>
                ),
              },
              {
                key: "history",
                label: "历史记录",
                children: (
                  <div style={{ padding: 12 }}>
                    <Table
                      rowKey={(row) => row.id || `${row.jobId}-${row.configId}-${row.index}-${row.createdAt || ""}`}
                      columns={historyColumns}
                      dataSource={history}
                      loading={historyLoading}
                      pagination={{
                        current: historyPage,
                        pageSize: historyPageSize,
                        defaultPageSize: 10,
                        showSizeChanger: true,
                        pageSizeOptions: ["10", "20", "50", "100"],
                        showTotal: (total) => {
                          const pages = Math.max(1, Math.ceil((Number(total) || 0) / (Number(historyPageSize) || 10)));
                          return `共 ${total} 条 / ${pages} 页`;
                        },
                        onChange: (page, pageSize) => {
                          setHistoryPage(page);
                          if (pageSize !== historyPageSize) {
                            setHistoryPageSize(pageSize);
                            setHistoryPage(1);
                          }
                        },
                      }}
                    />
                  </div>
                ),
              },
            ]}
          />
        </Card>
      </Space>
    </AdminShell>
  );
}

