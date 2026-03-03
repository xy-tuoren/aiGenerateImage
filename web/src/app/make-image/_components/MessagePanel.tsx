"use client";

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
              : [];
          const hasGeneratedImages = generatedImages.length > 0;
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
                    borderTopLeftRadius: msg.role === "assistant" ? 4 : 16,
                    fontSize: 15,
                    lineHeight: 1.6,
                    color: "#1f1f1f"
                  }}
                >
                  {msg.loading ? (
                    <Space size="middle">
                      <Spin
                        indicator={
                          <LoadingOutlined style={{ fontSize: 24 }} spin />
                        }
                      />
                      <Typography.Text type="secondary">
                        {msg.content}
                      </Typography.Text>
                    </Space>
                  ) : (
                    <>
                      {msg.content && (
                        <div
                          style={{
                            whiteSpace: "pre-wrap",
                            marginBottom: hasGeneratedImages ? 12 : 0
                          }}
                        >
                          {msg.content}
                        </div>
                      )}
                      {hasGeneratedImages && (
                        <div style={{ marginTop: 8 }}>
                          <div
                            style={{
                              display: "flex",
                              gap: 10,
                              flexWrap: "wrap"
                            }}
                          >
                            {generatedImages.map((img, idx) => (
                              <div
                                key={`${msg.id}-${idx}`}
                                onContextMenu={(e) => {
                                  e.preventDefault();
                                  e.stopPropagation();
                                  onToggleEditTarget(msg.id, idx);
                                }}
                                style={{
                                  position: "relative",
                                  borderRadius: 10,
                                  padding: 3,
                                  background:
                                    editTarget?.messageId === msg.id &&
                                    editTarget.indices.includes(idx)
                                      ? "rgba(22,119,255,0.18)"
                                      : "transparent",
                                  border:
                                    editTarget?.messageId === msg.id &&
                                    editTarget.indices.includes(idx)
                                      ? "2px solid #1677ff"
                                      : "2px solid transparent"
                                }}
                                title="右键选中：后续修改只作用于选中图片"
                              >
                                <AntImage
                                  src={`data:${img.imageMimeType};base64,${img.imageBase64}`}
                                  width={240}
                                  height={160}
                                  style={{
                                    borderRadius: 8,
                                    objectFit: "cover",
                                    maxWidth: "100%",
                                    cursor: "pointer"
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
                              </div>
                            ))}
                          </div>
                          <div
                            style={{
                              marginTop: 8,
                              display: "flex",
                              gap: 6,
                              justifyContent: "flex-end"
                            }}
                          >
                            {isLastGeneratedImage ? (
                              <Tooltip title="重新生成">
                                <Button
                                  type="text"
                                  shape="circle"
                                  size="small"
                                  icon={<ReloadOutlined />}
                                  onClick={() => onRegenerate(msg.id)}
                                  disabled={isGenerating || conversationLoading}
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
                                  onDownload(msg, selectedIndicesForThisMsg)
                                }
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
                              />
                            </Tooltip>
                          </div>
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
  );
}
