"use client";

import {
  Button,
  Image as AntImage,
  Input,
  Tooltip,
  Typography,
  Upload,
  message
} from "antd";
import {
  CloseCircleFilled,
  DownOutlined,
  PlusOutlined,
  SendOutlined,
  UpOutlined
} from "@ant-design/icons";
import type { PendingImage } from "../_lib/types";

type ComposerPanelProps = {
  pendingImages: PendingImage[];
  removePendingImage: (index: number) => void;
  handleUpload: (file: File) => boolean;
  inputValue: string;
  setInputValue: (value: string) => void;
  handleSend: () => void;
  onPasteImageFiles: (files: File[]) => Promise<void>;
  onDropImageUrls: (urls: string[]) => Promise<void>;
  isGenerating: boolean;
  conversationLoading: boolean;
  enableImageSettings: boolean;
  setEnableImageSettings: (updater: (prev: boolean) => boolean) => void;
  outputCount: number;
  setOutputCount: (value: number) => void;
  thinkingLevel: "high" | "minimal";
  setThinkingLevel: (value: "high" | "minimal") => void;
  temperature: 0.5 | 1 | 1.5 | 2;
  setTemperature: (value: 0.5 | 1 | 1.5 | 2) => void;
  aspectRatio?: string;
  setAspectRatio: (value: string | undefined) => void;
  imageSize?: string;
  setImageSize: (value: string | undefined) => void;
};

export function ComposerPanel({
  pendingImages,
  removePendingImage,
  handleUpload,
  inputValue,
  setInputValue,
  handleSend,
  onPasteImageFiles,
  onDropImageUrls,
  isGenerating,
  conversationLoading,
  enableImageSettings,
  setEnableImageSettings,
  outputCount,
  setOutputCount,
  thinkingLevel,
  setThinkingLevel,
  temperature,
  setTemperature,
  aspectRatio,
  setAspectRatio,
  imageSize,
  setImageSize
}: ComposerPanelProps) {
  const extractUrlsFromDataTransfer = (dt: DataTransfer): string[] => {
    const out: string[] = [];
    const custom = dt.getData("application/x-make-image-ref");
    if (custom) {
      try {
        const parsed = JSON.parse(custom);
        const list = Array.isArray(parsed) ? parsed : [parsed];
        for (const item of list) {
          const url = String(item?.url || item || "").trim();
          if (url) out.push(url);
        }
      } catch {
        const url = String(custom || "").trim();
        if (url) out.push(url);
      }
    }
    const uriList = String(dt.getData("text/uri-list") || "").trim();
    if (uriList) {
      for (const line of uriList.split("\n")) {
        const s = line.trim();
        if (!s || s.startsWith("#")) continue;
        out.push(s);
      }
    }
    const plain = String(dt.getData("text/plain") || "").trim();
    if (plain) out.push(plain);
    return Array.from(new Set(out));
  };

  return (
    <div
      style={{ padding: "0 24px 24px" }}
      onDragOver={(e) => {
        if (isGenerating || conversationLoading) return;
        e.preventDefault();
        e.dataTransfer.dropEffect = "copy";
      }}
      onDrop={async (e) => {
        if (isGenerating || conversationLoading) return;
        e.preventDefault();
        try {
          const files = Array.from(e.dataTransfer?.files || []).filter((f) =>
            String(f?.type || "").startsWith("image/")
          );
          if (files.length > 0) {
            for (const f of files) handleUpload(f);
            return;
          }
          const urls = extractUrlsFromDataTransfer(e.dataTransfer);
          if (urls.length > 0) await onDropImageUrls(urls);
        } catch {
          message.error("拖拽图片失败");
        }
      }}
    >
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
        {pendingImages.length > 0 && (
          <div
            style={{
              display: "flex",
              gap: 12,
              marginBottom: 12,
              paddingLeft: 8
            }}
          >
            <AntImage.PreviewGroup>
              {pendingImages.map((img, idx) => (
                <div
                  key={idx}
                  style={{
                    position: "relative",
                    display: "inline-block"
                  }}
                >
                  <AntImage
                    src={img.url}
                    alt="upload preview"
                    width={92}
                    height={92}
                    style={{
                      objectFit: "cover",
                      borderRadius: 8,
                      border: "1px solid #d9d9d9"
                    }}
                  />
                  <CloseCircleFilled
                    onClick={(e) => {
                      e.stopPropagation();
                      removePendingImage(idx);
                    }}
                    style={{
                      position: "absolute",
                      top: -6,
                      right: -6,
                      fontSize: 18,
                      color: "#ff4d4f",
                      cursor: "pointer",
                      background: "#fff",
                      borderRadius: "50%",
                      zIndex: 1
                    }}
                  />
                </div>
              ))}
            </AntImage.PreviewGroup>
          </div>
        )}

        <div style={{ display: "flex", alignItems: "flex-end", gap: 8 }}>
          <Tooltip title="上传参考图">
            <Upload
              beforeUpload={handleUpload}
              showUploadList={false}
              multiple
              accept="image/*"
              disabled={isGenerating || conversationLoading}
            >
              <Button
                type="default"
                shape="circle"
                icon={
                  <PlusOutlined
                    style={{
                      fontSize: 18,
                      lineHeight: 1,
                      transform: "translateX(0.5px)"
                    }}
                  />
                }
                size="large"
                disabled={isGenerating || conversationLoading}
                style={{
                  width: 42,
                  height: 42,
                  padding: 0,
                  display: "inline-flex",
                  alignItems: "center",
                  justifyContent: "center",
                  border: "1px solid #d9e2ef",
                  background: "#ffffff",
                  color: "#1677ff",
                  boxShadow: "0 1px 4px rgba(15, 23, 42, 0.08)"
                }}
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
                await onPasteImageFiles(imageFiles);
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
              icon={<SendOutlined style={{ fontSize: 18 }} />}
              size="large"
              onClick={handleSend}
              loading={isGenerating}
              disabled={
                (!inputValue.trim() && pendingImages.length === 0) ||
                conversationLoading
              }
              style={{
                flexShrink: 0,
                marginBottom: 2,
                width: 44,
                height: 44,
                boxShadow: "0 4px 12px rgba(22, 119, 255, 0.28)"
              }}
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
              icon={enableImageSettings ? <UpOutlined /> : <DownOutlined />}
              onClick={() => setEnableImageSettings((prev) => !prev)}
              disabled={isGenerating || conversationLoading}
              aria-label={enableImageSettings ? "收起尺寸设置" : "展开尺寸设置"}
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
                  输出数量
                </Typography.Text>
                <div style={{ display: "flex", flexWrap: "wrap", gap: 6 }}>
                  {[1, 2, 3, 4].map((count) => {
                    const selected = outputCount === count;
                    return (
                      <Button
                        key={count}
                        size="small"
                        type={selected ? "primary" : "default"}
                        onClick={() => setOutputCount(count)}
                        disabled={isGenerating || conversationLoading}
                        style={{ minWidth: 52 }}
                      >
                        {count} 张
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
                  思考等级
                </Typography.Text>
                <div style={{ display: "flex", flexWrap: "wrap", gap: 6 }}>
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
                <div style={{ display: "flex", flexWrap: "wrap", gap: 6 }}>
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
                <div style={{ display: "flex", flexWrap: "wrap", gap: 6 }}>
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
                <div style={{ display: "flex", flexWrap: "wrap", gap: 6 }}>
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
  );
}
