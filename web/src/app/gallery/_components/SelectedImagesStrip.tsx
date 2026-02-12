"use client";

import { Button, Image, Space, Typography } from "antd";

import type { GridImage } from "../_lib/types";

export function SelectedImagesStrip(props: {
  selectedPreviewImages: GridImage[];
  selectedPreviewConfig: any;
  onOpenPreviewAt: (idx: number) => void;
  onRemove: (key: string) => void;

  selectedCount: number;
  onClear: () => void;
  disableClear: boolean;
}) {
  const {
    selectedPreviewImages,
    selectedPreviewConfig,
    onOpenPreviewAt,
    onRemove,
    selectedCount,
    onClear,
    disableClear,
  } = props;

  if (!selectedCount) return null;

  return (
    <div
      style={{
        padding: 10,
        background: "#f5f5f5",
        borderRadius: 10,
        border: "1px solid rgba(0,0,0,0.06)",
      }}
    >
      <Space wrap size={10} align="center" style={{ width: "100%" }}>
        <Typography.Text strong>当前已选（{selectedCount}）</Typography.Text>
        <Typography.Text type="secondary">
          右键可选/取消，预览里按 C 也可选
        </Typography.Text>
        <Button size="small" onClick={onClear} disabled={disableClear}>
          清空已选
        </Button>
        <div style={{ flex: "1 1 100%" }} />
        <Image.PreviewGroup preview={selectedPreviewConfig}>
          <Space wrap size={8}>
            {selectedPreviewImages.map((img, i) => (
              <div
                key={`sel|${img.key}`}
                style={{
                  position: "relative",
                  width: 92,
                  height: 52,
                  borderRadius: 8,
                  overflow: "hidden",
                  border: "1px solid rgba(0,0,0,0.12)",
                  background: "#fff",
                  cursor: "pointer",
                }}
                onClick={() => onOpenPreviewAt(i)}
              >
                <Image
                  width={92}
                  height={52}
                  style={{ width: 92, height: 52, objectFit: "cover" }}
                  src={img.url}
                  alt={img.url}
                  loading="lazy"
                  decoding="async"
                />
                <div
                  title="移除"
                  onClick={(e) => {
                    e.stopPropagation();
                    onRemove(img.key);
                  }}
                  style={{
                    position: "absolute",
                    top: 4,
                    right: 4,
                    width: 18,
                    height: 18,
                    borderRadius: 6,
                    background: "rgba(0,0,0,0.55)",
                    color: "#fff",
                    fontSize: 12,
                    display: "flex",
                    alignItems: "center",
                    justifyContent: "center",
                    cursor: "pointer",
                    userSelect: "none",
                  }}
                >
                  ×
                </div>
              </div>
            ))}
          </Space>
        </Image.PreviewGroup>
      </Space>
    </div>
  );
}

