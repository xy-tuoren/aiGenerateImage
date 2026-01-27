"use client";

import { useEffect, useMemo, useRef, useState } from "react";
import { Button, Card, Form, InputNumber, Progress, Select, Space, Table, Tabs, Typography, message, Image, Tooltip } from "antd";
import type { ColumnsType } from "antd/es/table";
import { PlayCircleOutlined, ReloadOutlined } from "@ant-design/icons";
import { useRouter, useSearchParams } from "next/navigation";
import AdminShell from "@/app/_components/AdminShell";

const IMAGE_FALLBACK_SVG =
  "data:image/svg+xml;utf8,%3Csvg%20xmlns%3D%22http%3A//www.w3.org/2000/svg%22%20width%3D%2296%22%20height%3D%2296%22%20viewBox%3D%220%200%2096%2096%22%3E%3Crect%20width%3D%2296%22%20height%3D%2296%22%20rx%3D%228%22%20fill%3D%22%23f5f5f5%22/%3E%3Cpath%20d%3D%22M24%2064l12-12%2010%2010%208-8%2018%2018H24z%22%20fill%3D%22%23bfbfbf%22/%3E%3Ccircle%20cx%3D%2236%22%20cy%3D%2238%22%20r%3D%226%22%20fill%3D%22%23bfbfbf%22/%3E%3Ctext%20x%3D%2248%22%20y%3D%2288%22%20text-anchor%3D%22middle%22%20font-size%3D%2212%22%20fill%3D%22%23999999%22%3E%E5%8A%A0%E8%BD%BD%E5%A4%B1%E8%B4%A5%3C/text%3E%3C/svg%3E";

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
  configId: string;
  status: string;
  prompt?: string;
  createdAt?: string;
  jobId?: string;
  referenceImages?: string[];
  images: Array<{ url: string; index?: number; createdAt?: string; mimeType?: string; jobId?: string }>;
  errors?: string[];
  configMeta?: {
    appName?: string;
    lang?: string;
    batchFun?: string;
    aspectRatio?: string;
    prompt?: string;
    referenceImages?: string[];
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
  const [historyPromptExpanded, setHistoryPromptExpanded] = useState<Record<string, boolean>>({});
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
      const arr = Array.isArray(data.items) ? data.items : [];
      const byKey = new Map<string, any>();
      for (const it of arr) {
        const configId = String((it as any).configId || "").trim();
        const jobId = String((it as any).jobId || "").trim();
        if (!configId) continue;
        const key = jobId ? `${jobId}|${configId}` : configId;
        const refImgs = (it as any).referenceImages ?? (it as any).configMeta?.referenceImages;
        const g = byKey.get(key) || {
          id: key,
          configId,
          createdAt: "",
          jobId: "",
          prompt: "",
          configMeta: (it as any).configMeta,
          referenceImages: refImgs,
          images: [],
          errors: [],
          _hasCompleted: false,
          _hasFailed: false,
          _hasRunning: false,
          _hasQueued: false,
        };
        const createdAt = (it as any).createdAt ? String((it as any).createdAt) : "";
        if (!g.createdAt || (createdAt && new Date(createdAt).getTime() > new Date(g.createdAt).getTime())) {
          g.createdAt = createdAt || g.createdAt;
          g.jobId = (it as any).jobId || g.jobId;
          g.prompt = (it as any).prompt || g.prompt;
          if ((it as any).configMeta) g.configMeta = (it as any).configMeta;
          if (refImgs) g.referenceImages = refImgs;
        }
        if ((!g.referenceImages || !Array.isArray(g.referenceImages) || !g.referenceImages.length) && refImgs) g.referenceImages = refImgs;
        const st = String((it as any).status || "");
        if (st === "completed") g._hasCompleted = true;
        else if (st === "failed") g._hasFailed = true;
        else if (st === "running") g._hasRunning = true;
        else if (st === "queued") g._hasQueued = true;
        const url = (it as any).url ? String((it as any).url) : "";
        if (url) g.images.push({ url, index: (it as any).index, createdAt, mimeType: (it as any).mimeType, jobId: (it as any).jobId });
        const err = (it as any).error ? String((it as any).error) : "";
        if (err) g.errors.push(err);
        byKey.set(key, g);
      }
      const grouped = Array.from(byKey.values()).map((g: any) => {
        const status = g._hasFailed && !g._hasCompleted ? "failed" : g._hasCompleted ? "completed" : g._hasRunning ? "running" : g._hasQueued ? "queued" : "unknown";
        return {
          id: g.id,
          configId: g.configId,
          status,
          prompt: g.prompt,
          createdAt: g.createdAt,
          jobId: g.jobId || undefined,
          referenceImages: Array.isArray(g.referenceImages) ? g.referenceImages : undefined,
          images: Array.isArray(g.images) ? g.images : [],
          errors: Array.isArray(g.errors) ? g.errors : [],
          configMeta: g.configMeta,
        } as HistoryItem;
      }).sort((a, b) => new Date(b.createdAt || 0 as any).getTime() - new Date(a.createdAt || 0 as any).getTime());
      setHistory(grouped);
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
    form.setFieldsValue({ concurrency: 64, configIds: qsIds, actualCount: undefined });
    return () => {
      if (pollTimer.current) clearInterval(pollTimer.current);
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  useEffect(() => {
    const onStorage = (ev: StorageEvent) => {
      try {
        const k = String(ev?.key || "");
        if (k !== lastJobIdKey && k !== recentJobIdsKey) return;
        const id = (() => {
          try {
            return (localStorage.getItem(lastJobIdKey) || "").trim();
          } catch {
            return "";
          }
        })();
        if (!id) return;
        if (id && id !== (job?.id || "")) {
          fetchJobList();
          openJob(id);
        }
      } catch {
      }
    };
    window.addEventListener("storage", onStorage);
    return () => window.removeEventListener("storage", onStorage);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [job?.id]);

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
                {(m?.appName || "")} / {(m?.lang || "")} / {(m?.aspectRatio || "")} / {(m?.batchFun || "")}
              </Typography.Text>
              <Typography.Text type="secondary">
                configId: {row.configId}
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
                  <Image key={img.url} width={64} alt="生成图" height={64} style={{ objectFit: "cover" }} src={img.url} fallback={IMAGE_FALLBACK_SVG} />
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
        width: 140,
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
        width: 80,
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
        width: 210,
        render: (_v, row) => {
          const m = row.configMeta;
          const cnt = Array.isArray(row.images) ? row.images.length : 0;
          return (
            <Space orientation="vertical" size={0}>
              <Typography.Text strong>
                {(m?.appName || "")} / {(m?.lang || "")} / {(m?.aspectRatio || "")}
              </Typography.Text>
              <Typography.Text type="secondary">
                <Typography.Text style={{ maxWidth: 200 }} ellipsis title={row.configId}>
                  {row.configId}
                </Typography.Text>{" "}
                {cnt ? `(${cnt})` : ""}
              </Typography.Text>
            </Space>
          );
        },
      },
      {
        title: "参考图",
        key: "referenceImages",
        width: 220,
        render: (_v, row) => {
          const refs0 = Array.isArray((row as any).referenceImages) ? (row as any).referenceImages : [];
          const refs1 = Array.isArray((row as any).configMeta?.referenceImages) ? (row as any).configMeta.referenceImages : [];
          const refs = refs0.length ? refs0 : refs1;
          const show = refs.slice(0, 4);
          const rest = Math.max(0, refs.length - show.length);
          if (!show.length) return <Typography.Text type="secondary">-</Typography.Text>;
          return (
            <Image.PreviewGroup>
              <Space size={6} wrap={false}>
                {show.map((src: string, idx: number) => (
                  <Image key={`${src}|${idx}`} width={48} alt="参考图" height={48} style={{ objectFit: "cover" }} src={src} fallback={IMAGE_FALLBACK_SVG} />
                ))}
                {rest ? (
                  <div
                    style={{
                      width: 48,
                      height: 48,
                      borderRadius: 4,
                      background: "#f5f5f5",
                      display: "flex",
                      alignItems: "center",
                      justifyContent: "center",
                      color: "rgba(0,0,0,0.45)",
                      fontSize: 12,
                      flex: "0 0 auto",
                    }}
                    title={`还有 ${rest} 张`}
                  >
                    ...(+{rest})
                  </div>
                ) : null}
              </Space>
            </Image.PreviewGroup>
          );
        },
      },
      {
        title: "提示词",
        dataIndex: "prompt",
        key: "prompt",
        width: 250,
        render: (v, row) => {
          const s = v ? String(v) : "";
          if (!s) return <Typography.Text type="secondary">-</Typography.Text>;
          const k = String((row as any).id || `${(row as any).jobId || ""}|${(row as any).configId || ""}`);
          const expanded = Boolean(historyPromptExpanded[k]);
          const canToggle = s.length > 60;
          return (
            <div>
              <Typography.Paragraph style={{ margin: 0, maxWidth: 250 }} ellipsis={expanded ? false : { rows: 2 }}>
                {s}
              </Typography.Paragraph>
              {canToggle ? (
                <Typography.Link
                  onClick={() => {
                    setHistoryPromptExpanded((prev) => ({ ...prev, [k]: !expanded }));
                  }}
                >
                  {expanded ? "收起" : "展开"}
                </Typography.Link>
              ) : null}
            </div>
          );
        },
      },
      {
        title: "结果",
        key: "result",
        width: 680,
        render: (_v, row) => {
          const all = Array.isArray(row.images) ? row.images : [];
          const show = all.slice(0, 10);
          const rest = Math.max(0, all.length - show.length);
          if (show.length) {
            return (
              <Image.PreviewGroup>
                <Space size={6} wrap={false}>
                  {show.map((img) => (
                    <Image key={img.url} width={72} alt="生成图" height={72} style={{ objectFit: "cover" }} src={img.url} fallback={IMAGE_FALLBACK_SVG} />
                  ))}
                  {rest ? (
                    <div
                      style={{
                        width: 72,
                        height: 72,
                        borderRadius: 4,
                        background: "#f5f5f5",
                        display: "flex",
                        alignItems: "center",
                        justifyContent: "center",
                        color: "rgba(0,0,0,0.45)",
                        fontSize: 12,
                        flex: "0 0 auto",
                      }}
                      title={`还有 ${rest} 张`}
                    >
                      ...(+{rest})
                    </div>
                  ) : null}
                </Space>
              </Image.PreviewGroup>
            );
          }
          const err = Array.isArray(row.errors) ? row.errors.filter(Boolean)[0] : "";
          if (err) return <Typography.Text type="danger">{err}</Typography.Text>;
          return <Typography.Text type="secondary">-</Typography.Text>;
        },
      },
    ],
    [historyPromptExpanded],
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
      const actualCountRaw = values.actualCount;
      const actualCountNum = actualCountRaw === undefined || actualCountRaw === null || actualCountRaw === "" ? undefined : Number(actualCountRaw);
      const actualCount = typeof actualCountNum === "number" && Number.isFinite(actualCountNum) ? Math.max(0, Math.floor(actualCountNum)) : undefined;
      const res = await fetch("/api/batch-jobs/start", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({
          configIds,
          concurrency: values.concurrency,
          actualCount,
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
      const total = data?.total !== undefined && data?.total !== null ? String(data.total) : "";
      const ac = data?.actualCount !== undefined && data?.actualCount !== null ? String(data.actualCount) : "";
      messageApi.success(`已启动任务: ${jobId}${ac ? `，实际数量=${ac}` : ""}${total ? `，总数=${total}` : ""}`);
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
      <Space orientation="vertical" size={8} style={{ width: "100%" }}>
        <Card styles={{ body: { padding: 8 } }}>
          <Form form={form} layout="inline" size="small" style={{ display: "flex", flexWrap: "wrap", gap: 8, alignItems: "flex-end" }}>
            <Form.Item name="configIds" label={<span>配置 <span style={{ color: "#ff4d4f" }}>*</span></span>} rules={[{ required: true, message: "请选择配置" }]} style={{ marginBottom: 0 }}>
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
            <Form.Item name="concurrency" label={<span>并发 <span style={{ color: "#ff4d4f" }}>*</span></span>} rules={[{ required: true }]} style={{ marginBottom: 0 }}>
              <InputNumber min={1} max={99} style={{ width: 90 }} />
            </Form.Item>
            <Form.Item name="actualCount" label="实际数量" style={{ marginBottom: 0 }}>
              <InputNumber min={0} step={1} style={{ width: 110 }} placeholder="可选" />
            </Form.Item>
            <Form.Item label="任务" style={{ marginBottom: 0 }}>
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
            <Form.Item style={{ marginBottom: 0 }}>
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
            {job?.id && (
              <div style={{ marginTop: 8, padding: 6, background: "#f5f5f5", borderRadius: 6 }}>
                <Space wrap size={8} align="center" style={{ width: "100%" }}>
                  <Typography.Text strong style={{ color: job.status === "completed" ? "#52c41a" : job.status === "failed" ? "#ff4d4f" : "#1890ff" }}>
                    {job.status || "-"}
                  </Typography.Text>
                  <Typography.Text
                    type="secondary"
                    style={{ maxWidth: 240 }}
                    ellipsis
                    copyable={job?.id ? { text: job.id } : false}
                  >
                    {job?.id || ""}
                  </Typography.Text>
                  {job?.error ? <Typography.Text type="danger">{job.error}</Typography.Text> : null}
                  <Progress 
                    percent={overallPct} 
                    size="small" 
                    status={job?.status === "failed" ? "exception" : undefined} 
                    style={{ width: 160, minWidth: 160 }} 
                  />
                  <Typography.Text type="secondary" strong>{job ? `${job.done}/${job.total}` : "-"}</Typography.Text>
                  {polling ? (
                    <Typography.Text type="secondary" style={{ color: "#1890ff" }}>
                      <ReloadOutlined spin style={{ marginRight: 4 }} />
                      轮询中
                    </Typography.Text>
                  ) : null}
                </Space>
              </div>
            )}
          </Form>
        </Card>

        <Card styles={{ body: { padding: 0 } }}>
          <Tabs
            activeKey={activeTab}
            onChange={(k) => setActiveTab((k as any) || "live")}
            tabBarStyle={{ paddingLeft: 8, paddingRight: 8, marginBottom: 0 }}
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
                  <div style={{ padding: 8 }}>
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
                  <div style={{ padding: 8 }}>
                    <Table
                      rowKey={(row) => row.id || `${row.jobId || ""}|${row.configId}`}
                      columns={historyColumns}
                      dataSource={history}
                      loading={historyLoading}
                      size="small"
                      tableLayout="fixed"
                      scroll={{ x: 1400 }}
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

