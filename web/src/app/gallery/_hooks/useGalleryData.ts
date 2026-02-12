"use client";

import { useCallback, useEffect, useRef, useState } from "react";

import type { HistoryItem } from "../_lib/types";

export function useGalleryData(args: {
  messageApi: any;
  appName: string;
  lang: string;
  paginationResetKey: string;
  onReplace?: () => void;
  onFlagsLoaded?: (flags: {
    cutUrls: string[];
    fireplayUploadedUrls: string[];
    downloadedUrls: string[];
  }) => void;
}) {
  const {
    messageApi,
    appName,
    lang,
    paginationResetKey,
    onReplace,
    onFlagsLoaded,
  } = args;

  const onReplaceRef = useRef<typeof onReplace>(onReplace);
  const onFlagsLoadedRef = useRef<typeof onFlagsLoaded>(onFlagsLoaded);

  useEffect(() => {
    onReplaceRef.current = onReplace;
  }, [onReplace]);

  useEffect(() => {
    onFlagsLoadedRef.current = onFlagsLoaded;
  }, [onFlagsLoaded]);

  const [filteredCount, setFilteredCount] = useState(0);
  const [items, setItems] = useState<HistoryItem[]>([]);
  const [loading, setLoading] = useState(false);
  const [loadingMore, setLoadingMore] = useState(false);
  const [dataHasMore, setDataHasMore] = useState(false);
  const [dataTotalCount, setDataTotalCount] = useState<number | null>(null);

  const [appNameForFetch, setAppNameForFetch] = useState<string>("");

  const [galleryPage, setGalleryPage] = useState(1);
  const galleryPageSize = 100;

  const loadMoreSentinelRef = useRef<HTMLDivElement | null>(null);
  const itemsLengthRef = useRef(0);

  useEffect(() => {
    const t = setTimeout(() => setAppNameForFetch(appName), 250);
    return () => clearTimeout(t);
  }, [appName]);

  const emitFlags = useCallback((data2: any) => {
    if (!data2?.ok) return;
    const cutUrls = Array.isArray(data2.cutUrls)
      ? (data2.cutUrls as any[]).map((x: any) => String(x || "").trim()).filter(Boolean)
      : [];
    const fireplayUploadedUrls = Array.isArray(data2.fireplayUploadedUrls)
      ? (data2.fireplayUploadedUrls as any[]).map((x: any) => String(x || "").trim()).filter(Boolean)
      : [];
    const downloadedUrls = Array.isArray(data2.downloadedUrls)
      ? (data2.downloadedUrls as any[]).map((x: any) => String(x || "").trim()).filter(Boolean)
      : [];

    if (cutUrls.length || fireplayUploadedUrls.length || downloadedUrls.length) {
      onFlagsLoadedRef.current?.({ cutUrls, fireplayUploadedUrls, downloadedUrls });
    }
  }, []);

  const fetchImages = useCallback(
    async (offset = 0) => {
      const isAppend = offset > 0;
      if (isAppend) setLoadingMore(true);
      else setLoading(true);
      try {
        const qs = new URLSearchParams();
        qs.set("status", "completed");
        qs.set("limit", "800");
        qs.set("offset", String(offset));
        if (appNameForFetch) qs.set("appName", appNameForFetch);
        if (lang) qs.set("lang", lang);
        const res = await fetch(`/api/generation-records?${qs.toString()}`, {
          method: "GET",
        });
        const data = await res.json();
        if (!res.ok || !data?.ok) {
          messageApi.error(data?.error || "获取图片记录失败");
          return;
        }
        const arr = Array.isArray(data.items) ? data.items : [];
        setDataHasMore(!!data.hasMore);
        if (typeof data.totalCount === "number") setDataTotalCount(data.totalCount);

        if (isAppend) {
          setItems((prev) => [...prev, ...arr]);
        } else {
          setItems(arr);
          setGalleryPage(1);
          onReplaceRef.current?.();
        }

        const urlsToFetchFlags = arr
          .map((x: any) => String(x?.url || "").trim())
          .filter(Boolean);
        if (urlsToFetchFlags.length) {
          const firstBatchUrls = urlsToFetchFlags.slice(0, 300);
          const res2 = await fetch("/api/cut-records/flags", {
            method: "POST",
            headers: { "content-type": "application/json" },
            body: JSON.stringify({ urls: firstBatchUrls }),
          });
          const data2 = await res2.json().catch(() => null);
          if (res2.ok) emitFlags(data2);

          const restUrls = urlsToFetchFlags.slice(300);
          if (restUrls.length) {
            fetch("/api/cut-records/flags", {
              method: "POST",
              headers: { "content-type": "application/json" },
              body: JSON.stringify({ urls: restUrls }),
            })
              .then((r) => r.json().catch(() => null))
              .then((data2: any) => emitFlags(data2))
              .catch(() => { });
          }
        }
      } catch (e) {
        messageApi.error(e instanceof Error ? e.message : String(e));
      } finally {
        setLoading(false);
        setLoadingMore(false);
      }
    },
    [appNameForFetch, emitFlags, lang, messageApi]
  );

  useEffect(() => {
    fetchImages();
  }, [fetchImages]);

  const hasMore = galleryPage * galleryPageSize < filteredCount;

  useEffect(() => {
    itemsLengthRef.current = items.length;
  }, [items.length]);

  useEffect(() => {
    setGalleryPage(1);
  }, [paginationResetKey]);

  useEffect(() => {
    const sentinel = loadMoreSentinelRef.current;
    if (!sentinel) return;
    const ob = new IntersectionObserver(
      (entries) => {
        if (!entries[0]?.isIntersecting) return;
        if (hasMore) {
          setGalleryPage((p) => p + 1);
        } else if (dataHasMore && !loadingMore) {
          fetchImages(itemsLengthRef.current);
        }
      },
      { rootMargin: "200px", threshold: 0 }
    );
    ob.observe(sentinel);
    return () => ob.disconnect();
  }, [dataHasMore, fetchImages, hasMore, loadingMore]);

  return {
    setFilteredCount,
    items,
    loading,
    loadingMore,
    dataHasMore,
    dataTotalCount,
    fetchImages,
    appNameForFetch,
    galleryPage,
    galleryPageSize,
    hasMore,
    loadMoreSentinelRef,
  };
}

