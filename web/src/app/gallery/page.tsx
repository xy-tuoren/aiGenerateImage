"use client";

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import axios from "axios";
import { Button, Image, Select, Space, Typography, message } from "antd";
import { ReloadOutlined } from "@ant-design/icons";
import AdminShell from "@/app/_components/AdminShell";
import { ASPECT_RATIO_OPTIONS, SUPPORTED_LANGUAGES } from "@/common/constants";

type HistoryItem = {
  id?: string;
  jobId: string;
  configId: string;
  sourceConfigId?: string;
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
  sourceConfigId?: string;
  index: number;
  createdAt?: string;
  appName?: string;
  lang?: string;
};

function useUploadToFireplay(args: {
  messageApi: any;
  selectedKeys: string[];
  keyToImg: Map<string, GridImage>;
  onUploadedSourceUrls?: (urls: string[]) => void;
  onBeforeUpload?: () => void;
}) {
  const { messageApi, selectedKeys, keyToImg, onUploadedSourceUrls, onBeforeUpload } = args;
  const [uploadingFireplay, setUploadingFireplay] = useState(false);

  const onUploadToFireplay = useCallback(async () => {
    if (!selectedKeys.length) {
      messageApi.error("请先选择要上传的图片");
      return;
    }
    const picked = selectedKeys.map((k) => keyToImg.get(k)).filter(Boolean) as GridImage[];
    if (!picked.length) {
      messageApi.error("选中的图片无效");
      return;
    }
    onBeforeUpload?.();
    setUploadingFireplay(true);
    try {
      const imageUrls = picked.map((x) => String(x.url || "").trim()).filter(Boolean);
      const res = await axios.post("/api/fireplay/batch-upload", {
        imageUrls,
        type: "app",
        ownerId: 0,
      });
      const data = res.data;
      if (!data?.ok || !data?.data?.results) {
        throw new Error(data?.error || "上传到 Fireplay 失败");
      }
      const results = data.data.results as Array<{ success: boolean }>;
      const successCount = results.filter((x) => x.success).length;
      const failCount = results.length - successCount;
      messageApi.success(`已上传 Fireplay：成功 ${successCount} 张${failCount ? `，失败 ${failCount} 张` : ""}`);
      const uploadedSourceUrls = Array.isArray(data?.uploadedSourceUrls)
        ? data.uploadedSourceUrls.map((x: any) => String(x || "").trim()).filter(Boolean)
        : [];
      if (uploadedSourceUrls.length) onUploadedSourceUrls?.(uploadedSourceUrls);
    } catch (e: any) {
      const msg =
        e?.response?.data?.error ||
        e?.response?.data?.message ||
        (e instanceof Error ? e.message : String(e));
      messageApi.error(msg);
    } finally {
      setUploadingFireplay(false);
    }
  }, [keyToImg, messageApi, onBeforeUpload, onUploadedSourceUrls, selectedKeys]);

  return { uploadingFireplay, onUploadToFireplay };
}

export default function GalleryPage() {
  const [messageApi, contextHolder] = message.useMessage();
  const [loading, setLoading] = useState(false);
  const [items, setItems] = useState<HistoryItem[]>([]);
  const [cutUrls, setCutUrls] = useState<string[]>([]);
  const [fireplayUploadedUrls, setFireplayUploadedUrls] = useState<string[]>([]);
  const [appNameOptions, setAppNameOptions] = useState<Array<{ label: string; value: string }>>([]);
  const [appName, setAppName] = useState<string>("");
  const [lang, setLang] = useState<string>("");
  const [aspectRatio, setAspectRatio] = useState<string>("16:9");
  const [cutFilter, setCutFilter] = useState<"cut" | "uncut">("uncut");
  const [selectMode, setSelectMode] = useState(false);
  const [selectedKeys, setSelectedKeys] = useState<string[]>([]);
  const [hiddenKeys, setHiddenKeys] = useState<string[]>([]);
  const [previewOpen, setPreviewOpen] = useState(false);
  const [previewIndex, setPreviewIndex] = useState(0);
  const [selectedPreviewOpen, setSelectedPreviewOpen] = useState(false);
  const [selectedPreviewIndex, setSelectedPreviewIndex] = useState(0);
  const [creatingCut, setCreatingCut] = useState(false);
  const [downloadingZip, setDownloadingZip] = useState(false);
  const [galleryPage, setGalleryPage] = useState(1);
  const galleryPageSize = 100;
  const gridWrapRef = useRef<HTMLDivElement | null>(null);
  const loadMoreSentinelRef = useRef<HTMLDivElement | null>(null);
  const dragStateRef = useRef<{ active: boolean; moved: boolean; startX: number; startY: number; curX: number; curY: number }>({ active: false, moved: false, startX: 0, startY: 0, curX: 0, curY: 0 });
  const suppressClickRef = useRef(false);
  const dragRafRef = useRef<number | null>(null);
  const dragBoxRef = useRef<{ active: boolean; x: number; y: number; w: number; h: number }>({ active: false, x: 0, y: 0, w: 0, h: 0 });
  const [dragBox, setDragBox] = useState<{ active: boolean; x: number; y: number; w: number; h: number }>({ active: false, x: 0, y: 0, w: 0, h: 0 });
  const batchLastJobIdKey = "batch:lastJobId";
  const batchRecentJobIdsKey = "batch:recentJobIds";

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
      try {
        const urls = arr.map((x: any) => String(x?.url || "").trim()).filter(Boolean);
        if (urls.length) {
          const res2 = await fetch("/api/cut-records/flags", {
            method: "POST",
            headers: { "content-type": "application/json" },
            body: JSON.stringify({ urls }),
          });
          const data2 = await res2.json().catch(() => null);
          if (res2.ok && data2?.ok) {
            const got = Array.isArray(data2.cutUrls) ? data2.cutUrls.map((x: any) => String(x || "").trim()).filter(Boolean) : [];
            if (got.length) setCutUrls((prev) => Array.from(new Set([...(prev || []), ...got])));
            const got2 = Array.isArray(data2.fireplayUploadedUrls)
              ? data2.fireplayUploadedUrls.map((x: any) => String(x || "").trim()).filter(Boolean)
              : [];
            if (got2.length) setFireplayUploadedUrls((prev) => Array.from(new Set([...(prev || []), ...got2])));
          }
        }
      } catch {
      }
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
      const recId = it.id ? String(it.id) : "";
      const jobId = String(it.jobId || "");
      const configId = String(it.configId || "");
      const sourceConfigId = it.sourceConfigId ? String(it.sourceConfigId) : "";
      const groupConfigId = sourceConfigId || configId;
      if (!jobId || !configId) continue;
      const index = Number(it.index) || 0;
      const createdAt = it.createdAt ? String(it.createdAt) : undefined;
      const t = createdAt ? new Date(createdAt).getTime() : 0;
      const gk = `${jobId}|${groupConfigId}`;
      const g = groupMap.get(gk) || { latestAt: 0, imgs: [] };
      g.latestAt = Math.max(g.latestAt, Number.isFinite(t) ? t : 0);
      g.imgs.push({
        key: `${recId || `${gk}|${configId}|${index}|${createdAt || ""}`}|${it.url}`,
        url: String(it.url),
        jobId,
        configId: groupConfigId,
        sourceConfigId: sourceConfigId || undefined,
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
      g.imgs.sort(
        (a, b) =>
          String(a.lang ?? "").localeCompare(String(b.lang ?? "")) ||
          a.index - b.index ||
          String(a.createdAt || "").localeCompare(String(b.createdAt || ""))
      );
      out.push(...g.imgs);
    }
    return out;
  }, [items, aspectRatio]);

  const hiddenKeySet = useMemo(() => new Set(hiddenKeys), [hiddenKeys]);
  const selectedKeySet = useMemo(() => new Set(selectedKeys), [selectedKeys]);
  const cutUrlSet = useMemo(() => new Set(cutUrls), [cutUrls]);
  const fireplayUploadedUrlSet = useMemo(() => new Set(fireplayUploadedUrls), [fireplayUploadedUrls]);

  const visibleGridImages: GridImage[] = useMemo(() => {
    if (!hiddenKeys.length) return gridImages;
    return gridImages.filter((img) => !hiddenKeySet.has(img.key));
  }, [gridImages, hiddenKeySet, hiddenKeys.length]);

  const filteredGridImages: GridImage[] = useMemo(() => {
    let arr = visibleGridImages;
    arr = arr.filter((img) => !fireplayUploadedUrlSet.has(img.url));
    arr = arr.filter((img) => (cutFilter === "cut" ? cutUrlSet.has(img.url) : !cutUrlSet.has(img.url)));
    return arr;
  }, [visibleGridImages, cutFilter, cutUrlSet, fireplayUploadedUrlSet]);

  const paginatedGridImages: GridImage[] = useMemo(() => {
    return filteredGridImages.slice(0, galleryPage * galleryPageSize);
  }, [filteredGridImages, galleryPage]);

  const hasMore = (galleryPage * galleryPageSize) < filteredGridImages.length;

  useEffect(() => {
    setGalleryPage(1);
  }, [appName, lang, aspectRatio, cutFilter]);

  useEffect(() => {
    const sentinel = loadMoreSentinelRef.current;
    if (!sentinel || !hasMore) return;
    const ob = new IntersectionObserver(
      (entries) => {
        if (entries[0]?.isIntersecting) setGalleryPage((p) => p + 1);
      },
      { rootMargin: "200px", threshold: 0 }
    );
    ob.observe(sentinel);
    return () => ob.disconnect();
  }, [hasMore, paginatedGridImages.length]);

  const keyToImg = useMemo(() => {
    const m = new Map<string, GridImage>();
    for (const img of gridImages) m.set(img.key, img);
    return m;
  }, [gridImages]);

  const { uploadingFireplay, onUploadToFireplay } = useUploadToFireplay({
    messageApi,
    selectedKeys,
    keyToImg,
    onBeforeUpload: () => {
      setSelectedKeys([]);
      setSelectMode(false);
    },
    onUploadedSourceUrls: (urls) => {
      setFireplayUploadedUrls((prev) => Array.from(new Set([...(prev || []), ...(urls || [])])));
    },
  });

  const selectedImages = useMemo(() => {
    return selectedKeys.map((k) => keyToImg.get(k)).filter(Boolean) as GridImage[];
  }, [keyToImg, selectedKeys]);
  const selectedPreviewImages = useMemo(() => selectedImages.slice(0, 80), [selectedImages]);

  const togglePick = useCallback((k: string) => {
    setSelectedKeys((prev) => {
      if (prev.includes(k)) return prev.filter((x) => x !== k);
      return [...prev, k];
    });
  }, []);

  const addPicks = useCallback((keys: string[]) => {
    const arr = Array.isArray(keys) ? keys.map((x) => String(x || "").trim()).filter(Boolean) : [];
    if (!arr.length) return;
    setSelectedKeys((prev) => {
      const set = new Set(prev);
      for (const k of arr) set.add(k);
      return Array.from(set);
    });
  }, []);

  useEffect(() => {
    setSelectMode(selectedKeys.length > 0);
  }, [selectedKeys]);

  useEffect(() => {
    setSelectedKeys([]);
  }, [aspectRatio]);

  useEffect(() => {
    setHiddenKeys([]);
  }, [appName, lang, aspectRatio]);

  useEffect(() => {
    if (!previewOpen) return;
    const len = paginatedGridImages.length;
    if (previewIndex < 0) setPreviewIndex(0);
    else if (previewIndex >= len) setPreviewIndex(Math.max(0, len - 1));
  }, [previewOpen, previewIndex, paginatedGridImages.length]);

  useEffect(() => {
    const onKeyDown = (e: KeyboardEvent) => {
      if (!previewOpen) return;
      const k = String(e.key || "").toLowerCase();
      if (k !== "c" && k !== "x") return;
      const img = paginatedGridImages[previewIndex];
      if (!img) return;
      e.preventDefault();
      if (k === "c") {
        togglePick(img.key);
        setPreviewIndex((cur) => {
          const len = paginatedGridImages.length;
          if (!len) return 0;
          return Math.min(cur + 1, len - 1);
        });
        return;
      }
      if (k === "x") {
        if (selectedKeySet.has(img.key)) {
          togglePick(img.key);
          return;
        }
        const curIdx = previewIndex;
        const prevLen = paginatedGridImages.length;
        setHiddenKeys((prev) => {
          if (prev.includes(img.key)) return prev;
          return [...prev, img.key];
        });
        const nextLen = Math.max(0, (prevLen || 0) - 1);
        if (!nextLen) {
          setPreviewOpen(false);
          setPreviewIndex(0);
        } else {
          setPreviewIndex(Math.min(curIdx, nextLen - 1));
        }
        return;
      }
    };
    window.addEventListener("keydown", onKeyDown);
    return () => window.removeEventListener("keydown", onKeyDown);
  }, [previewOpen, previewIndex, selectedKeySet, togglePick, paginatedGridImages]);

  useEffect(() => {
    const onKeyDown = (e: KeyboardEvent) => {
      if (!selectedPreviewOpen) return;
      const k = String(e.key || "").toLowerCase();
      if (k !== "x") return;
      const img = selectedPreviewImages[selectedPreviewIndex];
      if (!img) return;
      e.preventDefault();
      togglePick(img.key);
      const curIdx = selectedPreviewIndex;
      const prevLen = selectedPreviewImages.length;
      const nextLen = Math.max(0, (prevLen || 0) - 1);
      if (!nextLen) {
        setSelectedPreviewOpen(false);
        setSelectedPreviewIndex(0);
      } else {
        setSelectedPreviewIndex(Math.min(curIdx, nextLen - 1));
      }
    };
    window.addEventListener("keydown", onKeyDown);
    return () => window.removeEventListener("keydown", onKeyDown);
  }, [selectedPreviewOpen, selectedPreviewIndex, selectedPreviewImages, togglePick]);

  useEffect(() => {
    const onMove = (e: MouseEvent) => {
      const st = dragStateRef.current;
      if (!st.active) return;
      const wrap = gridWrapRef.current;
      if (!wrap) return;
      const rect = wrap.getBoundingClientRect();
      const x = e.clientX - rect.left;
      const y = e.clientY - rect.top;
      st.curX = x;
      st.curY = y;
      const dx = x - st.startX;
      const dy = y - st.startY;
      if (!st.moved && (Math.abs(dx) > 6 || Math.abs(dy) > 6)) {
        st.moved = true;
        suppressClickRef.current = true;
      }
      dragBoxRef.current = { active: true, x: st.startX, y: st.startY, w: dx, h: dy };
      if (dragRafRef.current) return;
      dragRafRef.current = window.requestAnimationFrame(() => {
        dragRafRef.current = null;
        setDragBox(dragBoxRef.current);
      });
    };
    const onUp = () => {
      const st = dragStateRef.current;
      if (!st.active) return;
      st.active = false;
      const wrap = gridWrapRef.current;
      const moved = st.moved;
      const sx = st.startX, sy = st.startY, ex = st.curX, ey = st.curY;
      dragBoxRef.current = { ...dragBoxRef.current, active: false };
      if (dragRafRef.current) {
        window.cancelAnimationFrame(dragRafRef.current);
        dragRafRef.current = null;
      }
      setDragBox((prev) => ({ ...prev, active: false }));
      if (!wrap) return;
      if (!moved) return;
      const rect = wrap.getBoundingClientRect();
      const left = rect.left + Math.min(sx, ex);
      const right = rect.left + Math.max(sx, ex);
      const top = rect.top + Math.min(sy, ey);
      const bottom = rect.top + Math.max(sy, ey);
      const nodes = Array.from(wrap.querySelectorAll("[data-grid-key]")) as HTMLElement[];
      const picked: string[] = [];
      for (const el of nodes) {
        const k = el.getAttribute("data-grid-key") || "";
        if (!k) continue;
        const r = el.getBoundingClientRect();
        const hit = !(r.right < left || r.left > right || r.bottom < top || r.top > bottom);
        if (hit) picked.push(k);
      }
      if (picked.length) addPicks(picked);
    };
    window.addEventListener("mousemove", onMove);
    window.addEventListener("mouseup", onUp);
    return () => {
      window.removeEventListener("mousemove", onMove);
      window.removeEventListener("mouseup", onUp);
      if (dragRafRef.current) {
        window.cancelAnimationFrame(dragRafRef.current);
        dragRafRef.current = null;
      }
    };
  }, [addPicks]);

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
          concurrency: 64,
        }),
      });
      const data = await res.json();
      if (!res.ok || !data?.ok) {
        messageApi.error(data?.error || "创建裁图任务失败");
        return;
      }
      setCutUrls((prev) => Array.from(new Set([...(prev || []), ...picked.map((p) => String(p.url || "").trim()).filter(Boolean)])));
      const jobId = String(data.jobId || "");
      try {
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
      messageApi.success(`已创建裁图任务: ${jobId}`);
      setSelectedKeys([]);
      setSelectMode(false);
    } catch (e) {
      messageApi.error(e instanceof Error ? e.message : String(e));
    } finally {
      setCreatingCut(false);
    }
  };

  const onDownloadSelected = useCallback(async () => {
    if (!selectedKeys.length) {
      messageApi.error("请先选择要下载的图片");
      return;
    }
    const picked = selectedKeys.map((k) => keyToImg.get(k)).filter(Boolean) as GridImage[];
    if (!picked.length) {
      messageApi.error("选中的图片无效");
      return;
    }
    setDownloadingZip(true);
    messageApi.open({ type: "loading", content: `正在打包下载（${picked.length}）...`, duration: 0, key: "downloadZip" });
    try {
      const parseFilename = (cd: string | null) => {
        const raw = String(cd || "");
        const mStar = raw.match(/filename\*\s*=\s*UTF-8''([^;]+)/i);
        if (mStar?.[1]) {
          try {
            return decodeURIComponent(mStar[1].trim().replace(/^"|"$/g, ""));
          } catch {
          }
        }
        const m = raw.match(/filename\s*=\s*"([^"]+)"/i) || raw.match(/filename\s*=\s*([^;]+)/i);
        return m?.[1] ? String(m[1]).trim() : "";
      };

      const filenamePrefix = `gallery-${String(appName || "all").trim() || "all"}-${String(lang || "all").trim() || "all"}-${String(aspectRatio || "").trim() || "ratio"}`;
      const res = await fetch("/api/cut-records/download", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ urls: picked.map((p) => p.url), folderName: "images", filenamePrefix }),
      });
      if (!res.ok) {
        const data = await res.json().catch(() => null);
        messageApi.error(data?.error || "下载失败");
        return;
      }
      const blob = await res.blob();
      const cd = res.headers.get("content-disposition");
      const filename = parseFilename(cd) || "images.zip";
      const url = URL.createObjectURL(blob);
      const a = document.createElement("a");
      a.href = url;
      a.download = filename;
      document.body.appendChild(a);
      a.click();
      a.remove();
      window.setTimeout(() => URL.revokeObjectURL(url), 10_000);
      messageApi.success("已开始下载");
    } catch (e: any) {
      messageApi.error(e instanceof Error ? e.message : String(e));
    } finally {
      messageApi.destroy("downloadZip");
      setDownloadingZip(false);
    }
  }, [appName, aspectRatio, keyToImg, lang, messageApi, selectedKeys]);

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
          <Select
            style={{ width: 280 }}
            placeholder="筛选"
            value={cutFilter}
            options={[
              { label: "已裁剪", value: "cut" },
              { label: "未裁剪", value: "uncut" },
            ]}
            onChange={(v) => setCutFilter((String(v || "") as any) || "uncut")}
            menuItemSelectedIcon={null as any}
          />
          <Button icon={<ReloadOutlined />} onClick={fetchImages} loading={loading}>
            刷新
          </Button>
          <Button type="primary" onClick={onCreateCut} loading={creatingCut} disabled={!selectMode || !selectedKeys.length}>
            裁剪
          </Button>
          <Button
            onClick={onUploadToFireplay}
            loading={uploadingFireplay}
            disabled={!selectMode || !selectedKeys.length || loading || creatingCut}
          >
            上传 Fireplay
          </Button>
          <Button
            onClick={onDownloadSelected}
            loading={downloadingZip}
            disabled={!selectMode || !selectedKeys.length || loading || creatingCut || uploadingFireplay}
          >
            下载
          </Button>
          <Typography.Text type="secondary">{loading ? "加载中..." : `共 ${filteredGridImages.length} 张`}</Typography.Text>
          {selectMode ? <Typography.Text type="secondary">已选 {selectedKeys.length} 张</Typography.Text> : null}
        </Space>

        {selectedImages.length ? (
          <div style={{ padding: 10, background: "#f5f5f5", borderRadius: 10, border: "1px solid rgba(0,0,0,0.06)" }}>
            <Space wrap size={10} align="center" style={{ width: "100%" }}>
              <Typography.Text strong>当前已选（{selectedImages.length}）</Typography.Text>
              <Typography.Text type="secondary">右键可选/取消，预览里按 C 也可选</Typography.Text>
              <Button size="small" onClick={() => { setSelectedKeys([]); setSelectMode(false); }} disabled={loading || creatingCut}>
                清空已选
              </Button>
              <div style={{ flex: "1 1 100%" }} />
              <Image.PreviewGroup
                preview={{
                  open: selectedPreviewOpen,
                  current: selectedPreviewIndex,
                  onOpenChange: (open) => {
                    setSelectedPreviewOpen(Boolean(open));
                    if (!open) setSelectedPreviewIndex(0);
                  },
                  onChange: (cur) => setSelectedPreviewIndex(Number(cur) || 0),
                }}
              >
                <Space wrap size={8}>
                  {selectedPreviewImages.map((img, i) => (
                    <div
                      key={`sel|${img.key}`}
                      style={{ position: "relative", width: 92, height: 52, borderRadius: 8, overflow: "hidden", border: "1px solid rgba(0,0,0,0.12)", background: "#fff", cursor: "pointer" }}
                      onClick={() => {
                        setSelectedPreviewIndex(i);
                        setSelectedPreviewOpen(true);
                      }}
                    >
                      <Image width={92} height={52} style={{ width: 92, height: 52, objectFit: "cover" }} src={img.url} alt={img.url} />
                      <div
                        title="移除"
                        onClick={(e) => { e.stopPropagation(); togglePick(img.key); }}
                        style={{ position: "absolute", top: 4, right: 4, width: 18, height: 18, borderRadius: 6, background: "rgba(0,0,0,0.55)", color: "#fff", fontSize: 12, display: "flex", alignItems: "center", justifyContent: "center", cursor: "pointer", userSelect: "none" }}
                      >
                        ×
                      </div>
                    </div>
                  ))}
                </Space>
              </Image.PreviewGroup>
            </Space>
          </div>
        ) : null}

        <Image.PreviewGroup
          preview={{
            open: previewOpen,
            current: previewIndex,
            onOpenChange: (open) => {
              setPreviewOpen(Boolean(open));
              if (!open) setPreviewIndex(0);
            },
            onChange: (cur) => setPreviewIndex(Number(cur) || 0),
          }}
        >
          <div
            ref={gridWrapRef}
            style={{ position: "relative", display: "grid", gridTemplateColumns: "repeat(7, minmax(0, 1fr))", gap: 12, width: "100%", userSelect: dragBox.active ? "none" : undefined, cursor: dragBox.active ? "crosshair" : undefined }}
            onMouseDown={(e) => {
              if (e.button !== 0) return;
              if (previewOpen) return;
              const wrap = gridWrapRef.current;
              if (!wrap) return;
              const rect = wrap.getBoundingClientRect();
              const x = e.clientX - rect.left;
              const y = e.clientY - rect.top;
              dragStateRef.current = { active: true, moved: false, startX: x, startY: y, curX: x, curY: y };
              suppressClickRef.current = false;
              dragBoxRef.current = { active: true, x, y, w: 0, h: 0 };
              setDragBox({ active: true, x, y, w: 0, h: 0 });
              e.preventDefault();
              e.stopPropagation();
            }}
          >
            {dragBox.active ? (
              <div
                style={{
                  position: "absolute",
                  left: Math.min(dragBox.x, dragBox.x + dragBox.w),
                  top: Math.min(dragBox.y, dragBox.y + dragBox.h),
                  width: Math.abs(dragBox.w),
                  height: Math.abs(dragBox.h),
                  background: "rgba(0,160,255,0.22)",
                  border: "2px solid rgba(0,160,255,0.95)",
                  boxShadow: "0 0 0 2px rgba(255,255,255,0.65) inset, 0 8px 20px rgba(0,160,255,0.25)",
                  outline: "1px dashed rgba(0,0,0,0.25)",
                  borderRadius: 6,
                  pointerEvents: "none",
                  zIndex: 10,
                }}
              />
            ) : null}
            {paginatedGridImages.map((img, idx) => (
              <div
                key={img.key}
                data-grid-key={img.key}
                style={{ position: "relative", cursor: "default", width: "100%", aspectRatio: "16 / 9", overflow: "hidden", borderRadius: 10, border: selectedKeySet.has(img.key) ? "3px solid #1677ff" : "1px solid rgba(0,0,0,0.06)", boxShadow: selectedKeySet.has(img.key) ? "0 0 0 3px rgba(22,119,255,0.22)" : undefined }}
                onContextMenu={(e) => {
                  e.preventDefault();
                  togglePick(img.key);
                }}
                onClick={() => {
                  if (suppressClickRef.current) {
                    suppressClickRef.current = false;
                    return;
                  }
                  setPreviewIndex(idx);
                  setPreviewOpen(true);
                }}
              >
                <Image
                  width="100%"
                  height="100%"
                  style={{ width: "100%", height: "100%", objectFit: "cover" }}
                  src={img.url}
                  alt={img.url}
                />
                {selectedKeySet.has(img.key) ? (
                  <div style={{ position: "absolute", inset: 0, background: "rgba(22,119,255,0.16)", pointerEvents: "none" }} />
                ) : null}
                {selectedKeySet.has(img.key) ? (
                  <div
                    style={{
                      position: "absolute",
                      top: 8,
                      left: 8,
                      width: 26,
                      height: 26,
                      borderRadius: 8,
                      border: "1px solid rgba(255,255,255,0.85)",
                      background: "#1677ff",
                      display: "flex",
                      alignItems: "center",
                      justifyContent: "center",
                      color: "#fff",
                      fontSize: 16,
                      fontWeight: 700,
                      userSelect: "none",
                    }}
                  >
                    ✓
                  </div>
                ) : null}
              </div>
            ))}
          </div>
        </Image.PreviewGroup>
        {filteredGridImages.length > 0 ? (
          <>
            <div ref={loadMoreSentinelRef} style={{ height: 1, width: "100%", visibility: "hidden" }} />
            {hasMore ? (
              <div style={{ textAlign: "center", padding: "16px 0", color: "rgba(0,0,0,0.45)" }}>
                已展示 {paginatedGridImages.length} / {filteredGridImages.length} 张，下拉加载更多
              </div>
            ) : (
              <div style={{ textAlign: "center", padding: "16px 0", color: "rgba(0,0,0,0.45)" }}>
                共 {filteredGridImages.length} 张，已全部加载
              </div>
            )}
          </>
        ) : null}
      </Space>
    </AdminShell>
  );
}

