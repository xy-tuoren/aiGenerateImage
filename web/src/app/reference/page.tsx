"use client";

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { Button, Image, Select, Space, Typography, message } from "antd";
import { ReloadOutlined, CloudDownloadOutlined, CopyOutlined } from "@ant-design/icons";
import AdminShell from "@/app/_components/AdminShell";

const PAGE_SIZE = 100;

export default function ReferenceGalleryPage() {
  const [messageApi, contextHolder] = message.useMessage();
  const [loading, setLoading] = useState(false);
  const [loadingMore, setLoadingMore] = useState(false);
  const [fetchingReferenceImages, setFetchingReferenceImages] = useState(false);
  const [appNames, setAppNames] = useState<string[]>([]);
  const [appName, setAppName] = useState<string>("");
  const [images, setImages] = useState<string[]>([]);
  const [total, setTotal] = useState(0);
  const [loadedPageCount, setLoadedPageCount] = useState(0);
  const [selectedKeys, setSelectedKeys] = useState<string[]>([]);
  const [copyingPath, setCopyingPath] = useState(false);
  const loadMoreSentinelRef = useRef<HTMLDivElement | null>(null);

  const appNameOptions = useMemo(() => appNames.map((x) => ({ label: x, value: x })), [appNames]);
  const hasMore = loadedPageCount * PAGE_SIZE < total;
  const selectedKeySet = useMemo(() => new Set(selectedKeys), [selectedKeys]);
  const selectedImages = useMemo(() => images.filter((url) => selectedKeys.includes(`${appName}|${url}`)), [images, appName, selectedKeys]);
  const selectedPreviewImages = useMemo(() => selectedImages.slice(0, 80), [selectedImages]);

  const togglePick = useCallback((key: string) => {
    setSelectedKeys((prev) => (prev.includes(key) ? prev.filter((x) => x !== key) : [...prev, key]));
  }, []);

  const getCostFromImageUrl = useCallback((imageUrl: string) => {
    try {
      const lastSegRaw = imageUrl.split("/").pop() || "";
      const lastSeg = lastSegRaw.split("?")[0]?.split("#")[0] || "";
      const decoded = decodeURIComponent(lastSeg);
      const base = decoded.replace(/\.[^.]+$/, "");
      const m = base.match(/-(\d+)$/);
      const cost = m?.[1] ?? "";
      return cost;
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

  const fetchAppNames = useCallback(async () => {
    setLoading(true);
    try {
      const res = await fetch("/api/reference-images?names=1", { method: "GET" });
      const data = await res.json().catch(() => null);
      if (!res.ok || !data?.ok) {
        messageApi.error(data?.error || "获取 appName 列表失败");
        return;
      }
      const next = Array.isArray(data?.appNames) ? data.appNames.map((x: any) => String(x || "").trim()).filter(Boolean) : [];
      setAppNames(next);
      setAppName((prev) => prev || next[0] || "");
    } catch (e) {
      messageApi.error(e instanceof Error ? e.message : String(e));
    } finally {
      setLoading(false);
    }
  }, [messageApi]);

  const fetchImages = useCallback(
    async (nextAppName: string, pageNum: number, append: boolean) => {
      const a = String(nextAppName || "").trim();
      if (!a) {
        setImages([]);
        setTotal(0);
        setLoadedPageCount(0);
        return;
      }
      if (append) setLoadingMore(true);
      else setLoading(true);
      try {
        const qs = new URLSearchParams();
        qs.set("appName", a);
        qs.set("page", String(pageNum || 1));
        qs.set("pageSize", String(PAGE_SIZE));
        const res = await fetch(`/api/reference-images?${qs.toString()}`, { method: "GET" });
        const data = await res.json().catch(() => null);
        if (!res.ok || !data?.ok) {
          messageApi.error(data?.error || "获取参考图失败");
          return;
        }
        const list = Array.isArray(data?.images) ? data.images.map((x: any) => String(x || "").trim()).filter(Boolean) : [];
        const newTotal = typeof data?.total === "number" ? data.total : 0;
        setTotal(newTotal);
        if (append) {
          setImages((prev) => [...prev, ...list]);
          setLoadedPageCount((p) => p + 1);
        } else {
          setImages(list);
          setLoadedPageCount(1);
        }
      } catch (e) {
        messageApi.error(e instanceof Error ? e.message : String(e));
      } finally {
        if (append) setLoadingMore(false);
        else setLoading(false);
      }
    },
    [messageApi]
  );

  const handleFetchReferenceImages = useCallback(async () => {
    setFetchingReferenceImages(true);
    try {
      const res = await fetch("/api/reference-images", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({}),
      });
      const data = await res.json().catch(() => null);
      if (!res.ok || !data?.ok) {
        messageApi.error(data?.error || "获取参考图失败");
        return;
      }
      messageApi.success(`获取参考图成功：app=${data?.appNames || 0} items=${data?.totalItems || 0} files=${data?.totalFiles || 0}`);
      fetchAppNames();
      if (appName) {
        setLoadedPageCount(0);
        fetchImages(appName, 1, false);
      }
    } catch (e) {
      messageApi.error(e instanceof Error ? e.message : String(e));
    } finally {
      setFetchingReferenceImages(false);
    }
  }, [appName, fetchAppNames, fetchImages, messageApi]);

  useEffect(() => {
    fetchAppNames();
  }, [fetchAppNames]);

  useEffect(() => {
    if (!appName) return;
    setImages([]);
    setTotal(0);
    setLoadedPageCount(0);
    fetchImages(appName, 1, false);
  }, [appName, fetchImages]);

  useEffect(() => {
    setSelectedKeys([]);
  }, [appName]);

  const handleCopyReferencePath = useCallback(async () => {
    if (!appName) {
      messageApi.error("请先选择 appName");
      return;
    }
    setCopyingPath(true);
    try {
      if (selectedKeys.length === 0) {
        const res = await fetch(`/api/reference-images?folderPath=1&appName=${encodeURIComponent(appName)}`, { method: "GET" });
        const data = await res.json().catch(() => null);
        if (!res.ok || !data?.ok) {
          messageApi.error(data?.error || "获取文件夹路径失败");
          return;
        }
        const folderPath = String(data?.folderPath ?? "").trim();
        if (!folderPath) {
          messageApi.error("文件夹路径为空");
          return;
        }
        await navigator.clipboard.writeText(folderPath);
        messageApi.success("已复制整个 appName 文件夹路径");
        return;
      }
      const urls = selectedImages.map((u) => u).filter(Boolean);
      if (!urls.length) {
        messageApi.error("选中的图片无效");
        return;
      }
      const qs = new URLSearchParams();
      qs.set("paths", "1");
      qs.set("appName", appName);
      qs.set("urls", urls.join(","));
      const res = await fetch(`/api/reference-images?${qs.toString()}`, { method: "GET" });
      const data = await res.json().catch(() => null);
      if (!res.ok || !data?.ok) {
        messageApi.error(data?.error || "获取路径失败");
        return;
      }
      const paths = Array.isArray(data?.paths) ? data.paths.map((x: any) => String(x ?? "").trim()).filter(Boolean) : [];
      if (!paths.length) {
        messageApi.error("未解析到有效路径");
        return;
      }
      await navigator.clipboard.writeText(paths.join("\n"));
      messageApi.success(`已复制 ${paths.length} 条参考图路径`);
    } catch (e) {
      messageApi.error(e instanceof Error ? e.message : String(e));
    } finally {
      setCopyingPath(false);
    }
  }, [appName, messageApi, selectedKeys.length, selectedImages]);

  useEffect(() => {
    const sentinel = loadMoreSentinelRef.current;
    if (!sentinel || !hasMore || loadingMore) return;
    const ob = new IntersectionObserver(
      (entries) => {
        if (entries[0]?.isIntersecting) fetchImages(appName, loadedPageCount + 1, true);
      },
      { rootMargin: "200px", threshold: 0 }
    );
    ob.observe(sentinel);
    return () => ob.disconnect();
  }, [hasMore, loadingMore, appName, loadedPageCount, fetchImages]);

  return (
    <AdminShell defaultSelectedKey="/reference" headerTitle="参考图广场">
      {contextHolder}
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
              (option?.label ?? "").toString().toLowerCase().includes((input || "").toLowerCase())
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
            disabled={loading || loadingMore}
            onClick={handleFetchReferenceImages}
          >
            获取参考图
          </Button>
          <Button
            icon={<CopyOutlined />}
            loading={copyingPath}
            disabled={!appName || loading}
            onClick={handleCopyReferencePath}
          >
            复制参考图路径
          </Button>
          <Typography.Text type="secondary">
            {loading ? "加载中..." : appName ? `${appName}：${total} 张` : `共 ${appNames.length} 个 app`}
          </Typography.Text>
          {selectedKeys.length > 0 ? <Typography.Text type="secondary">已选 {selectedKeys.length} 张</Typography.Text> : null}
        </Space>

        {appName && selectedImages.length > 0 ? (
          <div style={{ padding: 10, background: "#f5f5f5", borderRadius: 10, border: "1px solid rgba(0,0,0,0.06)" }}>
            <Space wrap size={10} align="center" style={{ width: "100%" }}>
              <Typography.Text strong>当前已选（{selectedImages.length}）</Typography.Text>
              <Typography.Text type="secondary">右键可选/取消</Typography.Text>
              <Button size="small" onClick={() => setSelectedKeys([])} disabled={loading}>
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
                        style={{ position: "relative", width: 92, height: 52, borderRadius: 8, overflow: "hidden", border: "1px solid rgba(0,0,0,0.12)", background: "#fff", cursor: "pointer" }}
                        onClick={() => {}}
                      >
                        <Image width={92} height={52} style={{ width: 92, height: 52, objectFit: "cover" }} src={url} alt={url} />
                        <div
                          title="移除"
                          onClick={(e) => { e.stopPropagation(); togglePick(key); }}
                          style={{ position: "absolute", top: 4, right: 4, width: 18, height: 18, borderRadius: 6, background: "rgba(0,0,0,0.55)", color: "#fff", fontSize: 12, display: "flex", alignItems: "center", justifyContent: "center", cursor: "pointer", userSelect: "none" }}
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
              <div style={{ position: "relative", display: "grid", gridTemplateColumns: "repeat(7, minmax(0, 1fr))", gap: 12, width: "100%" }}>
                {images.map((url) => {
                  const key = `${appName}|${url}`;
                  const selected = selectedKeySet.has(key);
                  const cost = imageCostMap.get(url) ?? "";
                  return (
                    <div
                      key={key}
                      style={{
                        position: "relative",
                        cursor: "default",
                        width: "100%",
                        aspectRatio: "16 / 9",
                        overflow: "hidden",
                        borderRadius: 10,
                        border: selected ? "3px solid #1677ff" : "1px solid rgba(0,0,0,0.06)",
                        boxShadow: selected ? "0 0 0 3px rgba(22,119,255,0.22)" : undefined,
                      }}
                      onContextMenu={(e) => {
                        e.preventDefault();
                        togglePick(key);
                      }}
                    >
                      <Image width="100%" height="100%" style={{ width: "100%", height: "100%", objectFit: "cover" }} src={url} alt={url} loading="lazy" />
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
                            textShadow: "0 0 2px rgba(0,0,0,0.9), 0 1px 2px rgba(0,0,0,0.8)",
                            userSelect: "none",
                            pointerEvents: "none",
                          }}
                        >
                          {cost}
                        </div>
                      ) : null}
                      {selected ? <div style={{ position: "absolute", inset: 0, zIndex: 10, background: "rgba(22,119,255,0.16)", pointerEvents: "none" }} /> : null}
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
                            userSelect: "none",
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
            <div ref={loadMoreSentinelRef} style={{ height: 1, width: "100%", visibility: "hidden" }} />
            {total > 0 ? (
              hasMore ? (
                <div style={{ textAlign: "center", padding: "16px 0", color: "rgba(0,0,0,0.45)" }}>
                  {loadingMore ? "加载中..." : `已展示 ${images.length} / ${total} 张，下拉加载更多`}
                </div>
              ) : (
                <div style={{ textAlign: "center", padding: "16px 0", color: "rgba(0,0,0,0.45)" }}>
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

