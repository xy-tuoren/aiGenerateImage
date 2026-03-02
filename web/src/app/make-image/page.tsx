"use client";

import { useState, useRef, useEffect } from "react";
import {
  Input,
  Button,
  Avatar,
  Spin,
  Image as AntImage,
  Typography,
  Space,
  Upload,
  message,
  Tooltip
} from "antd";
import {
  SendOutlined,
  UserOutlined,
  RobotOutlined,
  PlusOutlined,
  CloseCircleFilled,
  PictureOutlined,
  LoadingOutlined,
  MenuFoldOutlined,
  MenuUnfoldOutlined,
  UpOutlined,
  DownOutlined,
  ReloadOutlined,
  DownloadOutlined,
  PlusSquareOutlined
} from "@ant-design/icons";
import AdminShell from "@/app/_components/AdminShell";
import NextImage from "next/image";

type PendingImage = {
  url: string; // Object URL for preview
  file: File;
  base64: string;
  mimeType: string;
};

type Message = {
  id: string;
  role: "user" | "assistant";
  content?: string;
  thoughtProcess?: string;
  imageBase64?: string;
  imageMimeType?: string;
  referenceImages?: PendingImage[];
  loading?: boolean;
};

type ConversationItem = {
  id: string;
  title: string;
  lastMessage?: string;
  createdAt?: string;
  updatedAt?: string;
};

function buildWelcomeMessage(): Message {
  return {
    id: "welcome",
    role: "assistant",
    content:
      "你好！我是基于 Gemini 的图像生成助手。你可以输入提示词让我生成图片，或者上传参考图并告诉我如何修改它。"
  };
}

export default function MakeImagePage() {
  const [messages, setMessages] = useState<Message[]>([buildWelcomeMessage()]);
  const [inputValue, setInputValue] = useState("");
  const [pendingImages, setPendingImages] = useState<PendingImage[]>([]);
  const [isGenerating, setIsGenerating] = useState(false);
  const [enableImageSettings, setEnableImageSettings] = useState(false);
  const [aspectRatio, setAspectRatio] = useState<string | undefined>(undefined);
  const [imageSize, setImageSize] = useState<string | undefined>(undefined);
  const [thinkingLevel, setThinkingLevel] = useState<"high" | "minimal">(
    "high"
  );
  const [temperature, setTemperature] = useState<0.5 | 1 | 1.5 | 2>(1);
  const [conversationItems, setConversationItems] = useState<
    ConversationItem[]
  >([]);
  const [conversationListLoading, setConversationListLoading] = useState(false);
  const [conversationLoading, setConversationLoading] = useState(false);
  const [conversationListCollapsed, setConversationListCollapsed] =
    useState(false);
  const [currentConversationId, setCurrentConversationId] = useState<
    string | null
  >(null);
  const [expandedThoughtMap, setExpandedThoughtMap] = useState<
    Record<string, boolean>
  >({});
  const messagesEndRef = useRef<HTMLDivElement>(null);

  const scrollToBottom = () => {
    messagesEndRef.current?.scrollIntoView({ behavior: "smooth" });
  };

  useEffect(() => {
    scrollToBottom();
  }, [messages, pendingImages]);

  const refreshConversationList = async (preferConversationId?: string) => {
    setConversationListLoading(true);
    try {
      const res = await fetch("/api/image-edit/chat", {
        method: "GET",
        cache: "no-store"
      });
      const data = await res.json();
      if (!res.ok || !data?.ok) {
        throw new Error(data?.error || "加载会话列表失败");
      }
      const items = Array.isArray(data.items) ? data.items : [];
      setConversationItems(items);
      if (preferConversationId) {
        setCurrentConversationId(preferConversationId);
      } else if (!currentConversationId && items.length > 0) {
        await openConversation(items[0].id);
      }
    } catch (e: any) {
      message.error(e?.message || "加载会话列表失败");
    } finally {
      setConversationListLoading(false);
    }
  };

  const openConversation = async (conversationId: string) => {
    if (!conversationId) return;
    setConversationLoading(true);
    try {
      const res = await fetch(
        `/api/image-edit/chat?conversationId=${encodeURIComponent(
          conversationId
        )}`,
        {
          method: "GET",
          cache: "no-store"
        }
      );
      const data = await res.json();
      if (!res.ok || !data?.ok) {
        throw new Error(data?.error || "加载会话失败");
      }
      const apiMessages = Array.isArray(data.messages) ? data.messages : [];
      const mappedMessages: Message[] = apiMessages.map(
        (m: any, i: number) => ({
          id: String(m.id || `${conversationId}-${i}`),
          role: m.role === "user" ? "user" : "assistant",
          content: String(m.text || ""),
          thoughtProcess: String(m.thoughtProcess || ""),
          imageBase64: m.imageBase64 ? String(m.imageBase64) : undefined,
          imageMimeType: m.imageMimeType ? String(m.imageMimeType) : undefined
        })
      );
      setMessages(
        mappedMessages.length > 0 ? mappedMessages : [buildWelcomeMessage()]
      );
      setCurrentConversationId(conversationId);
      setInputValue("");
      setPendingImages([]);
      setExpandedThoughtMap({});
    } catch (e: any) {
      message.error(e?.message || "加载会话失败");
    } finally {
      setConversationLoading(false);
    }
  };

  useEffect(() => {
    refreshConversationList();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const fileToPendingImage = (file: File): Promise<PendingImage> =>
    new Promise((resolve, reject) => {
      const reader = new FileReader();
      reader.onload = (e) => {
        const base64Data = String(e.target?.result || "");
        resolve({
          url: URL.createObjectURL(file),
          file,
          base64: base64Data,
          mimeType: file.type || "image/png"
        });
      };
      reader.onerror = () => reject(new Error("读取图片失败"));
      reader.readAsDataURL(file);
    });

  const handleUpload = (file: File) => {
    fileToPendingImage(file)
      .then((img) => {
        setPendingImages((prev) => [...prev, img]);
      })
      .catch(() => {
        message.error("读取图片失败");
      });
    return false; // Prevent default upload behavior
  };

  const removePendingImage = (index: number) => {
    setPendingImages((prev) => {
      const newImgs = [...prev];
      URL.revokeObjectURL(newImgs[index].url);
      newImgs.splice(index, 1);
      return newImgs;
    });
  };

  const sendMessage = async (
    prompt: string,
    referenceImages: PendingImage[]
  ) => {
    if (
      (!prompt.trim() && referenceImages.length === 0) ||
      isGenerating ||
      conversationLoading
    )
      return;

    const userMessage: Message = {
      id: Date.now().toString(),
      role: "user",
      content: prompt,
      referenceImages: [...referenceImages]
    };

    const assistantMessageId = (Date.now() + 1).toString();
    const assistantMessage: Message = {
      id: assistantMessageId,
      role: "assistant",
      content: "正在思考与生成中...",
      thoughtProcess: "",
      loading: true
    };

    setMessages((prev) => [...prev, userMessage, assistantMessage]);
    setInputValue("");
    setPendingImages([]);
    setIsGenerating(true);

    try {
      // Build history
      const history = messages
        .filter((m) => !m.loading && m.id !== "welcome")
        .map((m) => ({
          role: m.role,
          text: m.content,
          imageBase64: m.imageBase64,
          imageMimeType: m.imageMimeType
        }));

      // Add current user message to history, wait, we don't need to add it to history,
      // the endpoint takes `prompt` and `referenceImageInline` directly for the current turn.
      const referenceImageInline = userMessage.referenceImages?.map((img) => {
        // Remove 'data:image/png;base64,' prefix
        const base64Clean = img.base64.split(",")[1] || img.base64;
        return {
          data: base64Clean,
          mimeType: img.mimeType
        };
      });

      const res = await fetch("/api/image-edit/chat", {
        method: "POST",
        headers: {
          "Content-Type": "application/json"
        },
        body: JSON.stringify({
          prompt: userMessage.content || "请参考图片进行处理", // Provide fallback if no text
          referenceImageInline,
          history,
          thinkingLevel,
          temperature,
          stream: true,
          ...(enableImageSettings && aspectRatio ? { aspectRatio } : {}),
          ...(enableImageSettings && imageSize ? { imageSize } : {}),
          conversationId: currentConversationId || undefined
        })
      });
      const contentType = String(res.headers.get("content-type") || "");

      if (contentType.includes("application/x-ndjson") && res.body) {
        const reader = res.body.getReader();
        const decoder = new TextDecoder();
        let buffer = "";
        let doneEvent: any = null;

        while (true) {
          const { value, done } = await reader.read();
          if (done) break;
          buffer += decoder.decode(value, { stream: true });
          const lines = buffer.split("\n");
          buffer = lines.pop() || "";

          for (const line of lines) {
            const trimmed = line.trim();
            if (!trimmed) continue;
            const evt = JSON.parse(trimmed);
            if (evt?.type === "thought") {
              const delta = String(evt.text || "");
              if (!delta) continue;
              setMessages((prev) =>
                prev.map((msg) =>
                  msg.id === assistantMessageId
                    ? {
                        ...msg,
                        content: "正在思考与生成中...",
                        thoughtProcess: `${msg.thoughtProcess || ""}${delta}`
                      }
                    : msg
                )
              );
            } else if (evt?.type === "done") {
              doneEvent = evt;
            } else if (evt?.type === "error") {
              throw new Error(String(evt.error || "生成失败"));
            }
          }
        }

        if (!doneEvent) {
          throw new Error("流式生成中断，请重试");
        }

        setMessages((prev) =>
          prev.map((msg) =>
            msg.id === assistantMessageId
              ? {
                  ...msg,
                  loading: false,
                  content: "",
                  thoughtProcess:
                    String(doneEvent.thoughtProcess || "").trim() ||
                    msg.thoughtProcess ||
                    "",
                  imageBase64: doneEvent.imageBase64,
                  imageMimeType: doneEvent.mimeType || "image/jpeg"
                }
              : msg
          )
        );
        if (doneEvent.conversationId) {
          setCurrentConversationId(String(doneEvent.conversationId));
        }
        await refreshConversationList(
          doneEvent.conversationId
            ? String(doneEvent.conversationId)
            : undefined
        );
      } else {
        const data = await res.json();

        if (!res.ok || !data.ok) {
          throw new Error(data.error || "请求失败");
        }

        setMessages((prev) =>
          prev.map((msg) =>
            msg.id === assistantMessageId
              ? {
                  ...msg,
                  loading: false,
                  content: "",
                  thoughtProcess: String(data.thoughtProcess || ""),
                  imageBase64: data.imageBase64,
                  imageMimeType: data.mimeType || "image/jpeg"
                }
              : msg
          )
        );
        if (data.conversationId) {
          setCurrentConversationId(String(data.conversationId));
        }
        await refreshConversationList(
          data.conversationId ? String(data.conversationId) : undefined
        );
      }
    } catch (error: any) {
      message.error(error.message || "生成图片时发生错误");
      setMessages((prev) =>
        prev.map((msg) =>
          msg.id === assistantMessageId
            ? {
                ...msg,
                loading: false,
                content: "抱歉，生成失败：" + (error.message || "未知错误")
              }
            : msg
        )
      );
    } finally {
      setIsGenerating(false);
    }
  };

  const handleSend = async () => {
    await sendMessage(inputValue, pendingImages);
  };

  const handleRegenerate = async (assistantMessageId: string) => {
    const assistantIndex = messages.findIndex(
      (msg) => msg.id === assistantMessageId
    );
    if (assistantIndex <= 0) {
      message.warning("未找到可重新生成的提示词");
      return;
    }
    let sourceUserMessage: Message | undefined;
    for (let i = assistantIndex - 1; i >= 0; i -= 1) {
      if (messages[i].role === "user") {
        sourceUserMessage = messages[i];
        break;
      }
    }
    if (!sourceUserMessage) {
      message.warning("未找到可重新生成的提示词");
      return;
    }
    const prompt = sourceUserMessage.content || "";
    const referenceImages = sourceUserMessage.referenceImages || [];
    if (!prompt.trim() && referenceImages.length === 0) {
      message.warning("当前消息缺少可重新生成的内容");
      return;
    }
    setInputValue(prompt);
    setPendingImages(referenceImages);
    await sendMessage(prompt, referenceImages);
  };

  const handleDownload = (msg: Message) => {
    if (!msg.imageBase64) return;
    const mimeType = msg.imageMimeType || "image/jpeg";
    const ext = mimeType.includes("png")
      ? "png"
      : mimeType.includes("webp")
      ? "webp"
      : "jpg";
    const link = document.createElement("a");
    link.href = `data:${mimeType};base64,${msg.imageBase64}`;
    link.download = `generated-${Date.now()}.${ext}`;
    document.body.appendChild(link);
    link.click();
    document.body.removeChild(link);
  };

  const startNewConversation = () => {
    setCurrentConversationId(null);
    setMessages([buildWelcomeMessage()]);
    setInputValue("");
    setPendingImages([]);
    setExpandedThoughtMap({});
  };

  return (
    <AdminShell
      defaultSelectedKey="/make-image"
      headerTitle="制作图片 - 对话式生成"
    >
      <div
        style={{
          display: "flex",
          flexDirection: "row",
          height: "calc(100vh - 120px)",
          width: "100%",
          backgroundColor: "#fff",
          borderRadius: 16,
          boxShadow: "0 4px 12px rgba(0,0,0,0.05)"
        }}
      >
        <div
          style={{
            width: conversationListCollapsed ? 56 : 280,
            borderRight: "1px solid #eef1f5",
            padding: 12,
            display: "flex",
            flexDirection: "column",
            gap: 10,
            transition: "width 0.2s ease"
          }}
        >
          <div
            style={{
              display: "flex",
              alignItems: "center",
              justifyContent: conversationListCollapsed
                ? "center"
                : "space-between"
            }}
          >
            {conversationListCollapsed ? null : (
              <Button type="primary" block onClick={startNewConversation}>
                新建对话
              </Button>
            )}
            <div style={{ display: "flex", alignItems: "center", gap: 4 }}>
              <Button
                type="text"
                shape="circle"
                icon={
                  conversationListCollapsed ? (
                    <MenuUnfoldOutlined />
                  ) : (
                    <MenuFoldOutlined />
                  )
                }
                onClick={() => setConversationListCollapsed((prev) => !prev)}
                aria-label={
                  conversationListCollapsed ? "展开会话列表" : "收起会话列表"
                }
                style={{ fontSize: 20, width: 36, height: 36 }}
              />
            </div>
          </div>
          {conversationListCollapsed ? (
            <div style={{ display: "flex", justifyContent: "center" }}>
              <Tooltip title="新增对话">
                <Button
                  type="text"
                  shape="circle"
                  icon={<PlusSquareOutlined />}
                  onClick={startNewConversation}
                  disabled={isGenerating || conversationLoading}
                  aria-label="新增对话"
                  style={{ width: 36, height: 36, fontSize: 20 }}
                />
              </Tooltip>
            </div>
          ) : null}
          {conversationListCollapsed ? null : (
            <div
              className="make-image-conversation-scroll"
              style={{ flex: 1, overflowY: "auto", paddingRight: 4 }}
            >
              {conversationItems.map((item) => (
                <div
                  key={item.id}
                  style={{
                    padding: "10px 12px",
                    borderRadius: 10,
                    cursor: "pointer",
                    marginBottom: 8,
                    background:
                      currentConversationId === item.id ? "#e6f4ff" : "#f5f7fa",
                    border:
                      currentConversationId === item.id
                        ? "1px solid #91caff"
                        : "1px solid transparent"
                  }}
                  onClick={() => openConversation(item.id)}
                >
                  <div
                    style={{
                      fontSize: 14,
                      fontWeight: 600,
                      overflow: "hidden",
                      textOverflow: "ellipsis",
                      whiteSpace: "nowrap",
                      marginBottom: 4
                    }}
                  >
                    {item.title || "新对话"}
                  </div>
                  <Typography.Text
                    type="secondary"
                    style={{
                      fontSize: 12,
                      display: "block",
                      overflow: "hidden",
                      textOverflow: "ellipsis",
                      whiteSpace: "nowrap"
                    }}
                  >
                    {item.lastMessage || "暂无消息"}
                  </Typography.Text>
                </div>
              ))}
              {conversationListLoading ? (
                <div style={{ paddingTop: 20, textAlign: "center" }}>
                  <Spin size="small" />
                </div>
              ) : null}
            </div>
          )}
        </div>

        <div style={{ flex: 1, display: "flex", flexDirection: "column" }}>
          {/* 对话消息展示区 */}
          <div
            className="make-image-scroll-area"
            style={{ flex: 1, overflowY: "auto", padding: "24px 32px" }}
          >
            {conversationLoading ? (
              <div style={{ paddingTop: 60, textAlign: "center" }}>
                <Spin />
              </div>
            ) : (
              messages.map((msg, msgIndex) => {
                const isLastGeneratedImage =
                  Boolean(msg.imageBase64) &&
                  !messages
                    .slice(msgIndex + 1)
                    .some((nextMsg) => nextMsg.imageBase64);
                const thoughtExpanded = expandedThoughtMap[msg.id] ?? false;
                const showThoughtPanel =
                  msg.role === "assistant" &&
                  msg.id !== "welcome" &&
                  (msg.loading ||
                    Boolean(msg.imageBase64) ||
                    Boolean(msg.thoughtProcess));
                return (
                  <div
                    key={msg.id}
                    style={{
                      display: "flex",
                      flexDirection:
                        msg.role === "user" ? "row-reverse" : "row",
                      marginBottom: 32,
                      gap: 16
                    }}
                  >
                    <Avatar
                      icon={
                        msg.role === "user" ? (
                          <UserOutlined />
                        ) : (
                          <RobotOutlined />
                        )
                      }
                      style={{
                        backgroundColor:
                          msg.role === "user" ? "#1677ff" : "#52c41a",
                        flexShrink: 0,
                        marginTop: 4
                      }}
                      size="large"
                    />
                    <div
                      style={{
                        maxWidth: "75%",
                        display: "flex",
                        flexDirection: "column",
                        alignItems:
                          msg.role === "user" ? "flex-end" : "flex-start"
                      }}
                    >
                      {/* User Reference Images */}
                      {msg.referenceImages &&
                        msg.referenceImages.length > 0 && (
                          <div
                            style={{
                              display: "flex",
                              gap: 8,
                              marginBottom: 8,
                              flexWrap: "wrap",
                              justifyContent: "flex-end"
                            }}
                          >
                            {msg.referenceImages.map((img, idx) => (
                              <AntImage
                                key={idx}
                                src={img.url}
                                width={100}
                                height={100}
                                style={{ borderRadius: 8, objectFit: "cover" }}
                                preview={{
                                  cover: (
                                    <>
                                      <PictureOutlined /> 预览
                                    </>
                                  )
                                }}
                              />
                            ))}
                          </div>
                        )}

                      <div
                        style={{
                          backgroundColor:
                            msg.role === "user" ? "#e6f4ff" : "#f5f5f5",
                          padding: "12px 16px",
                          borderRadius: 16,
                          borderTopRightRadius: msg.role === "user" ? 4 : 16,
                          borderTopLeftRadius:
                            msg.role === "assistant" ? 4 : 16,
                          fontSize: 15,
                          lineHeight: 1.6,
                          color: "#1f1f1f"
                        }}
                      >
                        {msg.loading ? (
                          <>
                            <Space size="middle">
                              <Spin
                                indicator={
                                  <LoadingOutlined
                                    style={{ fontSize: 24 }}
                                    spin
                                  />
                                }
                              />
                              <Typography.Text type="secondary">
                                {msg.content}
                              </Typography.Text>
                            </Space>
                          </>
                        ) : (
                          <>
                            {msg.content && (
                              <div
                                style={{
                                  whiteSpace: "pre-wrap",
                                  marginBottom: msg.imageBase64 ? 12 : 0
                                }}
                              >
                                {msg.content}
                              </div>
                            )}
                            {msg.imageBase64 && (
                              <div style={{ marginTop: 8 }}>
                                <AntImage
                                  src={`data:${msg.imageMimeType};base64,${msg.imageBase64}`}
                                  width={420}
                                  style={{
                                    borderRadius: 8,
                                    objectFit: "contain",
                                    maxWidth: "100%",
                                    maxHeight: 420
                                  }}
                                  preview={{
                                    cover: (
                                      <>
                                        <PictureOutlined /> 查看大图
                                      </>
                                    )
                                  }}
                                />
                                <div
                                  style={{
                                    marginTop: 8,
                                    display: "flex",
                                    gap: 6,
                                    justifyContent: "flex-end"
                                  }}
                                >
                                  {showThoughtPanel ? (
                                    <Tooltip
                                      title={
                                        thoughtExpanded
                                          ? "收起思考过程"
                                          : "展开思考过程"
                                      }
                                    >
                                      <Button
                                        type="text"
                                        shape="circle"
                                        size="small"
                                        icon={
                                          thoughtExpanded ? (
                                            <UpOutlined />
                                          ) : (
                                            <DownOutlined />
                                          )
                                        }
                                        onClick={() =>
                                          setExpandedThoughtMap((prev) => ({
                                            ...prev,
                                            [msg.id]: !thoughtExpanded
                                          }))
                                        }
                                        disabled={!msg.thoughtProcess}
                                      />
                                    </Tooltip>
                                  ) : null}
                                  {isLastGeneratedImage ? (
                                    <Tooltip title="重新生成">
                                      <Button
                                        type="text"
                                        shape="circle"
                                        size="small"
                                        icon={<ReloadOutlined />}
                                        onClick={() => handleRegenerate(msg.id)}
                                        disabled={
                                          isGenerating || conversationLoading
                                        }
                                      />
                                    </Tooltip>
                                  ) : null}
                                  <Tooltip title="下载">
                                    <Button
                                      type="text"
                                      shape="circle"
                                      size="small"
                                      icon={<DownloadOutlined />}
                                      onClick={() => handleDownload(msg)}
                                    />
                                  </Tooltip>
                                </div>
                                {showThoughtPanel &&
                                msg.thoughtProcess &&
                                thoughtExpanded ? (
                                  <div
                                    style={{
                                      marginTop: 6,
                                      background: "#fff",
                                      borderRadius: 10,
                                      border: "1px solid #d9d9d9",
                                      padding: "8px",
                                      fontSize: 13,
                                      lineHeight: 1.55,
                                      color: "#595959",
                                      whiteSpace: "pre-wrap",
                                      maxHeight: 180,
                                      overflowY: "auto"
                                    }}
                                  >
                                    {msg.thoughtProcess}
                                  </div>
                                ) : null}
                              </div>
                            )}
                          </>
                        )}
                      </div>
                    </div>
                  </div>
                );
              })
            )}
            <div ref={messagesEndRef} />
          </div>

          {/* 底部悬浮输入区，仿 Gemini */}
          <div style={{ padding: "0 24px 24px" }}>
            <div
              style={{
                backgroundColor: "#f0f4f9",
                borderRadius: 24,
                padding: "12px 16px",
                display: "flex",
                flexDirection: "column",
                boxShadow: "0 2px 6px rgba(0,0,0,0.02)"
              }}
            >
              {/* 上传图片预览 */}
              {pendingImages.length > 0 && (
                <div
                  style={{
                    display: "flex",
                    gap: 12,
                    marginBottom: 12,
                    paddingLeft: 8
                  }}
                >
                  {pendingImages.map((img, idx) => (
                    <div
                      key={idx}
                      style={{ position: "relative", display: "inline-block" }}
                    >
                      <NextImage
                        src={img.url}
                        alt="upload preview"
                        width={64}
                        height={64}
                        unoptimized
                        style={{
                          objectFit: "cover",
                          borderRadius: 8,
                          border: "1px solid #d9d9d9"
                        }}
                      />
                      <CloseCircleFilled
                        onClick={() => removePendingImage(idx)}
                        style={{
                          position: "absolute",
                          top: -6,
                          right: -6,
                          fontSize: 18,
                          color: "#ff4d4f",
                          cursor: "pointer",
                          background: "#fff",
                          borderRadius: "50%"
                        }}
                      />
                    </div>
                  ))}
                </div>
              )}

              <div style={{ display: "flex", alignItems: "flex-end", gap: 8 }}>
                <Tooltip title="上传参考图">
                  <Upload
                    beforeUpload={handleUpload}
                    showUploadList={false}
                    accept="image/*"
                    disabled={isGenerating || conversationLoading}
                  >
                    <Button
                      type="text"
                      shape="circle"
                      icon={<PlusOutlined style={{ fontSize: 20 }} />}
                      size="large"
                      disabled={isGenerating || conversationLoading}
                    />
                  </Upload>
                </Tooltip>

                <Input.TextArea
                  value={inputValue}
                  onChange={(e) => setInputValue(e.target.value)}
                  onPaste={async (e) => {
                    const items = Array.from(e.clipboardData?.items || []);
                    const imageFiles = items
                      .filter(
                        (item) =>
                          item.kind === "file" && item.type.startsWith("image/")
                      )
                      .map((item) => item.getAsFile())
                      .filter((file): file is File => Boolean(file));
                    if (imageFiles.length === 0) return;
                    e.preventDefault();
                    try {
                      const pastedImages = await Promise.all(
                        imageFiles.map((file) => fileToPendingImage(file))
                      );
                      setPendingImages((prev) => [...prev, ...pastedImages]);
                    } catch {
                      message.error("粘贴图片失败");
                    }
                  }}
                  onPressEnter={(e) => {
                    if (!e.shiftKey) {
                      e.preventDefault();
                      handleSend();
                    }
                  }}
                  placeholder="给图片想个提示词，或者上传参考图并描述需求..."
                  autoSize={{ minRows: 1, maxRows: 6 }}
                  style={{
                    flex: 1,
                    border: "none",
                    boxShadow: "none",
                    backgroundColor: "transparent",
                    resize: "none",
                    fontSize: 16,
                    padding: "4px 8px"
                  }}
                  disabled={isGenerating || conversationLoading}
                />

                <Tooltip title="发送">
                  <Button
                    type="primary"
                    shape="circle"
                    icon={<SendOutlined />}
                    size="large"
                    onClick={handleSend}
                    loading={isGenerating}
                    disabled={
                      (!inputValue.trim() && pendingImages.length === 0) ||
                      conversationLoading
                    }
                    style={{ flexShrink: 0, marginBottom: 2 }}
                  />
                </Tooltip>
              </div>

              <div
                style={{
                  display: "flex",
                  flexDirection: "column",
                  gap: 10,
                  marginTop: 10,
                  padding: "2px 8px 0"
                }}
              >
                <div
                  style={{
                    display: "flex",
                    alignItems: "center",
                    justifyContent: "flex-start",
                    gap: 8
                  }}
                >
                  <Button
                    type="text"
                    shape="circle"
                    size="small"
                    icon={
                      enableImageSettings ? <UpOutlined /> : <DownOutlined />
                    }
                    onClick={() => setEnableImageSettings((prev) => !prev)}
                    disabled={isGenerating || conversationLoading}
                    aria-label={
                      enableImageSettings ? "收起尺寸设置" : "展开尺寸设置"
                    }
                  />
                  <Typography.Text style={{ fontSize: 13, color: "#595959" }}>
                    尺寸与分辨率设置
                  </Typography.Text>
                </div>
                {enableImageSettings ? (
                  <>
                    <div>
                      <Typography.Text
                        style={{
                          display: "block",
                          fontSize: 12,
                          color: "#8c8c8c",
                          marginBottom: 6
                        }}
                      >
                        思考等级
                      </Typography.Text>
                      <div
                        style={{ display: "flex", flexWrap: "wrap", gap: 6 }}
                      >
                        {["high", "minimal"].map((level) => {
                          const selected = thinkingLevel === level;
                          return (
                            <Button
                              key={level}
                              size="small"
                              type={selected ? "primary" : "default"}
                              onClick={() =>
                                setThinkingLevel(level as "high" | "minimal")
                              }
                              disabled={isGenerating || conversationLoading}
                              style={{ minWidth: 64 }}
                            >
                              {level}
                            </Button>
                          );
                        })}
                      </div>
                    </div>
                    <div>
                      <Typography.Text
                        style={{
                          display: "block",
                          fontSize: 12,
                          color: "#8c8c8c",
                          marginBottom: 6
                        }}
                      >
                        温度随机值
                      </Typography.Text>
                      <div
                        style={{ display: "flex", flexWrap: "wrap", gap: 6 }}
                      >
                        {[
                          { label: "默认", value: 1 },
                          { label: "低", value: 0.5 },
                          { label: "高", value: 1.5 },
                          { label: "最高", value: 2 }
                        ].map((opt) => {
                          const selected = temperature === opt.value;
                          return (
                            <Button
                              key={opt.label}
                              size="small"
                              type={selected ? "primary" : "default"}
                              onClick={() =>
                                setTemperature(opt.value as 0.5 | 1 | 1.5 | 2)
                              }
                              disabled={isGenerating || conversationLoading}
                              style={{ minWidth: 64 }}
                            >
                              {opt.label}
                            </Button>
                          );
                        })}
                      </div>
                    </div>
                    <div>
                      <Typography.Text
                        style={{
                          display: "block",
                          fontSize: 12,
                          color: "#8c8c8c",
                          marginBottom: 6
                        }}
                      >
                        选择比例
                      </Typography.Text>
                      <div
                        style={{ display: "flex", flexWrap: "wrap", gap: 6 }}
                      >
                        {[
                          "智能",
                          "1:1",
                          "1:4",
                          "1:8",
                          "2:3",
                          "3:2",
                          "3:4",
                          "4:1",
                          "4:3",
                          "4:5",
                          "5:4",
                          "8:1",
                          "9:16",
                          "16:9",
                          "21:9"
                        ].map((ratio) => {
                          const selected =
                            (ratio === "智能" && !aspectRatio) ||
                            (ratio !== "智能" && aspectRatio === ratio);
                          return (
                            <Button
                              key={ratio}
                              size="small"
                              type={selected ? "primary" : "default"}
                              onClick={() =>
                                setAspectRatio(
                                  ratio === "智能"
                                    ? undefined
                                    : selected
                                    ? undefined
                                    : ratio
                                )
                              }
                              disabled={isGenerating || conversationLoading}
                              style={{ minWidth: 54 }}
                            >
                              {ratio}
                            </Button>
                          );
                        })}
                      </div>
                    </div>
                    <div>
                      <Typography.Text
                        style={{
                          display: "block",
                          fontSize: 12,
                          color: "#8c8c8c",
                          marginBottom: 6
                        }}
                      >
                        分辨率
                      </Typography.Text>
                      <div
                        style={{ display: "flex", flexWrap: "wrap", gap: 6 }}
                      >
                        {["默认", "512px", "1K", "2K", "4K"].map((size) => {
                          const selected =
                            (size === "默认" && !imageSize) ||
                            (size !== "默认" && imageSize === size);
                          return (
                            <Button
                              key={size}
                              size="small"
                              type={selected ? "primary" : "default"}
                              onClick={() =>
                                setImageSize(size === "默认" ? undefined : size)
                              }
                              disabled={isGenerating || conversationLoading}
                              style={{ minWidth: 64 }}
                            >
                              {size}
                            </Button>
                          );
                        })}
                      </div>
                    </div>
                  </>
                ) : null}
              </div>
            </div>
          </div>
        </div>
      </div>
      <style jsx>{`
        .make-image-scroll-area {
          scrollbar-width: thin;
          scrollbar-color: #c8d0da transparent;
        }
        .make-image-scroll-area::-webkit-scrollbar {
          width: 7px;
        }
        .make-image-scroll-area::-webkit-scrollbar-track {
          background: transparent;
        }
        .make-image-scroll-area::-webkit-scrollbar-thumb {
          background: #c8d0da;
          border-radius: 999px;
          border: 2px solid transparent;
          background-clip: content-box;
        }
        .make-image-scroll-area::-webkit-scrollbar-thumb:hover {
          background: #aeb8c5;
          background-clip: content-box;
        }
        .make-image-conversation-scroll {
          scrollbar-width: thin;
          scrollbar-color: #d0d7e2 transparent;
        }
        .make-image-conversation-scroll::-webkit-scrollbar {
          width: 6px;
        }
        .make-image-conversation-scroll::-webkit-scrollbar-track {
          background: transparent;
        }
        .make-image-conversation-scroll::-webkit-scrollbar-thumb {
          background: #d0d7e2;
          border-radius: 999px;
        }
      `}</style>
    </AdminShell>
  );
}
