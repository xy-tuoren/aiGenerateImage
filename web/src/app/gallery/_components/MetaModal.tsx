"use client";

import { Image, Modal, Space, Typography } from "antd";

import { getCostFromImageUrl } from "../_lib/utils";
import type { GridImage } from "../_lib/types";

export function MetaModal(props: {
  open: boolean;
  img: GridImage | null;
  onClose: () => void;
}) {
  const { open, img, onClose } = props;

  return (
    <Modal
      title="生成信息"
      open={open}
      destroyOnHidden
      footer={null}
      width={980}
      onCancel={onClose}
    >
      <Space orientation="vertical" size={12} style={{ width: "100%" }}>
        <div
          style={{
            display: "grid",
            gridTemplateColumns: "minmax(0, 1fr) minmax(0, 1fr)",
            gap: 12,
          }}
        >
          <div>
            <Typography.Text strong>图片</Typography.Text>
            <div style={{ marginTop: 8 }}>
              {img?.url ? (
                <Image
                  src={img.url}
                  alt={img.url}
                  width="100%"
                  style={{ width: "100%", borderRadius: 10 }}
                  preview={false}
                />
              ) : (
                <Typography.Text type="secondary">无</Typography.Text>
              )}
            </div>
          </div>

          <div>
            <Typography.Text strong>参考图</Typography.Text>
            <div style={{ marginTop: 8 }}>
              {img?.referenceImages?.length ? (
                <div
                  style={{
                    display: "grid",
                    gridTemplateColumns:
                      "repeat(auto-fill, minmax(220px, 1fr))",
                    gap: 12,
                    alignItems: "start",
                  }}
                >
                  {img.referenceImages.map((u, i) => {
                    const cost = getCostFromImageUrl(u);
                    return (
                      <div key={`${u}|${i}`} style={{ position: "relative" }}>
                        <Image
                          src={u}
                          alt={u}
                          width="100%"
                          style={{
                            width: "100%",
                            height: "auto",
                            maxHeight: 520,
                            objectFit: "contain",
                            borderRadius: 10,
                            border: "1px solid rgba(0,0,0,0.06)",
                            background: "#fff",
                          }}
                          preview={false}
                        />
                        {cost ? (
                          <div
                            style={{
                              position: "absolute",
                              top: 0,
                              right: 0,
                              zIndex: 20,
                              padding: "2px 4px",
                              borderBottomLeftRadius: 8,
                              background: "rgba(0,0,0,0.75)",
                              color: "#fff",
                              fontSize: 12,
                              fontWeight: 600,
                              textShadow:
                                "0 0 2px rgba(0,0,0,0.9), 0 1px 2px rgba(0,0,0,0.8)",
                              userSelect: "none",
                              pointerEvents: "none",
                            }}
                          >
                            {cost}
                          </div>
                        ) : null}
                      </div>
                    );
                  })}
                </div>
              ) : (
                <Typography.Text type="secondary">无</Typography.Text>
              )}
            </div>
          </div>
        </div>

        <div>
          <Typography.Text strong>提示词</Typography.Text>
          <Typography.Paragraph
            style={{ marginTop: 8, whiteSpace: "pre-wrap" }}
            copyable={img?.prompt ? { text: img.prompt } : false}
          >
            {img?.prompt ? img.prompt : <Typography.Text type="secondary">无</Typography.Text>}
          </Typography.Paragraph>
        </div>
      </Space>
    </Modal>
  );
}

