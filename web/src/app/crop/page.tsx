"use client";

import { useCallback, useEffect, useMemo, useState } from "react";
import { Button, Card, Image, Input, InputNumber, Select, Space, Table, Typography, message } from "antd";
import { ReloadOutlined } from "@ant-design/icons";
import AdminShell from "@/app/_components/AdminShell";
import { SUPPORTED_LANGUAGES } from "@/common/constants";

type CutRecordOutputItem = {
  status: string;
  outputUrl?: string;
  outputMimeType?: string;
  error?: string;
  updatedAt?: string;
};

type CutRecordItem = {
  id: string;
  jobId?: string;
  sourceUrl: string;
  sourceAbsPath?: string;
  appName?: string;
  lang?: string;
  status: string;
  createdAt?: string;
  updatedAt?: string;
  outputs?: Record<string, Record<string, CutRecordOutputItem>>;
};

export default function CropPage() {
  const [messageApi, contextHolder] = message.useMessage();
  const [recordsLoading, setRecordsLoading] = useState(false);
  const [records, setRecords] = useState<CutRecordItem[]>([]);
  const batchLastJobIdKey = "batch:lastJobId";
  const batchRecentJobIdsKey = "batch:recentJobIds";
  const outputThumbSize = 88;
  const sourceThumbSize = 160;
  const [selectedRowKeys, setSelectedRowKeys] = useState<string[]>([]);
  const [downloadStartFolderIndex, setDownloadStartFolderIndex] = useState<number>(1);
  const [downloadFixedCode, setDownloadFixedCode] = useState<string>("404");
  const [downloadZipName, setDownloadZipName] = useState<string>("");
  const [downloading, setDownloading] = useState(false);
  const [regenerating, setRegenerating] = useState(false);
  const [excludedKeys, setExcludedKeys] = useState<Record<string, true>>({});
  const [previewOpen, setPreviewOpen] = useState(false);
  const [previewItems, setPreviewItems] = useState<{ k: string; url: string }[]>([]);
  const [previewIndex, setPreviewIndex] = useState(0);
  const [activePreviewKey, setActivePreviewKey] = useState<string | null>(null);
  const [cropPage, setCropPage] = useState(1);
  const [cropPageSize, setCropPageSize] = useState(10);
  const [appName, setAppName] = useState<string>("");
  const [lang, setLang] = useState<string>("");
  const [appNameOptions, setAppNameOptions] = useState<Array<{ label: string; value: string }>>([]);

  const fetchRecords = async () => {
    setRecordsLoading(true);
    try {
      const qs = new URLSearchParams();
      qs.set("limit", "5000");
      const res = await fetch(`/api/cut-records?${qs.toString()}`, { method: "GET" });
      const data = await res.json();
      if (!res.ok || !data?.ok) {
        messageApi.error(data?.error || "获取裁图记录失败");
        return;
      }
      const arr = Array.isArray(data.items) ? data.items : [];
      setRecords(arr);
    } catch (e) {
      messageApi.error(e instanceof Error ? e.message : String(e));
    } finally {
      setRecordsLoading(false);
    }
  };

  const downloadSelected = async () => {
    if (!selectedRowKeys.length) {
      messageApi.warning("请先选择要下载的记录");
      return;
    }
    setDownloading(true);
    try {
      const res = await fetch("/api/cut-records/download", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          ids: selectedRowKeys,
          startFolderIndex: downloadStartFolderIndex,
          fixedCode: downloadFixedCode,
          excludedKeys: Object.keys(excludedKeys),
        }),
      });
      if (!res.ok) {
        const data = await res.json().catch(() => null);
        throw new Error((data as any)?.error || `下载失败(${res.status})`);
      }
      const blob = await res.blob();
      const cd = res.headers.get("Content-Disposition") || "";
      const m = /filename="([^"]+)"/.exec(cd);
      const suggestedName = (downloadZipName || "").trim() || m?.[1] || `cut-download-${Date.now()}.zip`;

      const w = window as any;
      if (typeof w.showSaveFilePicker === "function") {
        const handle = await w.showSaveFilePicker({
          suggestedName,
          types: [
            { description: "Zip", accept: { "application/zip": [".zip"] } },
          ],
        });
        const writable = await handle.createWritable();
        await writable.write(blob);
        await writable.close();
        messageApi.success("已保存");
        return;
      }

      const url = window.URL.createObjectURL(blob);
      const a = document.createElement("a");
      a.href = url;
      a.download = suggestedName;
      document.body.appendChild(a);
      a.click();
      a.remove();
      window.URL.revokeObjectURL(url);
    } catch (e) {
      const anyErr = e as any;
      const name = anyErr?.name ? String(anyErr.name) : "";
      if (name === "AbortError") return;
      messageApi.error(e instanceof Error ? e.message : String(e));
    } finally {
      setDownloading(false);
    }
  };

  const recordIdToRow = useMemo(() => {
    const m = new Map<string, CutRecordItem>();
    for (const r of records) m.set(String(r.id), r);
    return m;
  }, [records]);

  const sortedRecords = useMemo(() => {
    const byJob = new Map<string, CutRecordItem[]>();
    for (const r of records) {
      const j = r.jobId ?? "";
      if (!byJob.has(j)) byJob.set(j, []);
      byJob.get(j)!.push(r);
    }
    const groups = Array.from(byJob.entries()).map(([jobId, list]) => ({
      jobId,
      list,
      latestAt: Math.max(...list.map((x) => new Date(x.updatedAt || x.createdAt || 0).getTime())),
    }));
    groups.sort((a, b) => b.latestAt - a.latestAt);
    const out: CutRecordItem[] = [];
    for (const g of groups) {
      g.list.sort(
        (a, b) =>
          String(a.lang ?? "").localeCompare(String(b.lang ?? "")) ||
          new Date(a.createdAt || 0).getTime() - new Date(b.createdAt || 0).getTime()
      );
      out.push(...g.list);
    }
    return out;
  }, [records]);

  const filteredRecords = useMemo(() => {
    let arr = sortedRecords;
    if (appName) arr = arr.filter((r) => String(r.appName ?? "").trim() === appName);
    if (lang) arr = arr.filter((r) => String(r.lang ?? "").trim() === lang);
    return arr;
  }, [sortedRecords, appName, lang]);

  const excludedKeysScoped = useMemo(() => {
    const keys = Object.keys(excludedKeys || {});
    if (!keys.length) return [];
    if (!selectedRowKeys.length) return keys;
    const selectedSet = new Set(selectedRowKeys);
    return keys.filter((k) => {
      const id = k.split("|", 1)[0];
      return id && selectedSet.has(id);
    });
  }, [excludedKeys, selectedRowKeys]);

  const regenerateExcluded = async () => {
    if (!excludedKeysScoped.length) {
      messageApi.warning(selectedRowKeys.length ? "选中记录中没有置灰的图片" : "当前没有置灰的图片");
      return;
    }
    setRegenerating(true);
    try {
      const items: Array<{ sourceUrl: string; ratio: string; templateName: string; appName?: string; lang?: string }> = [];
      for (const k of excludedKeysScoped) {
        const [id, ratio, templateName] = k.split("|");
        if (!id || !ratio || !templateName) continue;
        const row = recordIdToRow.get(id);
        if (!row?.sourceUrl) continue;
        items.push({
          sourceUrl: String(row.sourceUrl),
          ratio: String(ratio),
          templateName: String(templateName),
          appName: row.appName ? String(row.appName) : undefined,
          lang: row.lang ? String(row.lang) : undefined,
        });
      }
      if (!items.length) {
        messageApi.warning("没有可重新生成的图片");
        return;
      }

      const res = await fetch("/api/cut-jobs/start", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ items, concurrency: 32 }),
      });
      const data = await res.json().catch(() => null);
      if (!res.ok || !data?.ok) {
        throw new Error((data as any)?.error || "重新生成失败");
      }

      try {
        const jobId = String((data as any)?.jobId || "").trim();
        if (jobId) {
          localStorage.setItem(batchLastJobIdKey, jobId);
          const raw = localStorage.getItem(batchRecentJobIdsKey);
          const arr = raw ? JSON.parse(raw) : [];
          const prev = Array.isArray(arr) ? arr.map((x: any) => String(x || "").trim()).filter(Boolean) : [];
          const next = [jobId, ...prev.filter((x: string) => x !== jobId)].slice(0, 50);
          localStorage.setItem(batchRecentJobIdsKey, JSON.stringify(next));
        }
      } catch {
      }

      setExcludedKeys((prev) => {
        const next = { ...(prev || {}) };
        for (const k of excludedKeysScoped) delete next[k];
        return next;
      });

      messageApi.success(`已创建重新生成任务: ${String(data.jobId || "") || "-"}`);
      fetchRecords();
    } catch (e) {
      messageApi.error(e instanceof Error ? e.message : String(e));
    } finally {
      setRegenerating(false);
    }
  };

  const toggleExclude = useCallback((k: string) => {
    setExcludedKeys((prev) => {
      const next = { ...prev };
      if (next[k]) delete next[k];
      else next[k] = true;
      return next;
    });
  }, []);

  const buildRowPreviewItems = useCallback((row: CutRecordItem) => {
    const outs = row.outputs && typeof row.outputs === "object" ? row.outputs : undefined;
    if (!outs) return [];
    const ratioOrder: Record<string, number> = { "1:1": 1, "4:5": 2, "16:9": 3, "9:16": 4 };
    const ratios = Object.keys(outs).sort((a, b) => (ratioOrder[a] ?? 999) - (ratioOrder[b] ?? 999) || a.localeCompare(b));
    const templateOrder = ["getCutLogoFinalPrompt", "getCutOtherFinalPrompt", "getCutScaleFinalPrompt"];
    const items: { k: string; url: string }[] = [];
    for (const ratio of ratios) {
      const byTpl = outs[ratio];
      if (!byTpl || typeof byTpl !== "object") continue;
      const tplNames = Object.keys(byTpl).sort();
      const orderedTpls = [...templateOrder, ...tplNames.filter((t) => !templateOrder.includes(t))];
      for (const tpl of orderedTpls) {
        const it = (byTpl as any)[tpl] as CutRecordOutputItem | undefined;
        const url = it?.outputUrl ? String(it.outputUrl) : "";
        if (!url) continue;
        items.push({ k: `${row.id}|${ratio}|${tpl}`, url });
      }
    }
    return items;
  }, []);

  const openRowPreview = useCallback((row: CutRecordItem, k: string) => {
    const items = buildRowPreviewItems(row);
    if (!items.length) return;
    const idx = Math.max(0, items.findIndex((x) => x.k === k));
    setPreviewItems(items);
    setPreviewIndex(idx);
    setActivePreviewKey(items[idx]?.k || null);
    setPreviewOpen(true);
  }, [buildRowPreviewItems]);

  useEffect(() => {
    fetchRecords();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  useEffect(() => {
    (async () => {
      try {
        const res = await fetch("/api/app-names", { method: "GET" });
        const data = await res.json();
        if (!res.ok || !data?.ok) return;
        const arr = Array.isArray(data.items) ? data.items : [];
        setAppNameOptions(arr.map((x: string) => ({ label: String(x), value: String(x) })));
      } catch {
        //
      }
    })();
  }, []);

  useEffect(() => {
    setCropPage(1);
  }, [appName, lang]);

  useEffect(() => {
    const onKeyDown = (e: KeyboardEvent) => {
      if (!previewOpen || !activePreviewKey) return;
      if (String(e.key || "").toLowerCase() !== "x") return;
      e.preventDefault();
      toggleExclude(activePreviewKey);
      if (previewItems.length <= 1) {
        setPreviewOpen(false);
        setActivePreviewKey(null);
        return;
      }
      const next = (previewIndex + 1) % previewItems.length;
      setPreviewIndex(next);
      setActivePreviewKey(previewItems[next]?.k || null);
    };
    window.addEventListener("keydown", onKeyDown);
    return () => window.removeEventListener("keydown", onKeyDown);
  }, [activePreviewKey, previewOpen, previewIndex, previewItems, toggleExclude]);

  const ratioKeys = useMemo(() => {
    const set = new Set<string>();
    for (const r of records) {
      const outs = r.outputs && typeof r.outputs === "object" ? r.outputs : undefined;
      if (!outs) continue;
      for (const k of Object.keys(outs)) set.add(k);
    }
    const arr = [...set];
    if (!arr.length) return ["1:1", "4:5"];
    const order: Record<string, number> = { "1:1": 1, "4:5": 2, "16:9": 3, "9:16": 4 };
    return arr.sort((a, b) => (order[a] ?? 999) - (order[b] ?? 999) || a.localeCompare(b));
  }, [records]);

  const columns = useMemo(() => {
    const base: any[] = [
      {
        title: "时间",
        dataIndex: "updatedAt",
        key: "updatedAt",
        width: 120,
        align: "center",
        render: (v: any, row: CutRecordItem) => {
          const s = (v || row.createdAt) ? String(v || row.createdAt) : "";
          if (!s) return <Typography.Text type="secondary">-</Typography.Text>;
          const d = new Date(s);
          return <Typography.Text>{Number.isNaN(d.getTime()) ? s : d.toLocaleString()}</Typography.Text>;
        },
      },
      { title: "状态", dataIndex: "status", key: "status", width: 80, align: "center" },
      {
        title: "原图",
        dataIndex: "sourceUrl",
        key: "sourceUrl",
        width: 180,
        align: "center",
        render: (v: any) => {
          const s = v ? String(v) : "";
          return s ? <Image width={sourceThumbSize} style={{ height: "auto" }} src={s} alt={s} /> : <Typography.Text type="secondary">-</Typography.Text>;
        },
      },
    ];

    const ratioCols = ratioKeys.map((ratio) => ({
      title: ratio,
      key: `ratio:${ratio}`,
      width: 380,
      align: "center",
      render: (_v: any, row: CutRecordItem) => {
        const byTpl = row.outputs && row.outputs[ratio] ? row.outputs[ratio] : undefined;
        if (!byTpl || typeof byTpl !== "object") return <Typography.Text type="secondary">-</Typography.Text>;
        const tplNames = Object.keys(byTpl).sort();
        if (!tplNames.length) return <Typography.Text type="secondary">-</Typography.Text>;
        const items = tplNames.map((tpl) => {
          const it = byTpl[tpl];
          const url = it?.outputUrl ? String(it.outputUrl) : "";
          const err = it?.error ? String(it.error) : "";
          const st = it?.status ? String(it.status) : "";
          const k = `${row.id}|${ratio}|${tpl}`;
          return { tpl, url, err, st, k };
        });
        const hasAnyUrl = items.some((it) => it.url);
        if (!hasAnyUrl) return <Typography.Text type="secondary">-</Typography.Text>;
        return (
          <div
            style={{
              display: "flex",
              flexWrap: "wrap",
              gap: 6,
              overflow: "hidden",
              justifyContent: "center",
            }}
          >
            {items
              .filter((it) => it.url)
              .map((it) => (
                <div
                  key={it.tpl}
                  title={it.tpl}
                  style={{ width: outputThumbSize, filter: excludedKeys[it.k] ? "grayscale(1) opacity(0.35)" : undefined }}
                  onContextMenu={(e) => {
                    e.preventDefault();
                    toggleExclude(it.k);
                  }}
                  onClick={() => openRowPreview(row, it.k)}
                >
                  <Image
                    width={outputThumbSize}
                    style={{ height: "auto" }}
                    src={it.url}
                    alt={it.tpl}
                    preview={false}
                  />
                </div>
              ))}
          </div>
        );
      },
    }));

    base.push(...ratioCols);
    base.push(
      {
        title: "appName",
        dataIndex: "appName",
        key: "appName",
        width: 100,
        align: "center",
        render: (v: any) => {
          const s = v ? String(v) : "";
          return s ? <Typography.Text>{s}</Typography.Text> : <Typography.Text type="secondary">-</Typography.Text>;
        },
      },
      {
        title: "lang",
        dataIndex: "lang",
        key: "lang",
        width: 50,
        align: "center",
        render: (v: any) => {
          const s = v ? String(v) : "";
          return s ? <Typography.Text>{s}</Typography.Text> : <Typography.Text type="secondary">-</Typography.Text>;
        },
      },
    );
    base.push({
      title: "任务",
      dataIndex: "jobId",
      key: "jobId",
      width: 100,
      align: "center",
      render: (v: any) => {
        const s = v ? String(v) : "";
        return s ? (
          <Typography.Link href={`/batch?jobId=${encodeURIComponent(s)}`} target="_blank">
            {s}
          </Typography.Link>
        ) : (
          <Typography.Text type="secondary">-</Typography.Text>
        );
      },
    });

    return base;
  }, [ratioKeys, excludedKeys, openRowPreview, toggleExclude]);

  return (
    <AdminShell defaultSelectedKey="/crop" headerTitle="裁图展示">
      {contextHolder}
      <Card styles={{ body: { padding: 8 } }}>
        <Image.PreviewGroup
          items={previewItems.map((x) => x.url)}
          preview={{
            open: previewOpen,
            current: previewIndex,
            onOpenChange: (open, info: any) => {
              setPreviewOpen(open);
              if (!open) setActivePreviewKey(null);
              else {
                const c = typeof info?.current === "number" ? info.current : 0;
                setPreviewIndex(c);
                setActivePreviewKey(previewItems[c]?.k || null);
              }
            },
            onChange: (current: number) => {
              setPreviewIndex(current);
              setActivePreviewKey(previewItems[current]?.k || null);
            },
          }}
        />
        <Space wrap style={{ marginBottom: 8 }} size={8}>
          <Typography.Text strong>appName：</Typography.Text>
          <Select
            size="small"
            allowClear
            showSearch
            placeholder="全部"
            style={{ width: 180 }}
            value={appName || undefined}
            options={appNameOptions}
            filterOption={(input, option) =>
              (option?.label ?? "").toString().toLowerCase().includes((input || "").toLowerCase())
            }
            onChange={(v) => setAppName(String(v ?? ""))}
          />
          <Typography.Text strong>lang：</Typography.Text>
          <Select
            size="small"
            allowClear
            placeholder="全部"
            style={{ width: 120 }}
            value={lang || undefined}
            options={SUPPORTED_LANGUAGES.map((x) => ({ label: x, value: x }))}
            onChange={(v) => setLang(String(v ?? ""))}
          />
          <Button size="small" icon={<ReloadOutlined />} onClick={fetchRecords} loading={recordsLoading}>
            刷新
          </Button>
          <Typography.Text type="secondary">{recordsLoading ? "加载中..." : `${filteredRecords.length} 条`}</Typography.Text>
          <Space size={6}>
            <Typography.Text type="secondary">起始序号</Typography.Text>
            <InputNumber size="small" min={1} value={downloadStartFolderIndex} onChange={(v) => setDownloadStartFolderIndex(Number(v || 1))} />
            <Typography.Text type="secondary">固定码</Typography.Text>
            <Input size="small" style={{ width: 90 }} value={downloadFixedCode} onChange={(e) => setDownloadFixedCode(e.target.value)} />
            {/* <Typography.Text type="secondary">文件名</Typography.Text>
            <Input
              size="small"
              style={{ width: 220 }}
              placeholder="留空则自动，例如 cut-download-xxx.zip"
              value={downloadZipName}
              onChange={(e) => setDownloadZipName(e.target.value)}
            /> */}
            <Button size="small" type="primary" disabled={!selectedRowKeys.length} loading={downloading} onClick={downloadSelected}>
              下载选中({selectedRowKeys.length})
            </Button>
            <Button size="small" disabled={!selectedRowKeys.length} onClick={() => setSelectedRowKeys([])}>
              清空选择
            </Button>
            <Button
              size="small"
              disabled={!excludedKeysScoped.length}
              loading={regenerating}
              onClick={regenerateExcluded}
            >
              重新生成({excludedKeysScoped.length})
            </Button>
          </Space>
        </Space>
        <Table
          size="small"
          rowKey="id"
          loading={recordsLoading}
          dataSource={filteredRecords}
          pagination={{
            current: cropPage,
            pageSize: cropPageSize,
            showSizeChanger: true,
            pageSizeOptions: ["10", "20", "50", "100"],
            showTotal: (total) => `共 ${total} 条`,
            onChange: (page, pageSize) => {
              setCropPage(page);
              if (pageSize !== cropPageSize) {
                setCropPageSize(pageSize);
                setCropPage(1);
              }
            },
          }}
          columns={columns}
          scroll={{ x: "max-content" }}
          rowSelection={{
            selectedRowKeys,
            onChange: (keys) => setSelectedRowKeys(keys as string[]),
          }}
        />
      </Card>
    </AdminShell>
  );
}

