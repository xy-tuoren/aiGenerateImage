"use client";

import { useEffect, useMemo, useState } from "react";
import { Button, Image, Select, Space, Typography, message } from "antd";
import { ReloadOutlined } from "@ant-design/icons";
import AdminShell from "@/app/_components/AdminShell";
import { ASPECT_RATIO_OPTIONS, SUPPORTED_LANGUAGES } from "@/common/constants";

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
  appName?: string;
  lang?: string;
  referenceImages?: string[];
  configMeta?: {
    appName?: string;
    lang?: string;
    batchFun?: string;
    aspectRatio?: string;
    prompt?: string;
    referenceImages?: string[];
  };
};

type GridImage = {
  key: string;
  url: string;
  jobId: string;
  configId: string;
  index: number;
  createdAt?: string;
  appName?: string;
  lang?: string;
};

export default function GalleryPage() {
  const [messageApi, contextHolder] = message.useMessage();
  const [loading, setLoading] = useState(false);
  const [items, setItems] = useState<HistoryItem[]>([]);
  const [appNameOptions, setAppNameOptions] = useState<Array<{ label: string; value: string }>>([]);
  const [appName, setAppName] = useState<string>("");
  const [lang, setLang] = useState<string>("");
  const [aspectRatio, setAspectRatio] = useState<string>("16:9");
  const [selectMode, setSelectMode] = useState(false);
  const [selectedKeys, setSelectedKeys] = useState<string[]>([]);
  const [creatingCut, setCreatingCut] = useState(false);

  const fetchImages = async () => {
    setLoading(true);
    try {
      const qs = new URLSearchParams();
      qs.set("status", "completed");
      qs.set("limit", "5000");
      if (appName) qs.set("appName", appName);
      if (lang) qs.set("lang", lang);
      const res = await fetch(`/api/generation-records?${qs.toString()}`, { method: "GET" });
      const data = await res.json();
      if (!res.ok || !data?.ok) {
        messageApi.error(data?.error || "获取图片记录失败");
        return;
      }
      const arr = Array.isArray(data.items) ? data.items : [];
      setItems(arr);
    } catch (e) {
      messageApi.error(e instanceof Error ? e.message : String(e));
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    (async () => {
      try {
        const res = await fetch("/api/app-names", { method: "GET" });
        const data = await res.json();
        if (!res.ok || !data?.ok) return;
        const arr = Array.isArray(data.items) ? data.items : [];
        setAppNameOptions(arr.map((x: any) => ({ label: String(x), value: String(x) })));
      } catch {
      }
    })();
  }, []);

  useEffect(() => {
    fetchImages();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [appName, lang]);

  const gridImages: GridImage[] = useMemo(() => {
    const tokenToRatio: Record<string, string> = { "1x1": "1:1", "4x5": "4:5", "16x9": "16:9", "9x16": "9:16" };
    const getAspect = (it: HistoryItem) => {
      const ar = (it?.configMeta?.aspectRatio ? String(it.configMeta.aspectRatio) : "").trim();
      if (ar) return ar;
      const url = String(it?.url || "");
      const m = url.match(/-(\d+(?:_\d+)?)x(\d+(?:_\d+)?)(?:-\d+)?\./);
      if (m) {
        const key = `${m[1].replaceAll("_", ".")}x${m[2].replaceAll("_", ".")}`;
        return tokenToRatio[key] || "";
      }
      return "";
    };
    const groupMap = new Map<string, { latestAt: number; imgs: GridImage[] }>();
    for (const it of items) {
      if (!it?.url) continue;
      if (aspectRatio) {
        const ar = getAspect(it);
        if (ar !== aspectRatio) continue;
      }
      const jobId = String(it.jobId || "");
      const configId = String(it.configId || "");
      if (!jobId || !configId) continue;
      const index = Number(it.index) || 0;
      const createdAt = it.createdAt ? String(it.createdAt) : undefined;
      const t = createdAt ? new Date(createdAt).getTime() : 0;
      const gk = `${jobId}|${configId}`;
      const g = groupMap.get(gk) || { latestAt: 0, imgs: [] };
      g.latestAt = Math.max(g.latestAt, Number.isFinite(t) ? t : 0);
      g.imgs.push({
        key: `${gk}|${index}|${createdAt || ""}|${it.url}`,
        url: String(it.url),
        jobId,
        configId,
        index,
        createdAt,
        appName: it.appName ?? it.configMeta?.appName,
        lang: it.lang ?? it.configMeta?.lang,
      });
      groupMap.set(gk, g);
    }
    const groups = Array.from(groupMap.entries()).map(([gk, g]) => ({ gk, ...g }));
    groups.sort((a, b) => b.latestAt - a.latestAt || (a.gk < b.gk ? -1 : 1));
    const out: GridImage[] = [];
    for (const g of groups) {
      g.imgs.sort((a, b) => a.index - b.index || String(a.createdAt || "").localeCompare(String(b.createdAt || "")));
      out.push(...g.imgs);
    }
    return out;
  }, [items, aspectRatio]);

  const keyToImg = useMemo(() => {
    const m = new Map<string, GridImage>();
    for (const img of gridImages) m.set(img.key, img);
    return m;
  }, [gridImages]);

  const togglePick = (k: string) => {
    setSelectedKeys((prev) => {
      if (prev.includes(k)) return prev.filter((x) => x !== k);
      return [...prev, k];
    });
  };

  useEffect(() => {
    setSelectedKeys([]);
  }, [aspectRatio]);

  const onCreateCut = async () => {
    if (!selectedKeys.length) {
      messageApi.error("请先选择要裁剪的图片");
      return;
    }
    const picked = selectedKeys.map((k) => keyToImg.get(k)).filter(Boolean) as GridImage[];
    if (!picked.length) {
      messageApi.error("选中的图片无效");
      return;
    }
    setCreatingCut(true);
    try {
      const res = await fetch("/api/cut-jobs/start", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({
          images: picked.map((p) => ({ url: p.url, appName: p.appName, lang: p.lang })),
          concurrency: 16,
        }),
      });
      const data = await res.json();
      if (!res.ok || !data?.ok) {
        messageApi.error(data?.error || "创建裁图任务失败");
        return;
      }
      const jobId = String(data.jobId || "");
      messageApi.success(`已创建裁图任务: ${jobId}`);
      setSelectedKeys([]);
      setSelectMode(false);
      if (jobId) window.open(`/batch?jobId=${encodeURIComponent(jobId)}`, "_blank");
    } catch (e) {
      messageApi.error(e instanceof Error ? e.message : String(e));
    } finally {
      setCreatingCut(false);
    }
  };

  return (
    <AdminShell defaultSelectedKey="/gallery" headerTitle="图片展示">
      {contextHolder}
      <Space orientation="vertical" size={12} style={{ width: "100%" }}>
        <Space wrap>
          <Typography.Text strong>筛选：</Typography.Text>
          <Select
            style={{ width: 260 }}
            placeholder="appName"
            allowClear
            showSearch
            value={appName || undefined}
            options={appNameOptions}
            onChange={(v) => setAppName(String(v || ""))}
          />
          <Select
            style={{ width: 140 }}
            placeholder="lang"
            allowClear
            value={lang || undefined}
            options={SUPPORTED_LANGUAGES.map((x) => ({ label: x, value: x }))}
            onChange={(v) => setLang(String(v || ""))}
          />
          <Select
            style={{ width: 140 }}
            placeholder="比例"
            value={aspectRatio || undefined}
            options={ASPECT_RATIO_OPTIONS}
            onChange={(v) => setAspectRatio(String(v || ""))}
          />
          <Button icon={<ReloadOutlined />} onClick={fetchImages} loading={loading}>
            刷新
          </Button>
          <Button onClick={() => { setSelectMode((v) => !v); setSelectedKeys([]); }} disabled={loading || creatingCut}>
            {selectMode ? "退出选择" : "选择裁剪"}
          </Button>
          <Button type="primary" onClick={onCreateCut} loading={creatingCut} disabled={!selectMode || !selectedKeys.length}>
            裁剪所选（生成任务）
          </Button>
          <Typography.Text type="secondary">{loading ? "加载中..." : `${gridImages.length} 张`}</Typography.Text>
          {selectMode ? <Typography.Text type="secondary">已选 {selectedKeys.length} 张</Typography.Text> : null}
        </Space>

        <Image.PreviewGroup>
          <Space wrap size={12} style={{ width: "100%" }}>
            {gridImages.map((img) => (
              <div
                key={img.key}
                style={{ position: "relative", cursor: selectMode ? "pointer" : "default" }}
                onClick={() => {
                  if (selectMode) togglePick(img.key);
                }}
              >
                <Image
                  width={240}
                  height={135}
                  style={{ objectFit: "cover" }}
                  src={img.url}
                  alt={img.url}
                  preview={!selectMode}
                />
                {selectMode ? (
                  <div
                    style={{
                      position: "absolute",
                      top: 6,
                      left: 6,
                      width: 18,
                      height: 18,
                      borderRadius: 4,
                      border: "1px solid rgba(0,0,0,0.45)",
                      background: selectedKeys.includes(img.key) ? "#1677ff" : "rgba(255,255,255,0.85)",
                      display: "flex",
                      alignItems: "center",
                      justifyContent: "center",
                      color: "#fff",
                      fontSize: 12,
                      userSelect: "none",
                    }}
                  >
                    {selectedKeys.includes(img.key) ? "✓" : ""}
                  </div>
                ) : null}
              </div>
            ))}
          </Space>
        </Image.PreviewGroup>
      </Space>
    </AdminShell>
  );
}

