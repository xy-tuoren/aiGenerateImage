"use client";

import { AutoComplete, Modal, Typography } from "antd";
import { SUPPORTED_LANGUAGES } from "@/common/constants";

type GallerySaveModalProps = {
  open: boolean;
  saving: boolean;
  appName: string;
  lang: string;
  appNameOptions: Array<{ value: string; label: string }>;
  setAppName: (value: string) => void;
  setLang: (value: string) => void;
  onCancel: () => void;
  onOk: () => void;
};

export function GallerySaveModal({
  open,
  saving,
  appName,
  lang,
  appNameOptions,
  setAppName,
  setLang,
  onCancel,
  onOk
}: GallerySaveModalProps) {
  return (
    <Modal
      title="入库图片广场"
      open={open}
      centered
      onCancel={onCancel}
      onOk={onOk}
      okText="确认入库"
      cancelText="取消"
      confirmLoading={saving}
    >
      <div style={{ display: "flex", flexDirection: "column", gap: 12 }}>
        <div>
          <Typography.Text style={{ display: "block", marginBottom: 6 }}>
            appName
          </Typography.Text>
          <AutoComplete
            value={appName}
            options={appNameOptions}
            onChange={(v) => setAppName(String(v || ""))}
            placeholder="请选择或输入 appName"
            style={{ width: "100%" }}
            disabled={saving}
          />
        </div>
        <div>
          <Typography.Text style={{ display: "block", marginBottom: 6 }}>
            语言
          </Typography.Text>
          <AutoComplete
            value={lang}
            options={SUPPORTED_LANGUAGES.map((x) => ({ value: x }))}
            onChange={(v) => setLang(String(v || ""))}
            placeholder="请选择语言"
            style={{ width: "100%" }}
            disabled={saving}
          />
        </div>
      </div>
    </Modal>
  );
}
