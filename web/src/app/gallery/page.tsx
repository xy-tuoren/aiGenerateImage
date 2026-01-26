"use client";

import { useEffect, useMemo, useState } from "react";
import { Button, Image, Select, Space, Typography, message } from "antd";
import { ReloadOutlined } from "@ant-design/icons";
import AdminShell from "@/app/_components/AdminShell";
import { SUPPORTED_LANGUAGES } from "@/common/constants";

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
};

export default function GalleryPage() {
  const [messageApi, contextHolder] = message.useMessage();
  const [loading, setLoading] = useState(false);
  const [items, setItems] = useState<HistoryItem[]>([]);
  const [appNameOptions, setAppNameOptions] = useState<Array<{ label: string; value: string }>>([]);
  const [appName, setAppName] = useState<string>("");
  const [lang, setLang] = useState<string>("");

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
    const groupMap = new Map<string, { latestAt: number; imgs: GridImage[] }>();
    for (const it of items) {
      if (!it?.url) continue;
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
  }, [items]);

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
          <Button icon={<ReloadOutlined />} onClick={fetchImages} loading={loading}>
            刷新
          </Button>
          <Typography.Text type="secondary">{loading ? "加载中..." : `${gridImages.length} 张`}</Typography.Text>
        </Space>

        <Image.PreviewGroup>
          <Space wrap size={12} style={{ width: "100%" }}>
            {gridImages.map((img) => (
              <Image key={img.key} width={240} height={135} style={{ objectFit: "cover" }} src={img.url} alt={img.url} />
            ))}
          </Space>
        </Image.PreviewGroup>
      </Space>
    </AdminShell>
  );
}

