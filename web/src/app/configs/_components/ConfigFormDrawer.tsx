"use client";

import React from "react";
import {
  AutoComplete,
  Button,
  Drawer,
  Dropdown,
  Form,
  Input,
  InputNumber,
  Select,
  Space
} from "antd";
import {
  FileImageOutlined,
  FolderOutlined,
  UploadOutlined
} from "@ant-design/icons";
import type { FormInstance } from "antd/es/form";
import {
  BATCH_FUN_OPTIONS,
  RESPONSE_MODALITIES_OPTIONS,
  SUPPORTED_LANGUAGES
} from "@/common/constants";
import { MODEL_PROVIDER_OPTIONS, THINKING_LEVEL_OPTIONS } from "../_lib/utils";

type ConfigFormDrawerProps = {
  editingId: string | null;
  open: boolean;
  submitting: boolean;
  form: FormInstance;
  appNameOptions: { label: string; value: string }[];
  promptTmpFunNameOptions: { label: string; value: string }[];
  uploadingReferenceImages: boolean;
  watchedModelProvider: "gemini" | "jimeng";
  refFolderInput: React.RefObject<HTMLInputElement | null>;
  refFilesInput: React.RefObject<HTMLInputElement | null>;
  onClose: () => void;
  onSubmit: () => void;
  uploadReferenceFiles: (files: File[]) => void;
};

export function ConfigFormDrawer({
  editingId,
  open,
  submitting,
  form,
  appNameOptions,
  promptTmpFunNameOptions,
  uploadingReferenceImages,
  watchedModelProvider,
  refFolderInput,
  refFilesInput,
  onClose,
  onSubmit,
  uploadReferenceFiles
}: ConfigFormDrawerProps) {
  return (
    <Drawer
      title={editingId ? "编辑生图配置" : "新增生图配置"}
      open={open}
      onClose={onClose}
      size={720}
      extra={
        <Space>
          <Button onClick={onClose}>取消</Button>
          <Button type="primary" loading={submitting} onClick={onSubmit}>
            保存
          </Button>
        </Space>
      }
    >
      <Form form={form} layout="vertical">
        <Form.Item name="modelProvider" label="生图模型">
          <Select options={MODEL_PROVIDER_OPTIONS} />
        </Form.Item>
        <Form.Item name="appName" label="appName">
          <AutoComplete
            options={appNameOptions}
            allowClear
            placeholder="请选择或输入 appName"
            showSearch={{
              filterOption: (inputValue, option) =>
                String(option?.value || "")
                  .toLowerCase()
                  .includes(String(inputValue || "").toLowerCase())
            }}
          />
        </Form.Item>
        <Form.Item name="description" label="description">
          <Input allowClear placeholder="请输入该配置的描述" />
        </Form.Item>
        <Form.Item name="langs" label="lang">
          <Select
            mode="tags"
            options={SUPPORTED_LANGUAGES.map((lang) => ({
              label: lang,
              value: lang
            }))}
            allowClear
            placeholder="请选择或输入语言代码（可多选）"
            showSearch
          />
        </Form.Item>
        <Form.Item name="batchFun" label="batchFun">
          <AutoComplete
            options={BATCH_FUN_OPTIONS}
            allowClear
            placeholder="请选择或输入 batchFun"
            showSearch={{
              filterOption: (inputValue, option) =>
                String(option?.value || "")
                  .toLowerCase()
                  .includes(String(inputValue || "").toLowerCase())
            }}
          />
        </Form.Item>
        <Form.Item name="promptTmpFunName" label="promptTmpFunName">
          <AutoComplete
            options={promptTmpFunNameOptions}
            allowClear
            placeholder="请选择或输入 prompt 函数"
            showSearch={{
              filterOption: (inputValue, option) =>
                String(option?.value || "")
                  .toLowerCase()
                  .includes(String(inputValue || "").toLowerCase())
            }}
          />
        </Form.Item>
        <Form.Item name="count" label="count">
          <InputNumber min={0} style={{ width: "100%" }} />
        </Form.Item>
        <Form.Item name="prompt" label="prompt">
          <Input.TextArea rows={5} placeholder="描述要生成的图片" />
        </Form.Item>

        <Form.Item
          name="referenceImagesText"
          label={
            <Space>
              <span>referenceImages（每行一个路径/URL）</span>
              <Dropdown
                menu={{
                  items: [
                    {
                      key: "folder",
                      icon: <FolderOutlined />,
                      label: "选择文件夹",
                      onClick: () => refFolderInput.current?.click()
                    },
                    {
                      key: "files",
                      icon: <FileImageOutlined />,
                      label: "选择多张图片",
                      onClick: () => refFilesInput.current?.click()
                    }
                  ]
                }}
              >
                <Button
                  size="small"
                  icon={<UploadOutlined />}
                  loading={uploadingReferenceImages}
                >
                  上传
                </Button>
              </Dropdown>
              <input
                ref={refFolderInput}
                type="file"
                multiple
                {...({ webkitdirectory: "", directory: "" } as any)}
                accept="image/*"
                style={{ display: "none" }}
                onChange={(e) => {
                  const files = e.target.files
                    ? Array.from(e.target.files)
                    : [];
                  uploadReferenceFiles(files);
                }}
              />
              <input
                ref={refFilesInput}
                type="file"
                multiple
                accept="image/*"
                style={{ display: "none" }}
                onChange={(e) => {
                  const files = e.target.files
                    ? Array.from(e.target.files)
                    : [];
                  uploadReferenceFiles(files);
                }}
              />
            </Space>
          }
        >
          <Input.TextArea
            rows={4}
            placeholder="public/material/...\nhttps://..."
          />
        </Form.Item>

        {watchedModelProvider === "gemini" ? (
          <>
            <Form.Item
              name="generationConfig_temperature"
              label="generationConfig.temperature"
            >
              <InputNumber step={0.1} style={{ width: "100%" }} />
            </Form.Item>

            <Form.Item
              name="imageConfig_width"
              label="imageConfig.width"
              extra="输入目标输出宽度；服务端将自动匹配 Gemini 支持的比例与 1K/2K/4K 分辨率"
            >
              <InputNumber min={1} precision={0} style={{ width: "100%" }} />
            </Form.Item>
            <Form.Item
              name="imageConfig_height"
              label="imageConfig.height"
              extra="输入目标输出高度；最终会按阈值规则进行拉伸或等比缩放"
            >
              <InputNumber min={1} precision={0} style={{ width: "100%" }} />
            </Form.Item>
            <Form.Item
              name="imageConfig_matchedAspectRatio"
              label="system.matchedAspectRatio"
              extra="系统根据输入宽高自动匹配的 Gemini 支持比例（只读）"
            >
              <Input readOnly placeholder="请输入 width / height" />
            </Form.Item>
            <Form.Item
              name="imageConfig_matchedResolution"
              label="system.matchedResolution"
              extra="系统根据输入宽高自动匹配的 Gemini 分辨率档位（只读）"
            >
              <Input readOnly placeholder="请输入 width / height" />
            </Form.Item>

            <Form.Item name="responseModalities" label="responseModalities">
              <Select mode="tags" options={RESPONSE_MODALITIES_OPTIONS} />
            </Form.Item>
          </>
        ) : (
          <>
            <Form.Item
              name="imageConfig_width"
              label="imageConfig.width"
              extra="即梦模式下自定义输出宽度"
            >
              <InputNumber min={1} precision={0} style={{ width: "100%" }} />
            </Form.Item>
            <Form.Item
              name="imageConfig_height"
              label="imageConfig.height"
              extra="即梦模式下自定义输出高度"
            >
              <InputNumber min={1} precision={0} style={{ width: "100%" }} />
            </Form.Item>
            <Form.Item
              name="imageConfig_aspectRatio"
              label="imageConfig.aspectRatio"
              extra="根据宽高自动计算"
            >
              <Input readOnly />
            </Form.Item>
            <Form.Item
              name="imageConfig_minRatio"
              label="imageConfig.minRatio"
              extra="根据宽高自动填充"
            >
              <InputNumber disabled style={{ width: "100%" }} />
            </Form.Item>
            <Form.Item
              name="imageConfig_maxRatio"
              label="imageConfig.maxRatio"
              extra="根据宽高自动填充"
            >
              <InputNumber disabled style={{ width: "100%" }} />
            </Form.Item>
          </>
        )}
        <Form.Item
          name="generationConfig_thinkingLevel"
          label="思考等级（thinkingLevel）"
        >
          <Select options={THINKING_LEVEL_OPTIONS} />
        </Form.Item>
      </Form>
    </Drawer>
  );
}
