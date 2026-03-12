"use client";

import { useState } from "react";
import {
  Avatar,
  Button,
  Image as AntImage,
  Space,
  Spin,
  Tooltip,
  Typography
} from "antd";
import {
  AppstoreAddOutlined,
  DownloadOutlined,
  LoadingOutlined,
  PictureOutlined,
  ReloadOutlined,
  UserOutlined,
  RobotOutlined
} from "@ant-design/icons";
import type { Message } from "../_lib/types";

type MessagePanelProps = {
  conversationLoading: boolean;
  messages: Message[];
  editTarget: { messageId: string; indices: number[] } | null;
  onToggleEditTarget: (messageId: string, index: number) => void;
  isGenerating: boolean;
  onRegenerate: (assistantMessageId: string) => Promise<void>;
  onDownload: (msg: Message, indices?: number[]) => void;
  onOpenGallerySaveModal: (messageId: string, indices?: number[]) => void;
  conversationGeneratedImageIndexByMessageId: Map<string, number>;
  setConversationPreviewCurrent: (value: number) => void;
  setConversationPreviewVisible: (value: boolean) => void;
  messagesEndRef: React.RefObject<HTMLDivElement | null>;
};

export function MessagePanel({
  conversationLoading,
  messages,
  editTarget,
  onToggleEditTarget,
  isGenerating,
  onRegenerate,
  onDownload,
  onOpenGallerySaveModal,
  conversationGeneratedImageIndexByMessageId,
  setConversationPreviewCurrent,
  setConversationPreviewVisible,
  messagesEndRef
}: MessagePanelProps) {
  const [hoveredGenMessageId, setHoveredGenMessageId] = useState<string | null>(
    null
  );

  return (
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
          const getImageSrc = (img: {
            imageBase64?: string;
            imageUrl?: string;
            imageMimeType?: string;
          }) => {
            const b64 = String(img.imageBase64 || "").trim();
            if (b64)
              return `data:${img.imageMimeType || "image/jpeg"};base64,${b64}`;
            return String(img.imageUrl || "").trim();
          };
          const generatedImages =
            msg.generatedImages && msg.generatedImages.length > 0
              ? msg.generatedImages
              : msg.imageBase64
              ? [
                  {
                    imageBase64: msg.imageBase64,
                    imageMimeType: msg.imageMimeType || "image/jpeg"
                  }
                ]
              : msg.imageUrl
              ? [
                  {
                    imageUrl: msg.imageUrl,
                    imageMimeType: msg.imageMimeType || "image/jpeg"
                  }
                ]
              : [];
          const hasGeneratedImages = generatedImages.length > 0;
          const isFailedAssistantMessage =
            msg.role === "assistant" &&
            !msg.loading &&
            !hasGeneratedImages &&
            /生成失败/.test(String(msg.content || ""));
          const isLastGeneratedImage =
            hasGeneratedImages &&
            !messages
              .slice(msgIndex + 1)
              .some(
                (nextMsg) =>
                  Boolean(nextMsg.imageBase64) ||
                  Boolean(nextMsg.generatedImages?.length)
              );
          const selectedIndicesForThisMsg =
            editTarget?.messageId === msg.id && editTarget.indices.length
              ? editTarget.indices
              : undefined;

          return (
            <div
              key={msg.id}
              style={{
                display: "flex",
                flexDirection: msg.role === "user" ? "row-reverse" : "row",
                marginBottom: 32,
                gap: 16
              }}
            >
              <Avatar
                icon={
                  msg.role === "user" ? <UserOutlined /> : <RobotOutlined />
                }
                style={{
                  backgroundColor: msg.role === "user" ? "#1677ff" : "#52c41a",
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
                  alignItems: msg.role === "user" ? "flex-end" : "flex-start"
                }}
              >
                {msg.referenceImages && msg.referenceImages.length > 0 && (
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
                      <div
                        key={idx}
                        draggable
                        onDragStart={(e) => {
                          try {
                            e.dataTransfer.effectAllowed = "copy";
                            e.dataTransfer.setData(
                              "application/x-make-image-ref",
                              JSON.stringify({ url: img.url })
                            );
                            e.dataTransfer.setData("text/uri-list", img.url);
                            e.dataTransfer.setData("text/plain", img.url);
                          } catch {}
                        }}
                        style={{ display: "inline-flex" }}
                        title="拖到输入框作为参考图"
                      >
                        <AntImage
                          src={img.url}
                          width={132}
                          height={132}
                          style={{ borderRadius: 8, objectFit: "cover" }}
                          preview={{
                            cover: (
                              <>
                                <PictureOutlined /> 预览
                              </>
                            )
                          }}
                        />
                      </div>
                    ))}
                  </div>
                )}

                <div
                  style={{
                    display: "flex",
                    flexDirection: "row",
                    alignItems: "center",
                    gap: 8,
                    justifyContent:
                      msg.role === "user" ? "flex-end" : "flex-start"
                  }}
                >
                  <div
                    style={{
                      backgroundColor:
                        msg.role === "user"
                          ? "#e6f4ff"
                          : hasGeneratedImages
                          ? "transparent"
                          : "#f5f5f5",
                      padding: "12px 16px",
                      borderRadius: 16,
                      borderTopRightRadius: msg.role === "user" ? 4 : 16,
                      borderTopLeftRadius: msg.role === "assistant" ? 4 : 16,
                      fontSize: 15,
                      lineHeight: 1.6,
                      color: "#1f1f1f"
                    }}
                  >
                    {msg.loading ? (
                      <Space
                        size="middle"
                        style={{ marginBottom: hasGeneratedImages ? 12 : 0 }}
                      >
                        <Spin
                          indicator={
                            <LoadingOutlined style={{ fontSize: 24 }} spin />
                          }
                        />
                        <Typography.Text type="secondary">
                          {msg.content}
                        </Typography.Text>
                      </Space>
                    ) : null}
                    {!msg.loading && msg.content ? (
                      <div
                        style={{
                          whiteSpace: "pre-wrap",
                          marginBottom: hasGeneratedImages ? 12 : 0
                        }}
                      >
                        {msg.content}
                      </div>
                    ) : null}
                    {hasGeneratedImages && (
                      <div
                        style={{
                          position: "relative",
                          marginTop: 8,
                          marginLeft: -16,
                          marginRight: -16,
                          marginBottom: -12,
                          overflow: "hidden",
                          padding: 5,
                          lineHeight: 0,
                          borderRadius:
                            msg.role === "assistant"
                              ? "0 0 16px 16px"
                              : undefined
                        }}
                        onMouseEnter={() => setHoveredGenMessageId(msg.id)}
                        onMouseLeave={() => setHoveredGenMessageId(null)}
                      >
                        <div
                          style={{
                            display: "flex",
                            flexWrap: "wrap",
                            gap: 5
                          }}
                        >
                          {generatedImages.map((img, idx) => (
                            <div
                              key={`${msg.id}-${idx}`}
                              draggable
                              onDragStart={(e) => {
                                try {
                                  const dataUrl = getImageSrc(img);
                                  if (!dataUrl) return;
                                  e.dataTransfer.effectAllowed = "copy";
                                  e.dataTransfer.setData(
                                    "application/x-make-image-ref",
                                    JSON.stringify({ url: dataUrl })
                                  );
                                  e.dataTransfer.setData(
                                    "text/uri-list",
                                    dataUrl
                                  );
                                  e.dataTransfer.setData("text/plain", dataUrl);
                                } catch {}
                              }}
                              onContextMenu={(e) => {
                                e.preventDefault();
                                e.stopPropagation();
                                onToggleEditTarget(msg.id, idx);
                              }}
                              style={{
                                position: "relative",
                                width: 360,
                                height: 240,
                                boxSizing: "border-box",
                                overflow: "hidden",
                                borderRadius: 8,
                                background:
                                  editTarget?.messageId === msg.id &&
                                  editTarget.indices.includes(idx)
                                    ? "rgba(22,119,255,0.18)"
                                    : "transparent",
                                boxShadow:
                                  editTarget?.messageId === msg.id &&
                                  editTarget.indices.includes(idx)
                                    ? "inset 0 0 0 2px #1677ff"
                                    : "none"
                              }}
                              title="右键选中：后续修改只作用于选中图片"
                            >
                              <AntImage
                                src={getImageSrc(img)}
                                width={360}
                                height={240}
                                style={{
                                  borderRadius: 6,
                                  objectFit: "cover",
                                  maxWidth: "100%",
                                  cursor: "pointer",
                                  display: "block"
                                }}
                                preview={false}
                                onClick={() => {
                                  const messageStartIndex =
                                    conversationGeneratedImageIndexByMessageId.get(
                                      msg.id
                                    ) ?? 0;
                                  setConversationPreviewCurrent(
                                    messageStartIndex + idx
                                  );
                                  setConversationPreviewVisible(true);
                                }}
                              />
                              {editTarget?.messageId === msg.id &&
                              editTarget.indices.includes(idx) ? (
                                <div
                                  style={{
                                    position: "absolute",
                                    top: 6,
                                    left: 6,
                                    padding: "2px 6px",
                                    borderRadius: 999,
                                    background: "rgba(22,119,255,0.9)",
                                    color: "#fff",
                                    fontSize: 12,
                                    fontWeight: 600,
                                    lineHeight: 1
                                  }}
                                >
                                  已选
                                </div>
                              ) : null}
                              {idx === generatedImages.length - 1 ? (
                                <div
                                  style={{
                                    position: "absolute",
                                    right: 5,
                                    bottom: 5,
                                    display: "inline-flex",
                                    gap: 6,
                                    alignItems: "center",
                                    padding: "4px 6px",
                                    borderRadius: 8,
                                    background: "rgba(0,0,0,0.5)",
                                    opacity:
                                      hoveredGenMessageId === msg.id ? 1 : 0,
                                    pointerEvents:
                                      hoveredGenMessageId === msg.id
                                        ? "auto"
                                        : "none",
                                    transition: "opacity 0.2s"
                                  }}
                                  onClick={(e) => e.stopPropagation()}
                                >
                                  {isLastGeneratedImage ? (
                                    <Tooltip title="重新生成">
                                      <Button
                                        type="text"
                                        shape="circle"
                                        size="small"
                                        icon={<ReloadOutlined />}
                                        onClick={() => onRegenerate(msg.id)}
                                        disabled={
                                          isGenerating || conversationLoading
                                        }
                                        style={{ color: "#fff" }}
                                      />
                                    </Tooltip>
                                  ) : null}
                                  <Tooltip title="下载">
                                    <Button
                                      type="text"
                                      shape="circle"
                                      size="small"
                                      icon={<DownloadOutlined />}
                                      onClick={() =>
                                        onDownload(
                                          msg,
                                          selectedIndicesForThisMsg
                                        )
                                      }
                                      style={{ color: "#fff" }}
                                    />
                                  </Tooltip>
                                  <Tooltip title="入库图片广场">
                                    <Button
                                      type="text"
                                      shape="circle"
                                      size="small"
                                      icon={<AppstoreAddOutlined />}
                                      onClick={() =>
                                        onOpenGallerySaveModal(
                                          msg.id,
                                          selectedIndicesForThisMsg
                                        )
                                      }
                                      disabled={!hasGeneratedImages}
                                      style={{ color: "#fff" }}
                                    />
                                  </Tooltip>
                                </div>
                              ) : null}
                            </div>
                          ))}
                        </div>
                      </div>
                    )}
                  </div>
                  {isFailedAssistantMessage ? (
                    <Tooltip title="重试生成">
                      <Button
                        type="text"
                        shape="circle"
                        size="small"
                        icon={<ReloadOutlined />}
                        onClick={() => onRegenerate(msg.id)}
                        disabled={isGenerating || conversationLoading}
                        style={{
                          background: "rgba(0,0,0,0.68)",
                          color: "#fff",
                          border: "none"
                        }}
                      />
                    </Tooltip>
                  ) : null}
                </div>
              </div>
            </div>
          );
        })
      )}
      <div ref={messagesEndRef} />
    </div>
  );
}
