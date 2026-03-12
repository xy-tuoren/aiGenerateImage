"use client";

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { Space, message } from "antd";
import AdminShell from "@/app/_components/AdminShell";

import type { GridImage, HistoryItem } from "./_lib/types";
import { normalizeMaterialUrl } from "./_lib/utils";

import { ImageEditDialog } from "./_components/ImageEditDialog";
import { useUploadToFireplay } from "./_hooks/useUploadToFireplay";
import { useGalleryData } from "./_hooks/useGalleryData";
import { GalleryToolbar } from "./_components/GalleryToolbar";
import { SelectedImagesStrip } from "./_components/SelectedImagesStrip";
import { MetaModal } from "./_components/MetaModal";
import { GalleryGrid } from "./_components/GalleryGrid";
import { LoadMoreFooter } from "./_components/LoadMoreFooter";

export default function GalleryPage() {
  const [messageApi, contextHolder] = message.useMessage();
  const [uploadingLongFolder, setUploadingLongFolder] = useState(false);
  const [dropUploadActive, setDropUploadActive] = useState(false);
  const [cutUrls, setCutUrls] = useState<string[]>([]);
  const [downloadedUrls, setDownloadedUrls] = useState<string[]>([]);
  const [fireplayUploadedUrls, setFireplayUploadedUrls] = useState<string[]>(
    []
  );
  const [appNameOptions, setAppNameOptions] = useState<
    Array<{ label: string; value: string }>
  >([]);
  const [appName, setAppName] = useState<string>("");
  const [lang, setLang] = useState<string>("");
  const [aspectRatio, setAspectRatio] = useState<string>("16:9");
  const [cutFilter, setCutFilter] = useState<"cut" | "uncut">("uncut");
  const [downloadedFilter, setDownloadedFilter] = useState<
    "downloaded" | "undownloaded"
  >("undownloaded");
  const [selectMode, setSelectMode] = useState(false);
  const [selectedKeys, setSelectedKeys] = useState<string[]>([]);
  const [hiddenKeys, setHiddenKeys] = useState<string[]>([]);
  const [previewOpen, setPreviewOpen] = useState(false);
  const [previewIndex, setPreviewIndex] = useState(0);
  const [selectedPreviewOpen, setSelectedPreviewOpen] = useState(false);
  const [selectedPreviewIndex, setSelectedPreviewIndex] = useState(0);
  const [metaOpen, setMetaOpen] = useState(false);
  const [metaImg, setMetaImg] = useState<GridImage | null>(null);
  const [creatingCut, setCreatingCut] = useState(false);
  const [downloadingZip, setDownloadingZip] = useState(false);
  const gridWrapRef = useRef<HTMLDivElement | null>(null);
  const dropEnterCountRef = useRef(0);
  const longFolderPickRef = useRef<HTMLInputElement | null>(null);
  const longImagePickRef = useRef<HTMLInputElement | null>(null);
  const uploadingFireplayRef = useRef(false);
  const dragStateRef = useRef<{
    active: boolean;
    moved: boolean;
    startX: number;
    startY: number;
    curX: number;
    curY: number;
  }>({ active: false, moved: false, startX: 0, startY: 0, curX: 0, curY: 0 });
  const suppressClickRef = useRef(false);
  const dragRafRef = useRef<number | null>(null);
  const dragBoxRef = useRef<{
    active: boolean;
    x: number;
    y: number;
    w: number;
    h: number;
  }>({ active: false, x: 0, y: 0, w: 0, h: 0 });
  const [dragBox, setDragBox] = useState<{
    active: boolean;
    x: number;
    y: number;
    w: number;
    h: number;
  }>({ active: false, x: 0, y: 0, w: 0, h: 0 });
  const [imageEditOpen, setImageEditOpen] = useState(false);
  const batchLastJobIdKey = "batch:lastJobId";
  const batchRecentJobIdsKey = "batch:recentJobIds";

  const blurActiveElement = useCallback(() => {
    if (typeof document === "undefined") return;
    const el = document.activeElement as any;
    if (el && typeof el.blur === "function") el.blur();
  }, []);

  const paginationResetKey = `${appName}|${lang}|${aspectRatio}|${cutFilter}|${downloadedFilter}`;
  const onFlagsLoaded = useCallback(
    (flags: {
      cutUrls: string[];
      downloadedUrls: string[];
      fireplayUploadedUrls: string[];
    }) => {
      if (flags.cutUrls?.length) {
        setCutUrls((prev) =>
          Array.from(new Set([...(prev || []), ...(flags.cutUrls || [])]))
        );
      }
      if (flags.fireplayUploadedUrls?.length) {
        setFireplayUploadedUrls((prev) =>
          Array.from(
            new Set([...(prev || []), ...(flags.fireplayUploadedUrls || [])])
          )
        );
      }
      if (flags.downloadedUrls?.length) {
        setDownloadedUrls((prev) =>
          Array.from(
            new Set([...(prev || []), ...(flags.downloadedUrls || [])])
          )
        );
      }
    },
    []
  );

  const {
    setFilteredCount,
    items,
    loading,
    loadingMore,
    dataHasMore,
    dataTotalCount,
    fetchImages,
    galleryPage,
    galleryPageSize,
    hasMore,
    loadMoreSentinelRef
  } = useGalleryData({
    messageApi,
    appName,
    lang,
    paginationResetKey,
    onReplace: () => {
      setPreviewOpen(false);
      setSelectedPreviewOpen(false);
    },
    onFlagsLoaded
  });

  const uploadLongFolderFiles = useCallback(
    async (files: File[]) => {
      if (!files.length) return;
      const imageExt = /\.(png|jpe?g|gif|webp|bmp|tiff?|svg)$/i;
      const list = files.filter(
        (f) => imageExt.test(f.name) || (f.type && f.type.startsWith("image/"))
      );
      if (!list.length) {
        messageApi.warning("未包含有效图片文件");
        return;
      }

      setUploadingLongFolder(true);
      messageApi.open({
        type: "loading",
        content: `正在准备上传（${list.length}）...`,
        duration: 0,
        key: "uploadLongFolder"
      });
      try {
        // 不在前端限制比例：服务端会统一处理为 1200x628（resizeImage fit=cover）
        const picked: File[] = list.slice();

        const chunks: File[][] = [];
        const max = 200;
        for (let i = 0; i < picked.length; i += max)
          chunks.push(picked.slice(i, i + max));

        let insertedTotal = 0;
        for (let ci = 0; ci < chunks.length; ci++) {
          messageApi.open({
            type: "loading",
            content: `正在上传到图片广场（${ci + 1}/${chunks.length}，${
              chunks[ci].length
            }）...`,
            duration: 0,
            key: "uploadLongFolder"
          });
          const formData = new FormData();
          formData.append("toGallery", "1");
          formData.append("aspectRatio", "16:9");
          if (appName) formData.append("appName", appName);
          if (lang) formData.append("lang", lang);
          chunks[ci].forEach((f) => formData.append("files", f));
          const res = await fetch("/api/reference-images/upload", {
            method: "POST",
            body: formData
          });
          const data = await res.json().catch(() => null);
          if (!res.ok || !data?.ok) {
            throw new Error(data?.error || "上传失败");
          }
          insertedTotal += Number(data?.inserted || 0) || 0;
        }

        messageApi.success(
          `已上传到图片广场：${picked.length} 张（入库 ${insertedTotal}）`
        );
        await fetchImages();
      } catch (e: any) {
        const msg =
          e?.response?.data?.error ||
          e?.response?.data?.message ||
          (e instanceof Error ? e.message : String(e));
        messageApi.error(msg);
      } finally {
        messageApi.destroy("uploadLongFolder");
        setUploadingLongFolder(false);
      }
    },
    [appName, fetchImages, lang, messageApi]
  );

  const onLongFolderPicked = useCallback(
    (e: any) => {
      const files = e?.target?.files
        ? Array.from(e.target.files as FileList)
        : [];
      try {
        e.target.value = "";
      } catch {}
      uploadLongFolderFiles(files as any);
    },
    [uploadLongFolderFiles]
  );

  const onLongImagePicked = useCallback(
    (e: any) => {
      const files = e?.target?.files
        ? Array.from(e.target.files as FileList)
        : [];
      try {
        e.target.value = "";
      } catch {}
      uploadLongFolderFiles(files as any);
    },
    [uploadLongFolderFiles]
  );

  useEffect(() => {
    const canAcceptDrop = () =>
      !(
        loading ||
        creatingCut ||
        uploadingFireplayRef.current ||
        downloadingZip ||
        uploadingLongFolder
      );

    const isFileDragging = (e: DragEvent) => {
      const dt: any = (e as any).dataTransfer;
      if (!dt) return false;
      const types = Array.isArray(dt.types) ? dt.types : [];
      return types.includes("Files");
    };

    const readAllDirEntries = async (reader: any): Promise<any[]> => {
      const out: any[] = [];
      while (true) {
        const batch: any[] = await new Promise((resolve) =>
          reader.readEntries(resolve)
        );
        if (!batch?.length) break;
        out.push(...batch);
      }
      return out;
    };

    const collectFilesFromEntry = async (entry: any, out: File[]) => {
      if (!entry) return;
      if (entry.isFile) {
        const f: File | null = await new Promise((resolve) =>
          entry.file(
            (x: File) => resolve(x),
            () => resolve(null)
          )
        );
        if (f) out.push(f);
        return;
      }
      if (entry.isDirectory) {
        const reader = entry.createReader();
        const entries = await readAllDirEntries(reader);
        for (const child of entries) await collectFilesFromEntry(child, out);
      }
    };

    const collectDropFiles = async (
      dt: DataTransfer | null
    ): Promise<File[]> => {
      if (!dt) return [];
      const items: any[] = dt.items ? Array.from(dt.items as any) : [];
      const entries = items
        .map((it) => it?.webkitGetAsEntry?.())
        .filter(Boolean);
      if (entries.length) {
        const out: File[] = [];
        for (const e of entries) await collectFilesFromEntry(e, out);
        return out;
      }
      return dt.files ? Array.from(dt.files) : [];
    };

    const onDragEnter = (e: DragEvent) => {
      if (!isFileDragging(e)) return;
      if (!canAcceptDrop()) return;
      e.preventDefault();
      dropEnterCountRef.current += 1;
      setDropUploadActive(true);
    };

    const onDragOver = (e: DragEvent) => {
      if (!isFileDragging(e)) return;
      if (!canAcceptDrop()) return;
      e.preventDefault();
      try {
        if ((e as any).dataTransfer)
          (e as any).dataTransfer.dropEffect = "copy";
      } catch {}
      setDropUploadActive(true);
    };

    const onDragLeave = (e: DragEvent) => {
      if (!isFileDragging(e)) return;
      if (!canAcceptDrop()) return;
      e.preventDefault();
      dropEnterCountRef.current = Math.max(0, dropEnterCountRef.current - 1);
      if (dropEnterCountRef.current === 0) setDropUploadActive(false);
    };

    const onDrop = async (e: DragEvent) => {
      if (!isFileDragging(e)) return;
      if (!canAcceptDrop()) return;
      e.preventDefault();
      dropEnterCountRef.current = 0;
      setDropUploadActive(false);
      const dt = (e as any).dataTransfer as DataTransfer | null;
      const files = await collectDropFiles(dt);
      if (files.length) uploadLongFolderFiles(files);
    };

    window.addEventListener("dragenter", onDragEnter);
    window.addEventListener("dragover", onDragOver);
    window.addEventListener("dragleave", onDragLeave);
    window.addEventListener("drop", onDrop);
    return () => {
      window.removeEventListener("dragenter", onDragEnter);
      window.removeEventListener("dragover", onDragOver);
      window.removeEventListener("dragleave", onDragLeave);
      window.removeEventListener("drop", onDrop);
    };
  }, [
    creatingCut,
    downloadingZip,
    loading,
    uploadLongFolderFiles,
    uploadingLongFolder
  ]);

  useEffect(() => {
    (async () => {
      try {
        const res = await fetch("/api/app-names", { method: "GET" });
        const data = await res.json();
        if (!res.ok || !data?.ok) return;
        const arr = Array.isArray(data.items) ? data.items : [];
        setAppNameOptions(
          arr.map((x: any) => ({ label: String(x), value: String(x) }))
        );
      } catch {}
    })();
  }, []);

  const gridImages: GridImage[] = useMemo(() => {
    const tokenToRatio: Record<string, string> = {
      "1x1": "1:1",
      "4x5": "4:5",
      "16x9": "16:9",
      "9x16": "9:16"
    };
    const getAspect = (it: HistoryItem) => {
      const ar = (
        it?.configMeta?.aspectRatio ? String(it.configMeta.aspectRatio) : ""
      ).trim();
      if (ar) return ar;
      const url = String(it?.url || "");
      const m = url.match(/-(\d+(?:_\d+)?)x(\d+(?:_\d+)?)(?:-\d+)?\./);
      if (m) {
        const key = `${m[1].replaceAll("_", ".")}x${m[2].replaceAll("_", ".")}`;
        return tokenToRatio[key] || "";
      }
      return "";
    };
    const parseRatio = (s: string): number | undefined => {
      const m = String(s || "")
        .trim()
        .match(/^(\d+(?:\.\d+)?)\s*:\s*(\d+(?:\.\d+)?)$/);
      if (!m) return undefined;
      const w = Number(m[1]);
      const h = Number(m[2]);
      if (!Number.isFinite(w) || !Number.isFinite(h) || w <= 0 || h <= 0)
        return undefined;
      return w / h;
    };
    const isAspectMatch = (itemAspect: string, queryAspect: string) => {
      const a = String(itemAspect || "").trim();
      const q = String(queryAspect || "").trim();
      if (!q) return true;
      if (!a) return false;
      if (a === q) return true;
      const ra = parseRatio(a);
      const rq = parseRatio(q);
      if (ra === undefined || rq === undefined) return false;
      // 允许等价比例（如 43:24 ~= 16:9）命中
      return Math.abs(ra - rq) <= 0.03;
    };
    const groupMap = new Map<string, { latestAt: number; imgs: GridImage[] }>();
    for (const it of items) {
      if (!it?.url) continue;
      if (aspectRatio) {
        const ar = getAspect(it);
        if (!isAspectMatch(ar, aspectRatio)) continue;
      }
      const recId = it.id ? String(it.id) : "";
      const jobId = String(it.jobId || "");
      const configId = String(it.configId || "");
      const sourceConfigId = it.sourceConfigId ? String(it.sourceConfigId) : "";
      const groupConfigId = sourceConfigId || configId;
      if (!jobId || !configId) continue;
      const index = Number(it.index) || 0;
      const createdAt = it.createdAt ? String(it.createdAt) : undefined;
      const t = createdAt ? new Date(createdAt).getTime() : 0;
      const gk = `${jobId}|${groupConfigId}`;
      const g = groupMap.get(gk) || { latestAt: 0, imgs: [] };
      g.latestAt = Math.max(g.latestAt, Number.isFinite(t) ? t : 0);
      const promptRaw =
        it.prompt != null
          ? String(it.prompt)
          : it?.configMeta?.prompt != null
          ? String(it.configMeta.prompt)
          : "";
      const prompt = promptRaw.trim();
      const referenceImagesRaw = Array.isArray(it.referenceImages)
        ? it.referenceImages
        : Array.isArray(it?.configMeta?.referenceImages)
        ? it.configMeta!.referenceImages!
        : [];
      const referenceImages = referenceImagesRaw
        .map((x) => String(x || "").trim())
        .filter(Boolean);
      const url = normalizeMaterialUrl(String(it.url));
      g.imgs.push({
        key: `${recId || `${gk}|${configId}|${index}|${createdAt || ""}`}|${
          it.url
        }`,
        url,
        jobId,
        configId: groupConfigId,
        sourceConfigId: sourceConfigId || undefined,
        index,
        createdAt,
        appName: it.appName ?? it.configMeta?.appName,
        lang: it.lang ?? it.configMeta?.lang,
        prompt: prompt || undefined,
        referenceImages: referenceImages.length
          ? referenceImages.map((u) => normalizeMaterialUrl(u))
          : undefined
      });
      groupMap.set(gk, g);
    }
    const groups = Array.from(groupMap.entries()).map(([gk, g]) => ({
      gk,
      ...g
    }));
    groups.sort((a, b) => b.latestAt - a.latestAt || (a.gk < b.gk ? -1 : 1));
    const out: GridImage[] = [];
    for (const g of groups) {
      g.imgs.sort(
        (a, b) =>
          String(a.lang ?? "").localeCompare(String(b.lang ?? "")) ||
          a.index - b.index ||
          String(a.createdAt || "").localeCompare(String(b.createdAt || ""))
      );
      out.push(...g.imgs);
    }
    return out;
  }, [items, aspectRatio]);

  const hiddenKeySet = useMemo(() => new Set(hiddenKeys), [hiddenKeys]);
  const selectedKeySet = useMemo(() => new Set(selectedKeys), [selectedKeys]);
  const cutUrlSet = useMemo(() => new Set(cutUrls), [cutUrls]);
  const downloadedUrlSet = useMemo(
    () => new Set(downloadedUrls),
    [downloadedUrls]
  );
  const fireplayUploadedUrlSet = useMemo(
    () => new Set(fireplayUploadedUrls),
    [fireplayUploadedUrls]
  );

  const visibleGridImages: GridImage[] = useMemo(() => {
    if (!hiddenKeys.length) return gridImages;
    return gridImages.filter((img) => !hiddenKeySet.has(img.key));
  }, [gridImages, hiddenKeySet, hiddenKeys.length]);

  const filteredGridImages: GridImage[] = useMemo(() => {
    let arr = visibleGridImages;
    arr = arr.filter((img) => !fireplayUploadedUrlSet.has(img.url));
    arr = arr.filter((img) =>
      cutFilter === "cut" ? cutUrlSet.has(img.url) : !cutUrlSet.has(img.url)
    );
    arr = arr.filter((img) =>
      downloadedFilter === "downloaded"
        ? downloadedUrlSet.has(img.url)
        : !downloadedUrlSet.has(img.url)
    );
    return arr;
  }, [
    visibleGridImages,
    cutFilter,
    cutUrlSet,
    downloadedFilter,
    downloadedUrlSet,
    fireplayUploadedUrlSet
  ]);

  const paginatedGridImages: GridImage[] = useMemo(() => {
    return filteredGridImages.slice(0, galleryPage * galleryPageSize);
  }, [filteredGridImages, galleryPage, galleryPageSize]);

  const previewItems = useMemo(
    () => paginatedGridImages.map((x) => x.url),
    [paginatedGridImages]
  );

  useEffect(() => {
    setFilteredCount(filteredGridImages.length);
  }, [filteredGridImages.length, setFilteredCount]);

  const keyToImg = useMemo(() => {
    const m = new Map<string, GridImage>();
    for (const img of gridImages) m.set(img.key, img);
    return m;
  }, [gridImages]);

  const { uploadingFireplay, onUploadToFireplay } = useUploadToFireplay({
    messageApi,
    selectedKeys,
    keyToImg,
    onBeforeUpload: () => {
      setSelectedKeys([]);
      setSelectMode(false);
    },
    onUploadedSourceUrls: (urls) => {
      setFireplayUploadedUrls((prev) =>
        Array.from(new Set([...(prev || []), ...(urls || [])]))
      );
    }
  });

  useEffect(() => {
    uploadingFireplayRef.current = uploadingFireplay;
  }, [uploadingFireplay]);

  const selectedImages = useMemo(() => {
    return selectedKeys
      .map((k) => keyToImg.get(k))
      .filter(Boolean) as GridImage[];
  }, [keyToImg, selectedKeys]);
  const selectedPreviewImages = useMemo(
    () => selectedImages.slice(0, 80),
    [selectedImages]
  );

  const togglePick = useCallback((k: string) => {
    setSelectedKeys((prev) => {
      if (prev.includes(k)) return prev.filter((x) => x !== k);
      return [...prev, k];
    });
  }, []);

  const onOpenPreviewAt = useCallback(
    (idx: number) => {
      if (suppressClickRef.current) {
        suppressClickRef.current = false;
        return;
      }
      setPreviewIndex(idx);
      setPreviewOpen(true);
      blurActiveElement();
    },
    [blurActiveElement]
  );

  const onPreviewOpenChange = useCallback((open: boolean) => {
    setPreviewOpen(Boolean(open));
  }, []);

  // antd Image 预览在关闭时有动画：如果立刻把 current 重置为 0，会在动画末尾闪回第一张。
  // 所以把“重置索引”延后到关闭动画结束后。
  const onPreviewAfterOpenChange = useCallback((open: boolean) => {
    if (!open) setPreviewIndex(0);
  }, []);

  const onPreviewChange = useCallback(
    (cur: number) => setPreviewIndex(Number(cur) || 0),
    []
  );

  const previewConfig = useMemo(
    () => ({
      open: previewOpen,
      current: previewIndex,
      onOpenChange: onPreviewOpenChange,
      afterOpenChange: onPreviewAfterOpenChange,
      onChange: onPreviewChange
    }),
    [
      onPreviewAfterOpenChange,
      onPreviewChange,
      onPreviewOpenChange,
      previewIndex,
      previewOpen
    ]
  );

  const onSelectedPreviewOpenChange = useCallback((open: boolean) => {
    setSelectedPreviewOpen(Boolean(open));
  }, []);

  const onSelectedPreviewAfterOpenChange = useCallback((open: boolean) => {
    if (!open) setSelectedPreviewIndex(0);
  }, []);

  const onSelectedPreviewChange = useCallback(
    (cur: number) => setSelectedPreviewIndex(Number(cur) || 0),
    []
  );

  const selectedPreviewConfig = useMemo(
    () => ({
      open: selectedPreviewOpen,
      current: selectedPreviewIndex,
      onOpenChange: onSelectedPreviewOpenChange,
      afterOpenChange: onSelectedPreviewAfterOpenChange,
      onChange: onSelectedPreviewChange
    }),
    [
      onSelectedPreviewAfterOpenChange,
      onSelectedPreviewChange,
      onSelectedPreviewOpenChange,
      selectedPreviewIndex,
      selectedPreviewOpen
    ]
  );

  const onOpenMeta = useCallback((img: GridImage) => {
    setMetaImg(img);
    setMetaOpen(true);
  }, []);

  const addPicks = useCallback((keys: string[]) => {
    const arr = Array.isArray(keys)
      ? keys.map((x) => String(x || "").trim()).filter(Boolean)
      : [];
    if (!arr.length) return;
    setSelectedKeys((prev) => {
      const set = new Set(prev);
      for (const k of arr) set.add(k);
      return Array.from(set);
    });
  }, []);

  useEffect(() => {
    setSelectMode(selectedKeys.length > 0);
  }, [selectedKeys]);

  useEffect(() => {
    setSelectedKeys([]);
  }, [aspectRatio]);

  useEffect(() => {
    setHiddenKeys([]);
  }, [appName, lang, aspectRatio]);

  const onGridMouseDown = useCallback((e: any) => {
    if (e.button !== 0) return;
    const wrap = gridWrapRef.current;
    if (!wrap) return;
    const rect = wrap.getBoundingClientRect();
    const x = e.clientX - rect.left;
    const y = e.clientY - rect.top;
    dragStateRef.current = {
      active: true,
      moved: false,
      startX: x,
      startY: y,
      curX: x,
      curY: y
    };
    suppressClickRef.current = false;
    dragBoxRef.current = { active: true, x, y, w: 0, h: 0 };
    setDragBox({ active: true, x, y, w: 0, h: 0 });
    e.preventDefault();
    e.stopPropagation();
  }, []);

  useEffect(() => {
    if (!previewOpen) return;
    const len = paginatedGridImages.length;
    if (previewIndex < 0) setPreviewIndex(0);
    else if (previewIndex >= len) setPreviewIndex(Math.max(0, len - 1));
  }, [previewOpen, previewIndex, paginatedGridImages.length]);

  useEffect(() => {
    const onKeyDown = (e: KeyboardEvent) => {
      if (!previewOpen) return;
      const k = String(e.key || "").toLowerCase();
      if (k !== "c" && k !== "x") return;
      const img = paginatedGridImages[previewIndex];
      if (!img) return;
      e.preventDefault();
      e.stopPropagation();
      (e as any).stopImmediatePropagation?.();
      if (k === "c") {
        togglePick(img.key);
        setPreviewIndex((cur) => {
          const len = paginatedGridImages.length;
          if (!len) return 0;
          return Math.min(cur + 1, len - 1);
        });
        return;
      }
      if (k === "x") {
        if (selectedKeySet.has(img.key)) {
          togglePick(img.key);
          return;
        }
        const curIdx = previewIndex;
        const prevLen = paginatedGridImages.length;
        setHiddenKeys((prev) => {
          if (prev.includes(img.key)) return prev;
          return [...prev, img.key];
        });
        const nextLen = Math.max(0, (prevLen || 0) - 1);
        if (!nextLen) {
          setPreviewOpen(false);
        } else {
          setPreviewIndex(Math.min(curIdx, nextLen - 1));
        }
        return;
      }
    };
    window.addEventListener("keydown", onKeyDown, true);
    return () => window.removeEventListener("keydown", onKeyDown, true);
  }, [
    previewOpen,
    previewIndex,
    selectedKeySet,
    togglePick,
    paginatedGridImages
  ]);

  useEffect(() => {
    const onKeyDown = (e: KeyboardEvent) => {
      if (!selectedPreviewOpen) return;
      const k = String(e.key || "").toLowerCase();
      if (k !== "x") return;
      const img = selectedPreviewImages[selectedPreviewIndex];
      if (!img) return;
      e.preventDefault();
      e.stopPropagation();
      (e as any).stopImmediatePropagation?.();
      togglePick(img.key);
      const curIdx = selectedPreviewIndex;
      const prevLen = selectedPreviewImages.length;
      const nextLen = Math.max(0, (prevLen || 0) - 1);
      if (!nextLen) {
        setSelectedPreviewOpen(false);
      } else {
        setSelectedPreviewIndex(Math.min(curIdx, nextLen - 1));
      }
    };
    window.addEventListener("keydown", onKeyDown, true);
    return () => window.removeEventListener("keydown", onKeyDown, true);
  }, [
    selectedPreviewOpen,
    selectedPreviewIndex,
    selectedPreviewImages,
    togglePick
  ]);

  useEffect(() => {
    const onMove = (e: MouseEvent) => {
      const st = dragStateRef.current;
      if (!st.active) return;
      const wrap = gridWrapRef.current;
      if (!wrap) return;
      const rect = wrap.getBoundingClientRect();
      const x = e.clientX - rect.left;
      const y = e.clientY - rect.top;
      st.curX = x;
      st.curY = y;
      const dx = x - st.startX;
      const dy = y - st.startY;
      if (!st.moved && (Math.abs(dx) > 6 || Math.abs(dy) > 6)) {
        st.moved = true;
        suppressClickRef.current = true;
      }
      dragBoxRef.current = {
        active: true,
        x: st.startX,
        y: st.startY,
        w: dx,
        h: dy
      };
      if (dragRafRef.current) return;
      dragRafRef.current = window.requestAnimationFrame(() => {
        dragRafRef.current = null;
        setDragBox(dragBoxRef.current);
      });
    };
    const onUp = () => {
      const st = dragStateRef.current;
      if (!st.active) return;
      st.active = false;
      const wrap = gridWrapRef.current;
      const moved = st.moved;
      const sx = st.startX,
        sy = st.startY,
        ex = st.curX,
        ey = st.curY;
      dragBoxRef.current = { ...dragBoxRef.current, active: false };
      if (dragRafRef.current) {
        window.cancelAnimationFrame(dragRafRef.current);
        dragRafRef.current = null;
      }
      setDragBox((prev) => ({ ...prev, active: false }));
      if (!wrap) return;
      if (!moved) return;
      const rect = wrap.getBoundingClientRect();
      const left = rect.left + Math.min(sx, ex);
      const right = rect.left + Math.max(sx, ex);
      const top = rect.top + Math.min(sy, ey);
      const bottom = rect.top + Math.max(sy, ey);
      const nodes = Array.from(
        wrap.querySelectorAll("[data-grid-key]")
      ) as HTMLElement[];
      const picked: string[] = [];
      for (const el of nodes) {
        const k = el.getAttribute("data-grid-key") || "";
        if (!k) continue;
        const r = el.getBoundingClientRect();
        const hit = !(
          r.right < left ||
          r.left > right ||
          r.bottom < top ||
          r.top > bottom
        );
        if (hit) picked.push(k);
      }
      if (picked.length) addPicks(picked);
    };
    window.addEventListener("mousemove", onMove);
    window.addEventListener("mouseup", onUp);
    return () => {
      window.removeEventListener("mousemove", onMove);
      window.removeEventListener("mouseup", onUp);
      if (dragRafRef.current) {
        window.cancelAnimationFrame(dragRafRef.current);
        dragRafRef.current = null;
      }
    };
  }, [addPicks]);

  const onCreateCut = async () => {
    if (!selectedKeys.length) {
      messageApi.error("请先选择要裁剪的图片");
      return;
    }
    const picked = selectedKeys
      .map((k) => keyToImg.get(k))
      .filter(Boolean) as GridImage[];
    if (!picked.length) {
      messageApi.error("选中的图片无效");
      return;
    }
    setCreatingCut(true);
    try {
      const res = await fetch("/api/cut-jobs/start?scope=gallery", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({
          images: picked.map((p) => ({
            url: p.url,
            appName: p.appName,
            lang: p.lang
          })),
          concurrency: 64
        })
      });
      const data = await res.json();
      if (!res.ok || !data?.ok) {
        messageApi.error(data?.error || "创建裁图任务失败");
        return;
      }
      setCutUrls((prev) =>
        Array.from(
          new Set([
            ...(prev || []),
            ...picked.map((p) => String(p.url || "").trim()).filter(Boolean)
          ])
        )
      );
      const jobId = String(data.jobId || "");
      try {
        if (jobId) {
          localStorage.setItem(batchLastJobIdKey, jobId);
          const raw = localStorage.getItem(batchRecentJobIdsKey);
          const arr = raw ? JSON.parse(raw) : [];
          const prev = Array.isArray(arr)
            ? arr.map((x: any) => String(x || "").trim()).filter(Boolean)
            : [];
          const next = [
            jobId,
            ...prev.filter((x: string) => x !== jobId)
          ].slice(0, 50);
          localStorage.setItem(batchRecentJobIdsKey, JSON.stringify(next));
        }
      } catch {}
      messageApi.success(`已创建裁图任务: ${jobId}`);
      setSelectedKeys([]);
      setSelectMode(false);
    } catch (e) {
      messageApi.error(e instanceof Error ? e.message : String(e));
    } finally {
      setCreatingCut(false);
    }
  };

  const onDownloadSelected = useCallback(async () => {
    if (!selectedKeys.length) {
      messageApi.error("请先选择要下载的图片");
      return;
    }
    const picked = selectedKeys
      .map((k) => keyToImg.get(k))
      .filter(Boolean) as GridImage[];
    if (!picked.length) {
      messageApi.error("选中的图片无效");
      return;
    }
    setDownloadingZip(true);
    messageApi.open({
      type: "loading",
      content: `正在打包下载（${picked.length}）...`,
      duration: 0,
      key: "downloadZip"
    });
    try {
      const parseFilename = (cd: string | null) => {
        const raw = String(cd || "");
        const mStar = raw.match(/filename\*\s*=\s*UTF-8''([^;]+)/i);
        if (mStar?.[1]) {
          try {
            return decodeURIComponent(mStar[1].trim().replace(/^"|"$/g, ""));
          } catch {}
        }
        const m =
          raw.match(/filename\s*=\s*"([^"]+)"/i) ||
          raw.match(/filename\s*=\s*([^;]+)/i);
        return m?.[1] ? String(m[1]).trim() : "";
      };

      const filenamePrefix = `gallery-${
        String(appName || "all").trim() || "all"
      }-${String(lang || "all").trim() || "all"}-${
        String(aspectRatio || "").trim() || "ratio"
      }`;
      const res = await fetch("/api/cut-records/download", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({
          urls: picked.map((p) => p.url),
          folderName: "images",
          filenamePrefix
        })
      });
      if (!res.ok) {
        const data = await res.json().catch(() => null);
        messageApi.error(data?.error || "下载失败");
        return;
      }
      const blob = await res.blob();
      const cd = res.headers.get("content-disposition");
      const filename = parseFilename(cd) || "images.zip";
      const url = URL.createObjectURL(blob);
      const a = document.createElement("a");
      a.href = url;
      a.download = filename;
      document.body.appendChild(a);
      a.click();
      a.remove();

      window.setTimeout(() => URL.revokeObjectURL(url), 10_000);
      messageApi.success("已开始下载");
      try {
        const markRes = await fetch("/api/cut-records/mark-as-downloaded", {
          method: "POST",
          headers: { "content-type": "application/json" },
          body: JSON.stringify({ urls: picked.map((p) => p.url) })
        });
        const markData = await markRes.json().catch(() => null);
        if (markRes.ok && markData?.ok) {
          const urlsToAdd = picked.map((p) => p.url).filter(Boolean);
          if (urlsToAdd.length)
            setDownloadedUrls((prev) =>
              Array.from(new Set([...prev, ...urlsToAdd]))
            );
        }
      } catch {}
      setSelectedKeys([]);
      setSelectMode(false);
    } catch (e: any) {
      messageApi.error(e instanceof Error ? e.message : String(e));
    } finally {
      messageApi.destroy("downloadZip");
      setDownloadingZip(false);
    }
  }, [appName, aspectRatio, keyToImg, lang, messageApi, selectedKeys]);

  return (
    <AdminShell defaultSelectedKey="/gallery" headerTitle="图片广场">
      {contextHolder}
      {dropUploadActive ? (
        <div
          style={{
            position: "fixed",
            inset: 0,
            background: "rgba(22,119,255,0.12)",
            border: "2px dashed rgba(22,119,255,0.55)",
            zIndex: 999,
            display: "flex",
            alignItems: "center",
            justifyContent: "center",
            pointerEvents: "none",
            fontSize: 16,
            fontWeight: 700,
            color: "rgba(22,119,255,0.95)",
            textShadow: "0 1px 0 rgba(255,255,255,0.7)"
          }}
        >
          松开鼠标上传长图（支持文件/文件夹）
        </div>
      ) : null}
      <Space orientation="vertical" size={12} style={{ width: "100%" }}>
        <GalleryToolbar
          appName={appName}
          appNameOptions={appNameOptions}
          onAppNameChange={setAppName}
          lang={lang}
          onLangChange={setLang}
          aspectRatio={aspectRatio}
          onAspectRatioChange={setAspectRatio}
          cutFilter={cutFilter}
          onCutFilterChange={setCutFilter}
          downloadedFilter={downloadedFilter}
          onDownloadedFilterChange={setDownloadedFilter}
          loading={loading}
          creatingCut={creatingCut}
          uploadingFireplay={uploadingFireplay}
          downloadingZip={downloadingZip}
          uploadingLongFolder={uploadingLongFolder}
          onRefresh={() => fetchImages()}
          longFolderPickRef={longFolderPickRef}
          longImagePickRef={longImagePickRef}
          onLongFolderPicked={onLongFolderPicked}
          onLongImagePicked={onLongImagePicked}
          selectMode={selectMode}
          selectedCount={selectedKeys.length}
          filteredCount={filteredGridImages.length}
          dataTotalCount={dataTotalCount}
          onCreateCut={onCreateCut}
          onOpenImageEdit={() => setImageEditOpen(true)}
          onUploadToFireplay={onUploadToFireplay}
          onDownloadSelected={onDownloadSelected}
        />

        <SelectedImagesStrip
          selectedPreviewImages={selectedPreviewImages}
          selectedPreviewConfig={selectedPreviewConfig}
          onOpenPreviewAt={(i) => {
            setSelectedPreviewIndex(i);
            setSelectedPreviewOpen(true);
            blurActiveElement();
          }}
          onRemove={togglePick}
          selectedCount={selectedImages.length}
          onClear={() => {
            setSelectedKeys([]);
            setSelectMode(false);
          }}
          disableClear={loading || creatingCut}
        />

        <MetaModal
          open={metaOpen}
          img={metaImg}
          onClose={() => {
            setMetaOpen(false);
            setMetaImg(null);
          }}
        />

        <ImageEditDialog
          open={imageEditOpen}
          onClose={() => setImageEditOpen(false)}
          initialImages={selectedImages}
          aspectRatio={aspectRatio}
          messageApi={messageApi}
          onSaved={() => {
            fetchImages();
          }}
        />

        <GalleryGrid
          gridWrapRef={gridWrapRef}
          dragBox={dragBox}
          previewOpen={previewOpen}
          onGridMouseDown={onGridMouseDown}
          previewItems={previewItems}
          previewConfig={previewConfig}
          images={paginatedGridImages}
          selectedKeySet={selectedKeySet}
          togglePick={togglePick}
          onOpenPreviewAt={onOpenPreviewAt}
          onOpenMeta={onOpenMeta}
        />

        <LoadMoreFooter
          filteredCount={filteredGridImages.length}
          paginatedCount={paginatedGridImages.length}
          hasMore={hasMore}
          loadingMore={loadingMore}
          dataHasMore={dataHasMore}
          dataTotalCount={dataTotalCount}
          loadMoreSentinelRef={loadMoreSentinelRef}
        />
      </Space>
    </AdminShell>
  );
}
