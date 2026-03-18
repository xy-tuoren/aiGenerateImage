"use client";

import { PlusOutlined, SendOutlined } from "@ant-design/icons";
import { Button, Image, Input, Modal, Spin, Typography } from "antd";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";

import type { GridImage } from "../_lib/types";

type ChatMessage = {
  role: "user" | "assistant";
  text?: string;
  imageBase64?: string;
  imageMimeType?: string;
  imageUrl?: string;
  thoughtSignature?: string;
};

export function ImageEditDialog(props: {
  open: boolean;
  onClose: () => void;
  initialImages: GridImage[];
  aspectRatio?: string;
  messageApi: any;
  onSaved: (payload?: {
    type: "override";
    url: string;
    originalUrl?: string;
  }) => void;
}) {
  const { open, onClose, initialImages, aspectRatio, messageApi, onSaved } =
    props;
  const [referenceUrls, setReferenceUrls] = useState<string[]>([]);
  const [uploadedImages, setUploadedImages] = useState<
    Array<{ dataUrl: string; data: string; mimeType: string }>
  >([]);
  const [prompt, setPrompt] = useState("");
  const [generating, setGenerating] = useState(false);
  const [saving, setSaving] = useState(false);
  const [messages, setMessages] = useState<ChatMessage[]>([]);
  const [lastResult, setLastResult] = useState<{
    imageBase64: string;
    mimeType: string;
  } | null>(null);
  const [modalWidth, setModalWidth] = useState<string | number>(900);
  const chatEndRef = useRef<HTMLDivElement>(null);
  const fileInputRef = useRef<HTMLInputElement>(null);
  const prevScrollLockRef = useRef<{
    bodyOverflow: string;
    bodyPaddingRight: string;
    htmlOverflow: string;
    htmlPaddingRight: string;
  } | null>(null);

  // Initialize reference images when dialog opens
  useEffect(() => {
    if (open && initialImages.length) {
      setReferenceUrls(initialImages.map((img) => img.url));
    }
  }, [open, initialImages]);

  // Modal width by viewport
  useEffect(() => {
    if (!open) return;
    const update = () => {
      const w = typeof window !== "undefined" ? window.innerWidth : 1200;
      if (w < 576) setModalWidth("96vw");
      else if (w < 768) setModalWidth("92vw");
      else if (w < 1200) setModalWidth(Math.min(720, w * 0.92));
      else setModalWidth(Math.min(1000, Math.floor(w * 0.6)));
    };
    update();
    window.addEventListener("resize", update);
    return () => window.removeEventListener("resize", update);
  }, [open]);

  // Lock page scroll when modal is open
  useEffect(() => {
    if (!open) {
      if (prevScrollLockRef.current) {
        const prev = prevScrollLockRef.current;
        document.body.style.overflow = prev.bodyOverflow;
        document.body.style.paddingRight = prev.bodyPaddingRight;
        document.documentElement.style.overflow = prev.htmlOverflow;
        document.documentElement.style.paddingRight = prev.htmlPaddingRight;
        prevScrollLockRef.current = null;
      }
      return;
    }

    if (typeof window === "undefined") return;
    if (prevScrollLockRef.current) return;

    const body = document.body;
    const html = document.documentElement;
    prevScrollLockRef.current = {
      bodyOverflow: body.style.overflow || "",
      bodyPaddingRight: body.style.paddingRight || "",
      htmlOverflow: html.style.overflow || "",
      htmlPaddingRight: html.style.paddingRight || ""
    };

    const scrollbarWidth = Math.max(
      0,
      (window.innerWidth || 0) - (document.documentElement?.clientWidth || 0)
    );
    html.style.overflow = "hidden";
    body.style.overflow = "hidden";
    if (scrollbarWidth > 0) body.style.paddingRight = `${scrollbarWidth}px`;

    const onWheel = (e: Event) => {
      const target = e.target as Node | null;
      const modal = document.querySelector(".ant-modal");
      if (modal && target && modal.contains(target)) return;
      e.preventDefault();
    };
    const opts: AddEventListenerOptions = { passive: false, capture: true };
    document.addEventListener("wheel", onWheel, opts);
    document.addEventListener("touchmove", onWheel, opts);

    return () => {
      document.removeEventListener("wheel", onWheel as any, opts as any);
      document.removeEventListener("touchmove", onWheel as any, opts as any);
      if (!prevScrollLockRef.current) return;
      const prev = prevScrollLockRef.current;
      document.body.style.overflow = prev.bodyOverflow;
      document.body.style.paddingRight = prev.bodyPaddingRight;
      document.documentElement.style.overflow = prev.htmlOverflow;
      document.documentElement.style.paddingRight = prev.htmlPaddingRight;
      prevScrollLockRef.current = null;
    };
  }, [open]);

  // Scroll to bottom when messages change
  useEffect(() => {
    chatEndRef.current?.scrollIntoView({ behavior: "smooth" });
  }, [messages]);

  // Cleanup on close
  const handleClose = useCallback(() => {
    setReferenceUrls([]);
    setUploadedImages([]);
    setPrompt("");
    setGenerating(false);
    setSaving(false);
    setMessages([]);
    setLastResult(null);
    onClose();
  }, [onClose]);

  const handleFileUpload = useCallback(
    (e: React.ChangeEvent<HTMLInputElement>) => {
      const files = e.target.files;
      if (!files) return;
      Array.from(files).forEach((file) => {
        const reader = new FileReader();
        reader.onload = () => {
          const dataUrl = reader.result as string;
          const [prefix, base64] = dataUrl.split(",");
          const mimeMatch = prefix.match(/data:(.*?);/);
          const mimeType = mimeMatch?.[1] || "image/png";
          setUploadedImages((prev) => [
            ...prev,
            { dataUrl, data: base64, mimeType }
          ]);
        };
        reader.readAsDataURL(file);
      });
      try {
        e.target.value = "";
      } catch {}
    },
    []
  );

  const removeReferenceUrl = useCallback((idx: number) => {
    setReferenceUrls((prev) => prev.filter((_, i) => i !== idx));
  }, []);

  const removeUploadedImage = useCallback((idx: number) => {
    setUploadedImages((prev) => prev.filter((_, i) => i !== idx));
  }, []);

  const handleSend = useCallback(async () => {
    if (!prompt.trim() || generating) return;
    const userMessage: ChatMessage = { role: "user", text: prompt };
    setMessages((prev) => [...prev, userMessage]);
    setPrompt("");
    setGenerating(true);

    try {
      const res = await fetch("/api/image-edit/chat", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({
          prompt: prompt.trim(),
          history: messages,
          referenceImageUrls: referenceUrls,
          referenceImageInline: uploadedImages.map((img) => ({
            data: img.data,
            mimeType: img.mimeType
          })),
          aspectRatio: aspectRatio || undefined
        })
      });
      const data = await res.json();
      if (!res.ok || !data?.ok) {
        const errMsg = data?.error || "生成失败";
        setMessages((prev) => [
          ...prev,
          { role: "assistant", text: `错误: ${errMsg}` }
        ]);
        messageApi.error(errMsg);
        return;
      }

      const result = { imageBase64: data.imageBase64, mimeType: data.mimeType };
      setLastResult(result);
      setMessages((prev) => [
        ...prev,
        {
          role: "assistant",
          imageBase64: data.imageBase64,
          imageMimeType: data.mimeType,
          thoughtSignature: data.thoughtSignature || undefined
        }
      ]);
    } catch (e: any) {
      const msg = e instanceof Error ? e.message : String(e);
      setMessages((prev) => [
        ...prev,
        { role: "assistant", text: `错误: ${msg}` }
      ]);
      messageApi.error(msg);
    } finally {
      setGenerating(false);
    }
  }, [
    prompt,
    generating,
    referenceUrls,
    uploadedImages,
    aspectRatio,
    messageApi,
    messages
  ]);

  const handleSave = useCallback(
    async (mode: "override" | "new") => {
      if (!lastResult || saving) return;

      const originalUrl = initialImages[0]?.url;
      if (mode === "override" && !originalUrl) {
        messageApi.error("无法覆盖：找不到原始图片");
        return;
      }

      setSaving(true);
      try {
        const res = await fetch("/api/image-edit/save", {
          method: "POST",
          headers: { "content-type": "application/json" },
          body: JSON.stringify({
            imageBase64: lastResult.imageBase64,
            mimeType: lastResult.mimeType,
            mode,
            originalUrl: mode === "override" ? originalUrl : undefined,
            appName: initialImages[0]?.appName || undefined,
            lang: initialImages[0]?.lang || undefined,
            aspectRatio: aspectRatio || undefined,
            prompt: messages.find((m) => m.role === "user")?.text || undefined,
            referenceImageUrls: referenceUrls.length ? referenceUrls : undefined
          })
        });
        const data = await res.json();
        if (!res.ok || !data?.ok) {
          messageApi.error(data?.error || "保存失败");
          return;
        }
        messageApi.success(mode === "override" ? "已覆盖原图" : "已保存为新图");
        if (mode === "override" && data?.url) {
          onSaved({
            type: "override",
            url: String(data.url),
            originalUrl: originalUrl || undefined
          });
        } else {
          onSaved();
        }
        handleClose();
      } catch (e: any) {
        messageApi.error(e instanceof Error ? e.message : String(e));
      } finally {
        setSaving(false);
      }
    },
    [
      lastResult,
      saving,
      initialImages,
      aspectRatio,
      messages,
      referenceUrls,
      messageApi,
      onSaved,
      handleClose
    ]
  );

  const allReferenceImages = useMemo(() => {
    const result: Array<{
      type: "url" | "uploaded";
      url?: string;
      dataUrl?: string;
      idx: number;
    }> = [];
    referenceUrls.forEach((url, idx) => result.push({ type: "url", url, idx }));
    uploadedImages.forEach((img, idx) =>
      result.push({ type: "uploaded", dataUrl: img.dataUrl, idx })
    );
    return result;
  }, [referenceUrls, uploadedImages]);

  return (
    <Modal
      title="改图对话"
      open={open}
      onCancel={handleClose}
      destroyOnHidden
      footer={null}
      width={modalWidth}
      styles={{ body: { padding: 0 } }}
    >
      <div style={{ display: "flex", flexDirection: "column", height: "70vh" }}>
        {/* Reference Images Area */}
        <div
          style={{
            padding: "12px 16px",
            borderBottom: "1px solid rgba(0,0,0,0.06)",
            background: "#fafafa"
          }}
        >
          <div style={{ marginBottom: 8 }}>
            <Typography.Text strong style={{ fontSize: 13 }}>
              参考图 ({allReferenceImages.length})
            </Typography.Text>
            <Typography.Text
              type="secondary"
              style={{ fontSize: 12, marginLeft: 8 }}
            >
              选中图片会作为参考发送给 AI
            </Typography.Text>
          </div>
          <div
            style={{
              display: "flex",
              gap: 8,
              flexWrap: "wrap",
              alignItems: "center"
            }}
          >
            {allReferenceImages.map((ref, i) => (
              <div
                key={`ref-${ref.type}-${ref.idx}-${i}`}
                style={{
                  position: "relative",
                  width: 80,
                  height: 50,
                  borderRadius: 6,
                  overflow: "hidden",
                  border: "1px solid rgba(0,0,0,0.12)",
                  background: "#fff",
                  flexShrink: 0
                }}
              >
                <Image
                  src={ref.type === "url" ? ref.url : ref.dataUrl}
                  alt=""
                  style={{ width: "100%", height: "100%", objectFit: "cover" }}
                  preview={{ mask: "点击预览" }}
                />
                <div
                  title="移除"
                  onClick={(e) => {
                    e.stopPropagation();
                    e.preventDefault();
                    if (ref.type === "url") removeReferenceUrl(ref.idx);
                    else removeUploadedImage(ref.idx);
                  }}
                  style={{
                    position: "absolute",
                    top: 2,
                    right: 2,
                    width: 16,
                    height: 16,
                    borderRadius: 4,
                    background: "rgba(0,0,0,0.55)",
                    color: "#fff",
                    fontSize: 11,
                    display: "flex",
                    alignItems: "center",
                    justifyContent: "center",
                    cursor: "pointer",
                    userSelect: "none",
                    lineHeight: 1,
                    zIndex: 1
                  }}
                >
                  ×
                </div>
              </div>
            ))}
            <div
              onClick={() => fileInputRef.current?.click()}
              style={{
                width: 50,
                height: 50,
                borderRadius: 6,
                border: "1px dashed rgba(0,0,0,0.25)",
                display: "flex",
                alignItems: "center",
                justifyContent: "center",
                cursor: "pointer",
                color: "rgba(0,0,0,0.45)",
                fontSize: 20,
                flexShrink: 0
              }}
              title="上传参考图"
            >
              <PlusOutlined />
            </div>
            <input
              ref={fileInputRef}
              type="file"
              multiple
              accept="image/*"
              style={{ display: "none" }}
              onChange={handleFileUpload}
            />
          </div>
        </div>

        {/* Chat Messages Area */}
        <div
          style={{
            flex: 1,
            minHeight: 0,
            overflowY: "auto",
            padding: "16px",
            display: "flex",
            flexDirection: "column",
            gap: 12
          }}
        >
          {messages.length === 0 ? (
            <div
              style={{
                flex: 1,
                display: "flex",
                alignItems: "center",
                justifyContent: "center",
                color: "rgba(0,0,0,0.25)",
                fontSize: 14
              }}
            >
              输入提示词描述你想要的修改
            </div>
          ) : (
            messages.map((msg, idx) => (
              <div
                key={idx}
                style={{
                  display: "flex",
                  justifyContent:
                    msg.role === "user" ? "flex-end" : "flex-start"
                }}
              >
                {msg.role === "assistant" && msg.imageBase64 ? (
                  <Image
                    src={`data:${msg.imageMimeType || "image/png"};base64,${
                      msg.imageBase64
                    }`}
                    alt="generated"
                    style={{
                      maxWidth: "100%",
                      maxHeight: 300,
                      objectFit: "contain"
                    }}
                    preview={{ mask: "点击预览" }}
                  />
                ) : (
                  <div
                    style={{
                      maxWidth: "75%",
                      padding: "8px 14px",
                      borderRadius: 12,
                      background: msg.role === "user" ? "#1677ff" : "#f0f0f0",
                      color: msg.role === "user" ? "#fff" : "#333",
                      fontSize: 14,
                      lineHeight: 1.5,
                      wordBreak: "break-word"
                    }}
                  >
                    {msg.text ? <div>{msg.text}</div> : null}
                  </div>
                )}
              </div>
            ))
          )}
          {generating ? (
            <div style={{ display: "flex", justifyContent: "flex-start" }}>
              <div
                style={{
                  padding: "12px 18px",
                  borderRadius: 12,
                  background: "#f0f0f0",
                  display: "flex",
                  alignItems: "center",
                  gap: 8
                }}
              >
                <Spin size="small" />
                <span style={{ color: "rgba(0,0,0,0.45)", fontSize: 13 }}>
                  AI 正在生成...
                </span>
              </div>
            </div>
          ) : null}
          <div ref={chatEndRef} />
        </div>

        {/* Result Actions */}
        {lastResult ? (
          <div
            style={{
              padding: "10px 16px",
              borderTop: "1px solid rgba(0,0,0,0.06)",
              background: "#fafafa",
              display: "flex",
              gap: 10,
              alignItems: "center"
            }}
          >
            <Typography.Text type="secondary" style={{ fontSize: 13 }}>
              对生成结果：
            </Typography.Text>
            <Button
              size="small"
              type="primary"
              danger
              onClick={() => handleSave("override")}
              loading={saving}
              disabled={!initialImages[0]?.url}
            >
              覆盖原图
            </Button>
            <Button
              size="small"
              type="primary"
              onClick={() => handleSave("new")}
              loading={saving}
            >
              保存为新图
            </Button>
          </div>
        ) : null}

        {/* Input Area */}
        <div
          style={{
            padding: "12px 16px",
            borderTop: "1px solid rgba(0,0,0,0.06)",
            display: "flex",
            gap: 10,
            alignItems: "flex-end"
          }}
        >
          <Input.TextArea
            value={prompt}
            onChange={(e) => setPrompt(e.target.value)}
            placeholder="描述你想要的修改..."
            autoSize={{ minRows: 1, maxRows: 4 }}
            style={{ flex: 1 }}
            onPressEnter={(e) => {
              if (e.shiftKey) return;
              e.preventDefault();
              handleSend();
            }}
            disabled={generating}
          />
          <Button
            type="primary"
            icon={<SendOutlined />}
            onClick={handleSend}
            loading={generating}
            disabled={!prompt.trim() || generating}
          >
            发送
          </Button>
        </div>
      </div>
    </Modal>
  );
}
