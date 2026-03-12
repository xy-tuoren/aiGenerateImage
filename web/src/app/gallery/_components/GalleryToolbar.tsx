"use client";

import { ReloadOutlined } from "@ant-design/icons";
import {
  AutoComplete,
  Button,
  Dropdown,
  Input,
  Select,
  Space,
  Typography
} from "antd";
import type { RefObject } from "react";

import { SUPPORTED_LANGUAGES } from "@/common/constants";

export function GalleryToolbar(props: {
  appName: string;
  appNameOptions: Array<{ label: string; value: string }>;
  onAppNameChange: (v: string) => void;

  lang: string;
  onLangChange: (v: string) => void;

  aspectRatio: string;
  onAspectRatioChange: (v: string) => void;

  cutFilter: "cut" | "uncut";
  onCutFilterChange: (v: "cut" | "uncut") => void;

  downloadedFilter: "downloaded" | "undownloaded";
  onDownloadedFilterChange: (v: "downloaded" | "undownloaded") => void;

  loading: boolean;
  creatingCut: boolean;
  uploadingFireplay: boolean;
  downloadingZip: boolean;
  uploadingLongFolder: boolean;

  onRefresh: () => void;

  longFolderPickRef: RefObject<HTMLInputElement | null>;
  longImagePickRef: RefObject<HTMLInputElement | null>;
  onLongFolderPicked: (e: any) => void;
  onLongImagePicked: (e: any) => void;

  selectMode: boolean;
  selectedCount: number;
  filteredCount: number;
  dataTotalCount: number | null;

  onCreateCut: () => void;
  onOpenImageEdit: () => void;
  onUploadToFireplay: () => void;
  onDownloadSelected: () => void;
}) {
  const {
    appName,
    appNameOptions,
    onAppNameChange,
    lang,
    onLangChange,
    aspectRatio,
    onAspectRatioChange,
    cutFilter,
    onCutFilterChange,
    downloadedFilter,
    onDownloadedFilterChange,
    loading,
    creatingCut,
    uploadingFireplay,
    downloadingZip,
    uploadingLongFolder,
    onRefresh,
    longFolderPickRef,
    longImagePickRef,
    onLongFolderPicked,
    onLongImagePicked,
    selectMode,
    selectedCount,
    filteredCount,
    dataTotalCount,
    onCreateCut,
    onOpenImageEdit,
    onUploadToFireplay,
    onDownloadSelected
  } = props;

  const disableActions =
    loading ||
    creatingCut ||
    uploadingFireplay ||
    downloadingZip ||
    uploadingLongFolder;

  return (
    <Space wrap>
      <Typography.Text strong>筛选：</Typography.Text>
      <AutoComplete
        style={{ width: 260 }}
        value={appName}
        options={appNameOptions}
        onChange={(v) => onAppNameChange(String(v || ""))}
        showSearch={{
          filterOption: (inputValue, option) => {
            const v = String(option?.value ?? "");
            const l = String((option as any)?.label ?? "");
            const q = String(inputValue || "").toLowerCase();
            return v.toLowerCase().includes(q) || l.toLowerCase().includes(q);
          }
        }}
      >
        <Input allowClear placeholder="appName" />
      </AutoComplete>

      <AutoComplete
        style={{ width: 100 }}
        value={lang}
        options={SUPPORTED_LANGUAGES.map((x) => ({ value: x }))}
        onChange={(v) => onLangChange(String(v || ""))}
        showSearch={{
          filterOption: (inputValue, option) =>
            String(option?.value ?? "")
              .toLowerCase()
              .includes(String(inputValue || "").toLowerCase())
        }}
      >
        <Input allowClear placeholder="lang" />
      </AutoComplete>

      <Space.Compact size="small">
        <Input
          style={{ width: 100 }}
          placeholder="比例"
          value={aspectRatio}
          onChange={(e) => onAspectRatioChange(String(e.target.value || ""))}
        />
        <Button onClick={() => onAspectRatioChange("")}>清除</Button>
      </Space.Compact>

      <Select
        style={{ width: 100 }}
        placeholder="筛选"
        value={cutFilter}
        options={[
          { label: "已裁剪", value: "cut" },
          { label: "未裁剪", value: "uncut" }
        ]}
        onChange={(v) => onCutFilterChange((String(v || "") as any) || "uncut")}
        menuItemSelectedIcon={null as any}
      />

      <Select
        style={{ width: 100 }}
        placeholder="是否下载"
        value={downloadedFilter}
        options={[
          { label: "已下载", value: "downloaded" },
          { label: "未下载", value: "undownloaded" }
        ]}
        onChange={(v) =>
          onDownloadedFilterChange((String(v || "") as any) || "undownloaded")
        }
        menuItemSelectedIcon={null as any}
      />

      <Button icon={<ReloadOutlined />} onClick={onRefresh} loading={loading}>
        刷新
      </Button>

      <Dropdown
        trigger={["hover", "click"]}
        disabled={disableActions}
        menu={{
          items: [
            { key: "folder", label: "文件夹" },
            { key: "image", label: "图片" }
          ],
          onClick: ({ key }) => {
            if (key === "folder") longFolderPickRef.current?.click();
            if (key === "image") longImagePickRef.current?.click();
          }
        }}
      >
        <Button loading={uploadingLongFolder} disabled={disableActions}>
          上传长图
          <input
            ref={longFolderPickRef}
            type="file"
            multiple
            accept="image/*"
            style={{ display: "none" }}
            {...({ webkitdirectory: "true" } as any)}
            onChange={onLongFolderPicked}
          />
          <input
            ref={longImagePickRef}
            type="file"
            multiple
            accept="image/*"
            style={{ display: "none" }}
            onChange={onLongImagePicked}
          />
        </Button>
      </Dropdown>

      <Button
        type="primary"
        onClick={onCreateCut}
        loading={creatingCut}
        disabled={!selectMode || !selectedCount}
      >
        裁剪
      </Button>

      <Button
        type="primary"
        onClick={onOpenImageEdit}
        disabled={
          !selectMode ||
          !selectedCount ||
          loading ||
          creatingCut ||
          uploadingFireplay
        }
      >
        改图
      </Button>

      <Button
        onClick={onUploadToFireplay}
        disabled={!selectMode || !selectedCount || loading || creatingCut}
        loading={uploadingFireplay}
      >
        上传到Fireplay
      </Button>

      <Button
        onClick={onDownloadSelected}
        loading={downloadingZip}
        disabled={
          !selectMode ||
          !selectedCount ||
          loading ||
          creatingCut ||
          uploadingFireplay
        }
      >
        下载
      </Button>

      <Typography.Text type="secondary">
        {loading
          ? "加载中..."
          : dataTotalCount != null
          ? `共 ${dataTotalCount} 张，当前筛选 ${filteredCount} 张`
          : `共 ${filteredCount} 张`}
      </Typography.Text>

      {selectMode ? (
        <Typography.Text type="secondary">
          已选 {selectedCount} 张
        </Typography.Text>
      ) : null}
    </Space>
  );
}
