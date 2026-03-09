"use client";

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import {
  Button,
  Image,
  Input,
  Modal,
  Select,
  Space,
  Switch,
  Tooltip,
  Typography,
  Upload,
  message
} from "antd";
import {
  ReloadOutlined,
  CloudDownloadOutlined,
  CopyOutlined,
  SortAscendingOutlined,
  ThunderboltOutlined,
  SearchOutlined,
  UploadOutlined
} from "@ant-design/icons";
import AdminShell from "@/app/_components/AdminShell";

const PAGE_SIZE = 100;

export default function ReferenceGalleryPage() {
  const [messageApi, contextHolder] = message.useMessage();
  const [noticeQueue, setNoticeQueue] = useState<
    Array<{ type: "success" | "error"; content: string }>
  >([]);
  const [loading, setLoading] = useState(false);
  const [loadingMore, setLoadingMore] = useState(false);
  const [fetchingReferenceImages, setFetchingReferenceImages] = useState(false);
  const [vectorizingReferenceImages, setVectorizingReferenceImages] =
    useState(false);
  const [fetchReferenceModalOpen, setFetchReferenceModalOpen] = useState(false);
  const [vectorizeModalOpen, setVectorizeModalOpen] = useState(false);
  const [vectorSearchModalOpen, setVectorSearchModalOpen] = useState(false);
  const [refreshDdAppDataCache, setRefreshDdAppDataCache] = useState(false);
  const [vectorSearching, setVectorSearching] = useState(false);
  const [vectorSearchText, setVectorSearchText] = useState("");
  const [vectorSearchImageUrl, setVectorSearchImageUrl] = useState("");
  const [vectorSearchLocalImageDataUrl, setVectorSearchLocalImageDataUrl] =
    useState("");
  const [vectorSearchLocalImageName, setVectorSearchLocalImageName] =
    useState("");
  const [vectorSearchActive, setVectorSearchActive] = useState(false);
  const [appNames, setAppNames] = useState<string[]>([]);
  const [appName, setAppName] = useState<string>("");
  const [images, setImages] = useState<string[]>([]);
  const [total, setTotal] = useState(0);
  const [loadedPageCount, setLoadedPageCount] = useState(0);
  const [selectedKeys, setSelectedKeys] = useState<string[]>([]);
  const [copyingPath, setCopyingPath] = useState(false);
  const [sortByCost, setSortByCost] = useState<"default" | "asc" | "desc">(
    "default"
  );
  const loadMoreSentinelRef = useRef<HTMLDivElement | null>(null);
  const gridWrapRef = useRef<HTMLDivElement | null>(null);
  const dragStateRef = useRef<{
    active: boolean;
    moved: boolean;
    startX: number;
    startY: number;
    curX: number;
    curY: number;
  }>({ active: false, moved: false, startX: 0, startY: 0, curX: 0, curY: 0 });
  const suppressClickRef = useRef(false);
  const dragRafRef = useRef<number | null>(null);
  const dragBoxRef = useRef<{
    active: boolean;
    x: number;
    y: number;
    w: number;
    h: number;
  }>({ active: false, x: 0, y: 0, w: 0, h: 0 });
  const [dragBox, setDragBox] = useState<{
    active: boolean;
    x: number;
    y: number;
    w: number;
    h: number;
  }>({ active: false, x: 0, y: 0, w: 0, h: 0 });

  const appNameOptions = useMemo(
    () => appNames.map((x) => ({ label: x, value: x })),
    [appNames]
  );
  const hasMore = loadedPageCount * PAGE_SIZE < total;
  const selectedKeySet = useMemo(() => new Set(selectedKeys), [selectedKeys]);
  const selectedImages = useMemo(
    () => images.filter((url) => selectedKeys.includes(`${appName}|${url}`)),
    [images, appName, selectedKeys]
  );
  const selectedPreviewImages = useMemo(
    () => selectedImages.slice(0, 80),
    [selectedImages]
  );

  const enqueueNotice = useCallback(
    (type: "success" | "error", content: string) => {
      setNoticeQueue((prev) => [...prev, { type, content }]);
    },
    []
  );

  useEffect(() => {
    if (!noticeQueue.length) return;
    for (const n of noticeQueue) {
      if (n.type === "success") messageApi.success(n.content);
      else messageApi.error(n.content);
    }
    setNoticeQueue([]);
  }, [messageApi, noticeQueue]);

  const uniqKeepOrder = useCallback((arr: string[]) => {
    const set = new Set<string>();
    const out: string[] = [];
    for (const x of arr) {
      if (!x) continue;
      if (set.has(x)) continue;
      set.add(x);
      out.push(x);
    }
    return out;
  }, []);

  const togglePick = useCallback((key: string) => {
    setSelectedKeys((prev) =>
      prev.includes(key) ? prev.filter((x) => x !== key) : [...prev, key]
    );
  }, []);

  const addPicks = useCallback((keys: string[]) => {
    const arr = Array.isArray(keys)
      ? keys.map((x) => String(x || "").trim()).filter(Boolean)
      : [];
    if (!arr.length) return;
    setSelectedKeys((prev) => {
      const set = new Set(prev);
      for (const k of arr) set.add(k);
      return Array.from(set);
    });
  }, []);

  const getCostFromImageUrl = useCallback((imageUrl: string) => {
    try {
      const lastSegRaw = imageUrl.split("/").pop() || "";
      const lastSeg = lastSegRaw.split("?")[0]?.split("#")[0] || "";
      const decoded = decodeURIComponent(lastSeg);
      const base = decoded.replace(/\.[^.]+$/, "");
      const parts = base
        .split("-")
        .map((x) => x.trim())
        .filter(Boolean);
      const isNum = (s: string) => /^\d+$/.test(s);
      // 文件命名：{idPart}-{costInt}[ -{k} ].ext
      // - 如果最后一段是并发/冲突后缀，则 cost 在倒数第二段
      if (
        parts.length >= 3 &&
        isNum(parts[parts.length - 1]!) &&
        isNum(parts[parts.length - 2]!)
      ) {
        return parts[parts.length - 2]!;
      }
      if (parts.length >= 2 && isNum(parts[parts.length - 1]!)) {
        return parts[parts.length - 1]!;
      }
      return "";
    } catch {
      return "";
    }
  }, []);

  const imageCostMap = useMemo(() => {
    const map = new Map<string, string>();
    for (const url of images) {
      map.set(url, getCostFromImageUrl(url));
    }
    return map;
  }, [images, getCostFromImageUrl]);

  // 注意：排序必须由后端完成（先排序再分页），避免分页导致的全局排序错误
  const imagesToRender = images;

  const fetchAppNames = useCallback(async () => {
    setLoading(true);
    try {
      const res = await fetch("/api/app-names", {
        method: "GET"
      });
      const data = await res.json().catch(() => null);
      if (!res.ok || !data?.ok) {
        enqueueNotice("error", data?.error || "获取 appName 列表失败");
        return;
      }
      const next = Array.isArray(data?.items)
        ? data.items.map((x: any) => String(x || "").trim()).filter(Boolean)
        : [];
      setAppNames(next);
      setAppName((prev) => prev || next[0] || "");
    } catch (e) {
      enqueueNotice("error", e instanceof Error ? e.message : String(e));
    } finally {
      setLoading(false);
    }
  }, [enqueueNotice]);

  const fetchImages = useCallback(
    async (nextAppName: string, pageNum: number, append: boolean) => {
      const a = String(nextAppName || "").trim();
      if (!a) {
        setVectorSearchActive(false);
        setImages([]);
        setTotal(0);
        setLoadedPageCount(0);
        return;
      }
      if (append) setLoadingMore(true);
      else {
        // 普通列表请求会覆盖向量搜图结果，先重置展示状态。
        setVectorSearchActive(false);
        setLoading(true);
      }
      try {
        const qs = new URLSearchParams();
        qs.set("appName", a);
        qs.set("page", String(pageNum || 1));
        qs.set("pageSize", String(PAGE_SIZE));
        if (sortByCost !== "default") qs.set("sortByCost", sortByCost);
        const res = await fetch(`/api/reference-images?${qs.toString()}`, {
          method: "GET"
        });
        const data = await res.json().catch(() => null);
        if (!res.ok || !data?.ok) {
          enqueueNotice("error", data?.error || "获取参考图失败");
          return;
        }
        const list = Array.isArray(data?.images)
          ? data.images.map((x: any) => String(x || "").trim()).filter(Boolean)
          : [];
        const newTotal = typeof data?.total === "number" ? data.total : 0;
        setTotal(newTotal);
        if (append) {
          setImages((prev) => uniqKeepOrder([...prev, ...list]));
          setLoadedPageCount((p) => p + 1);
        } else {
          setImages(uniqKeepOrder(list));
          setLoadedPageCount(1);
        }
      } catch (e) {
        enqueueNotice("error", e instanceof Error ? e.message : String(e));
      } finally {
        if (append) setLoadingMore(false);
        else setLoading(false);
      }
    },
    [enqueueNotice, uniqKeepOrder, sortByCost]
  );

  const doFetchReferenceImages = useCallback(
    async (downloadFiles: boolean) => {
      setFetchingReferenceImages(true);
      const loadingKey = "reference-images-sync";
      messageApi.open({
        key: loadingKey,
        type: "loading",
        content: downloadFiles
          ? "正在获取参考图并下载文件（可能需要几分钟）..."
          : "正在获取参考图并保存网络映射（可能需要几分钟）...",
        duration: 0
      });
      try {
        const res = await fetch("/api/reference-images", {
          method: "POST",
          headers: { "content-type": "application/json" },
          body: JSON.stringify({
            downloadFiles,
            refreshDdAppDataCache
          })
        });
        const data = await res.json().catch(() => null);
        if (!res.ok || !data?.ok) {
          enqueueNotice("error", data?.error || "获取参考图失败");
          return;
        }
        enqueueNotice(
          "success",
          `获取参考图成功（${
            data?.mode === "remote_only" ? "仅保存网络映射" : "下载文件"
          }）：app=${data?.appNames || 0} items=${
            data?.totalItems || 0
          } files=${data?.totalFiles || 0}`
        );
        fetchAppNames();
        if (appName) {
          setLoadedPageCount(0);
          fetchImages(appName, 1, false);
        }
      } catch (e) {
        enqueueNotice("error", e instanceof Error ? e.message : String(e));
      } finally {
        messageApi.destroy(loadingKey);
        setFetchingReferenceImages(false);
      }
    },
    [
      appName,
      enqueueNotice,
      fetchAppNames,
      fetchImages,
      messageApi,
      refreshDdAppDataCache
    ]
  );

  const handleFetchReferenceImages = useCallback(() => {
    setFetchReferenceModalOpen(true);
  }, []);

  const handleOpenVectorizeModal = useCallback(() => {
    setVectorizeModalOpen(true);
  }, []);

  const handleOpenVectorSearchModal = useCallback(() => {
    if (!String(appName || "").trim()) {
      enqueueNotice("error", "请先选择 appName");
      return;
    }
    setVectorSearchModalOpen(true);
  }, [appName, enqueueNotice]);

  const doVectorizeReferenceImages = useCallback(
    async (onlyCurrentAppName: boolean) => {
      const targetAppName = String(appName || "").trim();
      if (onlyCurrentAppName && !targetAppName) {
        enqueueNotice("error", "请先选择 appName");
        return;
      }
      setVectorizingReferenceImages(true);
      const loadingKey = "reference-images-vectorize";
      messageApi.open({
        key: loadingKey,
        type: "loading",
        content: onlyCurrentAppName
          ? `正在向量化当前 appName（${targetAppName}），并写入 Cloudflare...`
          : "正在向量化并写入 Cloudflare（可能需要几分钟）...",
        duration: 0
      });
      try {
        const res = await fetch("/api/reference-images/vectorize", {
          method: "POST",
          headers: { "content-type": "application/json" },
          body: JSON.stringify(
            onlyCurrentAppName ? { appName: targetAppName } : {}
          )
        });
        const data = await res.json().catch(() => null);
        if (!res.ok || !data?.ok) {
          enqueueNotice("error", data?.error || "向量化失败");
          return;
        }
        enqueueNotice(
          "success",
          `${
            onlyCurrentAppName ? `当前 appName（${targetAppName}）` : "全量"
          }向量化完成：total=${data?.total || 0} existed=${
            data?.existed || 0
          } embedded=${data?.embedded || 0} saved=${data?.saved || 0} failed=${
            data?.failedCount || 0
          } tokens=${data?.totalTokens || 0}`
        );
      } catch (e) {
        enqueueNotice("error", e instanceof Error ? e.message : String(e));
      } finally {
        messageApi.destroy(loadingKey);
        setVectorizingReferenceImages(false);
      }
    },
    [appName, enqueueNotice, messageApi]
  );

  const doVectorSearch = useCallback(async () => {
    const targetAppName = String(appName || "").trim();
    if (!targetAppName) {
      enqueueNotice("error", "请先选择 appName");
      return;
    }
    const text = String(vectorSearchText || "").trim();
    const imageUrl = String(vectorSearchImageUrl || "").trim();
    const localImageDataUrl = String(
      vectorSearchLocalImageDataUrl || ""
    ).trim();
    const finalImageInput = localImageDataUrl || imageUrl;
    if (!text && !finalImageInput) {
      enqueueNotice(
        "error",
        "请输入搜图文本，或提供网络图片 URL / 本地上传图片"
      );
      return;
    }

    setVectorSearching(true);
    const loadingKey = "reference-images-vector-search";
    messageApi.open({
      key: loadingKey,
      type: "loading",
      content: `正在向量搜图（appName=${targetAppName}）...`,
      duration: 0
    });
    try {
      const res = await fetch("/api/reference-images/vector-search", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({
          appName: targetAppName,
          text,
          imageUrl: finalImageInput,
          topK: 50
        })
      });
      const data = await res.json().catch(() => null);
      if (!res.ok || !data?.ok) {
        enqueueNotice("error", data?.error || "向量搜图失败");
        return;
      }
      const list = Array.isArray(data?.images)
        ? data.images.map((x: any) => String(x || "").trim()).filter(Boolean)
        : [];
      setImages(uniqKeepOrder(list));
      setTotal(typeof data?.total === "number" ? data.total : list.length);
      setLoadedPageCount(1);
      setSelectedKeys([]);
      setVectorSearchActive(true);
      setVectorSearchModalOpen(false);
      enqueueNotice(
        "success",
        `向量搜图完成：app=${targetAppName} 命中=${list.length} tokens=${
          data?.tokens || 0
        }`
      );
    } catch (e) {
      enqueueNotice("error", e instanceof Error ? e.message : String(e));
    } finally {
      messageApi.destroy(loadingKey);
      setVectorSearching(false);
    }
  }, [
    appName,
    enqueueNotice,
    messageApi,
    uniqKeepOrder,
    vectorSearchLocalImageDataUrl,
    vectorSearchImageUrl,
    vectorSearchText
  ]);

  const handleVectorSearchLocalImage = useCallback(
    async (file: File) => {
      const isImage = /^image\//i.test(String(file?.type || ""));
      if (!isImage) {
        enqueueNotice("error", "仅支持上传图片文件");
        return;
      }
      const maxBytes = 10 * 1024 * 1024;
      if (Number(file?.size || 0) > maxBytes) {
        enqueueNotice("error", "图片过大，请上传不超过 10MB 的文件");
        return;
      }
      try {
        const dataUrl = await new Promise<string>((resolve, reject) => {
          const reader = new FileReader();
          reader.onload = () => resolve(String(reader.result || ""));
          reader.onerror = () => reject(new Error("读取图片失败"));
          reader.readAsDataURL(file);
        });
        if (!dataUrl) {
          enqueueNotice("error", "读取图片失败");
          return;
        }
        setVectorSearchLocalImageDataUrl(dataUrl);
        setVectorSearchLocalImageName(String(file.name || "local-image"));
        enqueueNotice("success", "本地图片已载入，可直接用于向量搜图");
      } catch (e) {
        enqueueNotice("error", e instanceof Error ? e.message : String(e));
      }
    },
    [enqueueNotice]
  );

  useEffect(() => {
    fetchAppNames();
  }, [fetchAppNames]);

  useEffect(() => {
    if (!appName) return;
    setVectorSearchActive(false);
    setImages([]);
    setTotal(0);
    setLoadedPageCount(0);
    fetchImages(appName, 1, false);
  }, [appName, sortByCost, fetchImages]);

  useEffect(() => {
    setSelectedKeys([]);
  }, [appName]);

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
      dragBoxRef.current = {
        active: true,
        x: st.startX,
        y: st.startY,
        w: dx,
        h: dy
      };
      if (dragRafRef.current) return;
      dragRafRef.current = window.requestAnimationFrame(() => {
        dragRafRef.current = null;
        setDragBox({ ...dragBoxRef.current });
      });
    };
    const onUp = () => {
      const st = dragStateRef.current;
      if (!st.active) return;
      st.active = false;
      const wrap = gridWrapRef.current;
      const moved = st.moved;
      const sx = st.startX,
        sy = st.startY,
        ex = st.curX,
        ey = st.curY;
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
      const nodes = Array.from(
        wrap.querySelectorAll("[data-grid-key]")
      ) as HTMLElement[];
      const picked: string[] = [];
      for (const el of nodes) {
        const k = el.getAttribute("data-grid-key") || "";
        if (!k) continue;
        const r = el.getBoundingClientRect();
        const hit = !(
          r.right < left ||
          r.left > right ||
          r.bottom < top ||
          r.top > bottom
        );
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

  const handleCopyReferencePath = useCallback(async () => {
    if (!appName) {
      enqueueNotice("error", "请先选择 appName");
      return;
    }
    setCopyingPath(true);
    try {
      const isRemoteMode =
        images.length > 0 && /^https?:\/\//i.test(images[0] || "");
      if (selectedKeys.length === 0) {
        if (isRemoteMode) {
          const urls = images
            .map((u) => String(u || "").trim())
            .filter(Boolean);
          if (!urls.length) {
            enqueueNotice("error", "当前没有可复制的网络地址");
            return;
          }
          await navigator.clipboard.writeText(urls.join("\n"));
          enqueueNotice("success", `已复制当前页 ${urls.length} 条网络地址`);
          return;
        }
        const res = await fetch(
          `/api/reference-images?folderPath=1&appName=${encodeURIComponent(
            appName
          )}`,
          { method: "GET" }
        );
        const data = await res.json().catch(() => null);
        if (!res.ok || !data?.ok) {
          enqueueNotice("error", data?.error || "获取文件夹路径失败");
          return;
        }
        const folderPath = String(data?.folderPath ?? "").trim();
        if (!folderPath) {
          enqueueNotice("error", "文件夹路径为空");
          return;
        }
        await navigator.clipboard.writeText(folderPath);
        enqueueNotice("success", "已复制整个 appName 文件夹路径");
        return;
      }
      const urls = selectedImages.map((u) => u).filter(Boolean);
      if (!urls.length) {
        enqueueNotice("error", "选中的图片无效");
        return;
      }
      const hasRemote = urls.some((u) => /^https?:\/\//i.test(u));
      if (hasRemote) {
        await navigator.clipboard.writeText(urls.join("\n"));
        enqueueNotice("success", `已复制 ${urls.length} 条网络地址`);
        return;
      }
      const qs = new URLSearchParams();
      qs.set("paths", "1");
      qs.set("appName", appName);
      qs.set("urls", urls.join(","));
      const res = await fetch(`/api/reference-images?${qs.toString()}`, {
        method: "GET"
      });
      const data = await res.json().catch(() => null);
      if (!res.ok || !data?.ok) {
        enqueueNotice("error", data?.error || "获取路径失败");
        return;
      }
      const paths = Array.isArray(data?.paths)
        ? data.paths.map((x: any) => String(x ?? "").trim()).filter(Boolean)
        : [];
      if (!paths.length) {
        enqueueNotice("error", "未解析到有效路径");
        return;
      }
      await navigator.clipboard.writeText(paths.join("\n"));
      enqueueNotice("success", `已复制 ${paths.length} 条参考图路径`);
    } catch (e) {
      enqueueNotice("error", e instanceof Error ? e.message : String(e));
    } finally {
      setCopyingPath(false);
    }
  }, [appName, enqueueNotice, images, selectedKeys.length, selectedImages]);

  useEffect(() => {
    const sentinel = loadMoreSentinelRef.current;
    if (!sentinel || !hasMore || loadingMore) return;
    const ob = new IntersectionObserver(
      (entries) => {
        if (entries[0]?.isIntersecting)
          fetchImages(appName, loadedPageCount + 1, true);
      },
      { rootMargin: "200px", threshold: 0 }
    );
    ob.observe(sentinel);
    return () => ob.disconnect();
  }, [hasMore, loadingMore, appName, loadedPageCount, fetchImages]);

  return (
    <AdminShell defaultSelectedKey="/reference" headerTitle="参考图广场">
      {contextHolder}
      <Modal
        title="获取参考图"
        open={fetchReferenceModalOpen}
        centered
        maskClosable
        closable
        keyboard
        onCancel={() => {
          setFetchReferenceModalOpen(false);
        }}
        footer={[
          <Button
            key="download"
            type="primary"
            loading={fetchingReferenceImages}
            onClick={async () => {
              setFetchReferenceModalOpen(false);
              await doFetchReferenceImages(true);
            }}
          >
            下载文件并保存映射
          </Button>,
          <Button
            key="remote-only"
            loading={fetchingReferenceImages}
            onClick={async () => {
              setFetchReferenceModalOpen(false);
              await doFetchReferenceImages(false);
            }}
          >
            仅保存网络映射
          </Button>,
          <Button
            key="close"
            onClick={() => {
              setFetchReferenceModalOpen(false);
            }}
          >
            关闭
          </Button>
        ]}
      >
        <Space orientation="vertical" size={12} style={{ width: "100%" }}>
          <Typography.Text>
            请选择本次操作：下载到本地文件夹，或仅保存图片网络地址映射文件。
          </Typography.Text>
          <Space size={6}>
            <Typography.Text type="secondary">刷新 dd 缓存</Typography.Text>
            <Switch
              size="small"
              checked={refreshDdAppDataCache}
              disabled={fetchingReferenceImages}
              onChange={setRefreshDdAppDataCache}
            />
          </Space>
        </Space>
      </Modal>
      <Modal
        title="向量搜图"
        open={vectorSearchModalOpen}
        centered
        maskClosable
        closable
        keyboard
        onCancel={() => {
          setVectorSearchModalOpen(false);
        }}
        footer={[
          <Button
            key="search"
            type="primary"
            loading={vectorSearching}
            onClick={doVectorSearch}
          >
            搜图
          </Button>,
          <Button
            key="close"
            onClick={() => {
              setVectorSearchModalOpen(false);
            }}
          >
            关闭
          </Button>
        ]}
      >
        <Space orientation="vertical" size={12} style={{ width: "100%" }}>
          <Typography.Text type="secondary">
            仅在当前 appName（{appName || "-"}）范围内检索。
          </Typography.Text>
          <Input.TextArea
            rows={3}
            value={vectorSearchText}
            onChange={(e) => setVectorSearchText(e.target.value)}
            placeholder="输入搜图文本（可选）"
            maxLength={800}
          />
          <Input
            value={vectorSearchImageUrl}
            onChange={(e) => setVectorSearchImageUrl(e.target.value)}
            placeholder="输入参考图片 URL（可选）"
            allowClear
          />
          <Space orientation="vertical" size={8} style={{ width: "100%" }}>
            <Upload
              accept="image/*"
              showUploadList={false}
              beforeUpload={(file) => {
                void handleVectorSearchLocalImage(file as File);
                return false;
              }}
            >
              <Button icon={<UploadOutlined />}>上传本地参考图（可选）</Button>
            </Upload>
            {vectorSearchLocalImageDataUrl ? (
              <Space size={8} align="center" wrap>
                <Image
                  src={vectorSearchLocalImageDataUrl}
                  alt={vectorSearchLocalImageName || "local-search-image"}
                  width={84}
                  height={84}
                  style={{ objectFit: "cover", borderRadius: 8 }}
                  preview={false}
                />
                <Typography.Text type="secondary">
                  已选择本地图片：{vectorSearchLocalImageName || "未命名"}
                </Typography.Text>
                <Button
                  size="small"
                  onClick={() => {
                    setVectorSearchLocalImageDataUrl("");
                    setVectorSearchLocalImageName("");
                  }}
                >
                  清除本地图
                </Button>
              </Space>
            ) : null}
          </Space>
          <Typography.Text type="secondary">
            文本、网络图片 URL、本地上传图片至少填写一项；若同时提供本地图和
            URL，将优先使用本地图。
          </Typography.Text>
        </Space>
      </Modal>
      <Modal
        title="向量化参考图"
        open={vectorizeModalOpen}
        centered
        maskClosable
        closable
        keyboard
        onCancel={() => {
          setVectorizeModalOpen(false);
        }}
        footer={[
          <Button
            key="all"
            type="primary"
            loading={vectorizingReferenceImages}
            onClick={async () => {
              setVectorizeModalOpen(false);
              await doVectorizeReferenceImages(false);
            }}
          >
            全量向量化
          </Button>,
          <Button
            key="current"
            loading={vectorizingReferenceImages}
            disabled={!String(appName || "").trim()}
            onClick={async () => {
              setVectorizeModalOpen(false);
              await doVectorizeReferenceImages(true);
            }}
          >
            仅向量化当前 appName
          </Button>,
          <Button
            key="close"
            onClick={() => {
              setVectorizeModalOpen(false);
            }}
          >
            关闭
          </Button>
        ]}
      >
        请选择操作：全量向量化，或仅当前 appName 向量化。
      </Modal>
      <Space orientation="vertical" size={12} style={{ width: "100%" }}>
        <Space wrap>
          <Typography.Text strong>appName：</Typography.Text>
          <Select
            showSearch
            style={{ width: 360 }}
            placeholder="输入搜索或选择 appName"
            value={appName || undefined}
            options={appNameOptions}
            filterOption={(input, option) =>
              (option?.label ?? "")
                .toString()
                .toLowerCase()
                .includes((input || "").toLowerCase())
            }
            onChange={(v) => {
              setAppName(String(v || ""));
            }}
          />
          <Button
            icon={<ReloadOutlined />}
            onClick={() => {
              fetchAppNames();
              if (appName) {
                setLoadedPageCount(0);
                fetchImages(appName, 1, false);
              }
            }}
            loading={loading}
          >
            刷新
          </Button>
          <Button
            icon={<CloudDownloadOutlined />}
            loading={fetchingReferenceImages}
            disabled={loading || loadingMore || vectorizingReferenceImages}
            onClick={handleFetchReferenceImages}
          >
            获取参考图
          </Button>
          <Button
            icon={<SearchOutlined />}
            loading={vectorSearching}
            disabled={
              loading ||
              loadingMore ||
              fetchingReferenceImages ||
              vectorizingReferenceImages ||
              !String(appName || "").trim()
            }
            onClick={handleOpenVectorSearchModal}
          >
            搜图
          </Button>
          <Button
            icon={<ThunderboltOutlined />}
            loading={vectorizingReferenceImages}
            disabled={
              loading ||
              loadingMore ||
              fetchingReferenceImages ||
              vectorSearching
            }
            onClick={handleOpenVectorizeModal}
          >
            向量化
          </Button>
          <Button
            icon={<CopyOutlined />}
            loading={copyingPath}
            disabled={!appName || loading}
            onClick={handleCopyReferencePath}
          >
            复制参考图路径
          </Button>
          {appName ? (
            <Tooltip
              title={
                sortByCost === "default"
                  ? "按 cost 排序（当前：默认）"
                  : sortByCost === "asc"
                  ? "按 cost 排序（当前：升序）"
                  : "按 cost 排序（当前：降序）"
              }
            >
              <Button
                type={sortByCost === "default" ? "default" : "primary"}
                icon={
                  <SortAscendingOutlined
                    style={
                      sortByCost === "desc"
                        ? { transform: "rotate(180deg)" }
                        : undefined
                    }
                  />
                }
                onClick={() =>
                  setSortByCost((prev) =>
                    prev === "default"
                      ? "asc"
                      : prev === "asc"
                      ? "desc"
                      : "default"
                  )
                }
              />
            </Tooltip>
          ) : null}
          <Typography.Text type="secondary">
            {loading
              ? "加载中..."
              : vectorSearchActive && appName
              ? `${appName}：向量搜图结果 ${images.length} 张`
              : appName
              ? `${appName}：${total} 张`
              : `共 ${appNames.length} 个 app`}
          </Typography.Text>
          {selectedKeys.length > 0 ? (
            <Typography.Text type="secondary">
              已选 {selectedKeys.length} 张
            </Typography.Text>
          ) : null}
        </Space>

        {appName && selectedImages.length > 0 ? (
          <div
            style={{
              padding: 10,
              background: "#f5f5f5",
              borderRadius: 10,
              border: "1px solid rgba(0,0,0,0.06)"
            }}
          >
            <Space wrap size={10} align="center" style={{ width: "100%" }}>
              <Typography.Text strong>
                当前已选（{selectedImages.length}）
              </Typography.Text>
              <Typography.Text type="secondary">
                左键拖动框选，右键可选/取消
              </Typography.Text>
              <Button
                size="small"
                onClick={() => setSelectedKeys([])}
                disabled={loading}
              >
                清空已选
              </Button>
              <div style={{ flex: "1 1 100%" }} />
              <Image.PreviewGroup>
                <Space wrap size={8}>
                  {selectedPreviewImages.map((url) => {
                    const key = `${appName}|${url}`;
                    return (
                      <div
                        key={`sel|${key}`}
                        style={{
                          position: "relative",
                          width: 92,
                          height: 52,
                          borderRadius: 8,
                          overflow: "hidden",
                          border: "1px solid rgba(0,0,0,0.12)",
                          background: "#fff",
                          cursor: "pointer"
                        }}
                        onClick={() => {}}
                      >
                        <Image
                          width={92}
                          height={52}
                          style={{ width: 92, height: 52, objectFit: "cover" }}
                          src={url}
                          alt={url}
                        />
                        <div
                          title="移除"
                          onClick={(e) => {
                            e.stopPropagation();
                            togglePick(key);
                          }}
                          style={{
                            position: "absolute",
                            top: 4,
                            right: 4,
                            width: 18,
                            height: 18,
                            borderRadius: 6,
                            background: "rgba(0,0,0,0.55)",
                            color: "#fff",
                            fontSize: 12,
                            display: "flex",
                            alignItems: "center",
                            justifyContent: "center",
                            cursor: "pointer",
                            userSelect: "none"
                          }}
                        >
                          ×
                        </div>
                      </div>
                    );
                  })}
                </Space>
              </Image.PreviewGroup>
            </Space>
          </div>
        ) : null}

        {appName ? (
          <>
            <Image.PreviewGroup>
              <div
                ref={gridWrapRef}
                style={{
                  position: "relative",
                  display: "grid",
                  gridTemplateColumns: "repeat(7, minmax(0, 1fr))",
                  gap: 12,
                  width: "100%",
                  userSelect: dragBox.active ? "none" : undefined,
                  cursor: dragBox.active ? "crosshair" : undefined
                }}
                onMouseDown={(e) => {
                  if (e.button !== 0) return;
                  const wrap = gridWrapRef.current;
                  if (!wrap) return;
                  const rect = wrap.getBoundingClientRect();
                  const x = e.clientX - rect.left;
                  const y = e.clientY - rect.top;
                  dragStateRef.current = {
                    active: true,
                    moved: false,
                    startX: x,
                    startY: y,
                    curX: x,
                    curY: y
                  };
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
                      boxShadow:
                        "0 0 0 2px rgba(255,255,255,0.65) inset, 0 8px 20px rgba(0,160,255,0.25)",
                      outline: "1px dashed rgba(0,0,0,0.25)",
                      borderRadius: 6,
                      pointerEvents: "none",
                      zIndex: 10
                    }}
                  />
                ) : null}
                {imagesToRender.map((url) => {
                  const key = `${appName}|${url}`;
                  const selected = selectedKeySet.has(key);
                  const cost = imageCostMap.get(url) ?? "";
                  return (
                    <div
                      key={key}
                      data-grid-key={key}
                      style={{
                        position: "relative",
                        cursor: "default",
                        width: "100%",
                        aspectRatio: "16 / 9",
                        overflow: "hidden",
                        borderRadius: 10,
                        border: selected
                          ? "3px solid #1677ff"
                          : "1px solid rgba(0,0,0,0.06)",
                        boxShadow: selected
                          ? "0 0 0 3px rgba(22,119,255,0.22)"
                          : undefined
                      }}
                      onContextMenu={(e) => {
                        e.preventDefault();
                        togglePick(key);
                      }}
                      onClick={(e) => {
                        if (suppressClickRef.current) {
                          e.preventDefault();
                          e.stopPropagation();
                          suppressClickRef.current = false;
                        }
                      }}
                    >
                      <Image
                        width="100%"
                        height="100%"
                        style={{
                          width: "100%",
                          height: "100%",
                          objectFit: "cover"
                        }}
                        src={url}
                        alt={url}
                        loading="lazy"
                      />
                      {cost ? (
                        <div
                          style={{
                            position: "absolute",
                            top: 0,
                            right: 0,
                            zIndex: 20,
                            padding: "4px 8px",
                            borderBottomLeftRadius: 8,
                            background: "rgba(0,0,0,0.75)",
                            color: "#fff",
                            fontSize: 12,
                            fontWeight: 600,
                            textShadow:
                              "0 0 2px rgba(0,0,0,0.9), 0 1px 2px rgba(0,0,0,0.8)",
                            userSelect: "none",
                            pointerEvents: "none"
                          }}
                        >
                          {cost}
                        </div>
                      ) : null}
                      {selected ? (
                        <div
                          style={{
                            position: "absolute",
                            inset: 0,
                            zIndex: 10,
                            background: "rgba(22,119,255,0.16)",
                            pointerEvents: "none"
                          }}
                        />
                      ) : null}
                      {selected ? (
                        <div
                          style={{
                            position: "absolute",
                            top: 8,
                            left: 8,
                            zIndex: 21,
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
                            userSelect: "none"
                          }}
                        >
                          ✓
                        </div>
                      ) : null}
                    </div>
                  );
                })}
              </div>
            </Image.PreviewGroup>
            <div
              ref={loadMoreSentinelRef}
              style={{ height: 1, width: "100%", visibility: "hidden" }}
            />
            {total > 0 ? (
              hasMore ? (
                <div
                  style={{
                    textAlign: "center",
                    padding: "16px 0",
                    color: "rgba(0,0,0,0.45)"
                  }}
                >
                  {loadingMore
                    ? "加载中..."
                    : `已展示 ${images.length} / ${total} 张，下拉加载更多`}
                </div>
              ) : (
                <div
                  style={{
                    textAlign: "center",
                    padding: "16px 0",
                    color: "rgba(0,0,0,0.45)"
                  }}
                >
                  共 {total} 张，已全部加载
                </div>
              )
            ) : null}
          </>
        ) : null}
      </Space>
    </AdminShell>
  );
}
