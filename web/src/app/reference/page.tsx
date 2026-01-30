"use client";

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { Button, Image, Select, Space, Typography, message } from "antd";
import { ReloadOutlined } from "@ant-design/icons";
import AdminShell from "@/app/_components/AdminShell";

const PAGE_SIZE = 100;

export default function ReferenceGalleryPage() {
  const [messageApi, contextHolder] = message.useMessage();
  const [loading, setLoading] = useState(false);
  const [loadingMore, setLoadingMore] = useState(false);
  const [appNames, setAppNames] = useState<string[]>([]);
  const [appName, setAppName] = useState<string>("");
  const [images, setImages] = useState<string[]>([]);
  const [total, setTotal] = useState(0);
  const [loadedPageCount, setLoadedPageCount] = useState(0);
  const loadMoreSentinelRef = useRef<HTMLDivElement | null>(null);

  const appNameOptions = useMemo(() => appNames.map((x) => ({ label: x, value: x })), [appNames]);
  const hasMore = loadedPageCount * PAGE_SIZE < total;

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
          <Typography.Text type="secondary">
            {loading ? "加载中..." : appName ? `${appName}：${total} 张` : `共 ${appNames.length} 个 app`}
          </Typography.Text>
        </Space>

        {appName ? (
          <>
            <Image.PreviewGroup>
              <div style={{ position: "relative", display: "grid", gridTemplateColumns: "repeat(7, minmax(0, 1fr))", gap: 12, width: "100%" }}>
                {images.map((url) => (
                  <div
                    key={`${appName}|${url}`}
                    style={{ position: "relative", cursor: "default", width: "100%", aspectRatio: "16 / 9", overflow: "hidden", borderRadius: 10, border: "1px solid rgba(0,0,0,0.06)" }}
                  >
                    <Image width="100%" height="100%" style={{ width: "100%", height: "100%", objectFit: "cover" }} src={url} alt={url} loading="lazy" />
                  </div>
                ))}
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

