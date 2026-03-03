"use client";

import { Button, Modal, Spin, Tooltip, Typography } from "antd";
import {
  DeleteOutlined,
  MenuFoldOutlined,
  MenuUnfoldOutlined,
  PlusSquareOutlined
} from "@ant-design/icons";
import type { ConversationItem } from "../_lib/types";

type ConversationSidebarProps = {
  conversationListCollapsed: boolean;
  setConversationListCollapsed: React.Dispatch<React.SetStateAction<boolean>>;
  conversationItems: ConversationItem[];
  currentConversationId: string | null;
  openConversation: (conversationId: string) => Promise<void>;
  deleteConversation: (conversationId: string) => Promise<void>;
  startNewConversation: () => void;
  conversationListLoading: boolean;
  isGenerating: boolean;
  conversationLoading: boolean;
};

export function ConversationSidebar({
  conversationListCollapsed,
  setConversationListCollapsed,
  conversationItems,
  currentConversationId,
  openConversation,
  deleteConversation,
  startNewConversation,
  conversationListLoading,
  isGenerating,
  conversationLoading
}: ConversationSidebarProps) {
  return (
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
          justifyContent: conversationListCollapsed ? "center" : "space-between"
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
              <div style={{ display: "flex", alignItems: "center", gap: 8 }}>
                <div
                  style={{
                    fontSize: 14,
                    fontWeight: 600,
                    overflow: "hidden",
                    textOverflow: "ellipsis",
                    whiteSpace: "nowrap",
                    marginBottom: 4,
                    flex: 1,
                    minWidth: 0
                  }}
                >
                  {item.title || "新对话"}
                </div>
                <Tooltip title="删除会话">
                  <Button
                    type="text"
                    size="small"
                    danger
                    icon={<DeleteOutlined />}
                    disabled={
                      conversationListLoading ||
                      isGenerating ||
                      conversationLoading
                    }
                    onClick={(e) => {
                      e.preventDefault();
                      e.stopPropagation();
                      Modal.confirm({
                        title: "确认删除该会话？",
                        content: "删除后不可恢复（会话消息也会一并删除）",
                        okText: "删除",
                        okType: "danger",
                        cancelText: "取消",
                        onOk: () => {
                          // 后台执行：不阻塞 UI
                          void deleteConversation(item.id);
                        }
                      });
                    }}
                  />
                </Tooltip>
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
  );
}
