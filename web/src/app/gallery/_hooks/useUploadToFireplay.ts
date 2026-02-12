"use client";

import axios from "axios";
import { useCallback, useEffect, useState } from "react";

import type { GridImage } from "../_lib/types";

export function useUploadToFireplay(args: {
  messageApi: any;
  selectedKeys: string[];
  keyToImg: Map<string, GridImage>;
  onUploadedSourceUrls?: (urls: string[]) => void;
  onBeforeUpload?: () => void;
}) {
  const {
    messageApi,
    selectedKeys,
    keyToImg,
    onUploadedSourceUrls,
    onBeforeUpload,
  } = args;
  const [uploadingFireplay, setUploadingFireplay] = useState(false);
  const [pendingMessage, setPendingMessage] = useState<
    | { type: "success" | "error"; content: string }
    | null
  >(null);

  useEffect(() => {
    if (!pendingMessage) return;
    if (pendingMessage.type === "success") {
      messageApi.success(pendingMessage.content);
    } else {
      messageApi.error(pendingMessage.content);
    }
    setPendingMessage(null);
  }, [messageApi, pendingMessage]);

  const onUploadToFireplay = useCallback(async () => {
    if (!selectedKeys.length) {
      setPendingMessage({ type: "error", content: "请先选择要上传的图片" });
      return;
    }
    const picked = selectedKeys
      .map((k) => keyToImg.get(k))
      .filter(Boolean) as GridImage[];
    if (!picked.length) {
      setPendingMessage({ type: "error", content: "选中的图片无效" });
      return;
    }
    onBeforeUpload?.();
    setUploadingFireplay(true);
    try {
      const imageUrls = picked
        .map((x) => String(x.url || "").trim())
        .filter(Boolean);
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
      setPendingMessage({
        type: "success",
        content: `已上传 Fireplay：成功 ${successCount} 张${failCount ? `，失败 ${failCount} 张` : ""
          }`,
      });
      const uploadedSourceUrls = Array.isArray(data?.uploadedSourceUrls)
        ? data.uploadedSourceUrls
          .map((x: any) => String(x || "").trim())
          .filter(Boolean)
        : [];
      if (uploadedSourceUrls.length) onUploadedSourceUrls?.(uploadedSourceUrls);
    } catch (e: any) {
      const msg =
        e?.response?.data?.error ||
        e?.response?.data?.message ||
        (e instanceof Error ? e.message : String(e));
      setPendingMessage({ type: "error", content: msg });
    } finally {
      setUploadingFireplay(false);
    }
  }, [
    keyToImg,
    onBeforeUpload,
    onUploadedSourceUrls,
    selectedKeys,
    setPendingMessage,
  ]);

  return { uploadingFireplay, onUploadToFireplay };
}

