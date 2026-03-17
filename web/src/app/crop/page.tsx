"use client";

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import {
  Button,
  Card,
  Image,
  Input,
  InputNumber,
  Select,
  Space,
  Switch,
  Table,
  Typography,
  message
} from "antd";
import { ReloadOutlined } from "@ant-design/icons";
import AdminShell from "@/app/_components/AdminShell";
import { SUPPORTED_LANGUAGES } from "@/common/constants";

type CutRecordOutputItem = {
  status: string;
  outputUrl?: string;
  outputMimeType?: string;
  error?: string;
  updatedAt?: string;
};

type CutRecordItem = {
  id: string;
  jobId?: string;
  sourceUrl: string;
  sourceAbsPath?: string;
  appName?: string;
  lang?: string;
  status: string;
  createdAt?: string;
  updatedAt?: string;
  outputs?: Record<string, Record<string, CutRecordOutputItem>>;
};

export default function CropPage() {
  const [messageApi, contextHolder] = message.useMessage();
  const isMountedRef = useRef(true);
  const downloadAbortRef = useRef<AbortController | null>(null);
  const [toast, setToast] = useState<{
    type: "success" | "error" | "warning" | "info";
    content: string;
    id: number;
  } | null>(null);
  const [recordsLoading, setRecordsLoading] = useState(false);
  const [rawRecords, setRawRecords] = useState<CutRecordItem[]>([]);
  const [recordsTotal, setRecordsTotal] = useState(0);
  const recordCacheRef = useRef<Map<string, CutRecordItem>>(new Map());
  // UI 行 key 需要绝对唯一且稳定（批量时后端 id 若碰撞，会导致表格/缩略图复用错位）
  const UI_ROW_SEP = "\u0001";
  const getUiRowKey = useCallback((row: CutRecordItem) => {
    const id = String((row as any)?.id ?? "");
    const jobId = String((row as any)?.jobId ?? "");
    const src = String(
      (row as any)?.sourceAbsPath ?? (row as any)?.sourceUrl ?? ""
    );
    // id|jobId|src：尽量避免同名文件/多任务批量时 key 冲突
    return `${id}${UI_ROW_SEP}${jobId}${UI_ROW_SEP}${src}`;
  }, []);
  const batchLastJobIdKey = "batch:lastJobId";
  const batchRecentJobIdsKey = "batch:recentJobIds";
  // 缩略图尺寸固定（如需恢复调节，可把工具栏的输入框加回来）
  const [outputThumbSize] = useState<number>(120);
  const [sourceThumbSize] = useState<number>(220);
  const [isWideScreen, setIsWideScreen] = useState(false);
  const tableWrapRef = useRef<HTMLDivElement | null>(null);
  const tableScrollElRef = useRef<HTMLElement | null>(null);
  const stickyHScrollRef = useRef<HTMLDivElement | null>(null);
  const syncScrollingRef = useRef<"table" | "sticky" | null>(null);
  const [stickyHScroll, setStickyHScroll] = useState<{
    visible: boolean;
    left: number;
    width: number;
    scrollWidth: number;
  }>({
    visible: false,
    left: 0,
    width: 0,
    scrollWidth: 0
  });
  const [selectedRowKeys, setSelectedRowKeys] = useState<string[]>([]);
  const [downloadStartFolderIndex, setDownloadStartFolderIndex] =
    useState<number>(1);
  const [downloadFixedCode, setDownloadFixedCode] = useState<string>("404");
  const [downloadWithSubfolders, setDownloadWithSubfolders] =
    useState<boolean>(false);
  const [downloading, setDownloading] = useState(false);
  const [regenerating, setRegenerating] = useState(false);
  const [excludedKeys, setExcludedKeys] = useState<Record<string, true>>({});
  const [previewOpen, setPreviewOpen] = useState(false);
  const [previewItems, setPreviewItems] = useState<
    { k: string; url: string }[]
  >([]);
  const [previewIndex, setPreviewIndex] = useState(0);
  const [activePreviewKey, setActivePreviewKey] = useState<string | null>(null);
  const [cropPage, setCropPage] = useState(1);
  const [cropPageSize, setCropPageSize] = useState(15);
  const [appName, setAppName] = useState<string>("");
  const [lang, setLang] = useState<string>("");
  const [appNameOptions, setAppNameOptions] = useState<
    Array<{ label: string; value: string }>
  >([]);

  // 输出模板固定顺序：避免某些模板缺失时“拼图/长图缩略图位置乱跳”。
  const BASE_TEMPLATE_ORDER = useMemo(
    () => [
      "getCutLogoFinalPrompt",
      "getCutOtherFinalPrompt",
      "getCutScaleFinalPrompt"
    ],
    []
  );
  const EXTRA_TEMPLATE_ORDER_BY_RATIO = useMemo<Record<string, string[]>>(
    () => ({
      // 长图（拼长图）
      "1:1": ["stitchLongImage1024"],
      // 竖向拼图（4:5）
      "4:5": ["getCutVerticalCollagePrompt"]
    }),
    []
  );
  const getOrderedTemplates = useCallback(
    (ratio: string, tplNames: string[]) => {
      const available = new Set(
        (Array.isArray(tplNames) ? tplNames : [])
          .map((x) => String(x || "").trim())
          .filter(Boolean)
      );
      const seen = new Set<string>();
      const out: string[] = [];
      const push = (t: string) => {
        const s = String(t || "").trim();
        if (s && !available.has(s)) return;
        if (!s || seen.has(s)) return;
        seen.add(s);
        out.push(s);
      };
      for (const t of BASE_TEMPLATE_ORDER) push(t);
      for (const t of EXTRA_TEMPLATE_ORDER_BY_RATIO[ratio] || []) push(t);
      // 其它模板：保持字母序（稳定）
      const rest = [...available].sort();
      for (const t of rest) push(t);
      return out;
    },
    [BASE_TEMPLATE_ORDER, EXTRA_TEMPLATE_ORDER_BY_RATIO]
  );

  useEffect(() => {
    isMountedRef.current = true;
    return () => {
      isMountedRef.current = false;
      downloadAbortRef.current?.abort();
    };
  }, []);

  useEffect(() => {
    if (!toast) return;
    // 通过 effect 触发，避免 React 18 并发模式下 antd 提示 “notice in render”
    switch (toast.type) {
      case "success":
        messageApi.success(toast.content);
        break;
      case "error":
        messageApi.error(toast.content);
        break;
      case "warning":
        messageApi.warning(toast.content);
        break;
      case "info":
      default:
        messageApi.info(toast.content);
        break;
    }
  }, [toast, messageApi]);

  const sortCutRecordsForDisplay = useCallback((items: CutRecordItem[]) => {
    const langRank = new Map<string, number>(
      SUPPORTED_LANGUAGES.map((x, i) => [String(x).toLowerCase(), i])
    );

    const norm = (v: any) => String(v ?? "").trim();
    const normLower = (v: any) => norm(v).toLowerCase();
    const timeMs = (row: CutRecordItem) => {
      // 默认按创建时间：重新裁剪/重新生成只更新 updatedAt，不会导致记录“跳到第一个”
      const s = norm(row.createdAt || row.updatedAt);
      if (!s) return 0;
      const t = Date.parse(s);
      return Number.isFinite(t) ? t : 0;
    };
    const groupKey = (row: CutRecordItem) => norm(row.jobId); // same task => same jobId; empty jobId => one group

    // outer order: task groups by their latest updatedAt/createdAt desc
    const groupMaxTime = new Map<string, number>();
    for (const row of items) {
      const g = groupKey(row);
      const t = timeMs(row);
      const prev = groupMaxTime.get(g) ?? 0;
      if (t > prev) groupMaxTime.set(g, t);
    }

    const arr = [...items];
    arr.sort((a, b) => {
      const ga = groupKey(a);
      const gb = groupKey(b);
      const gta = groupMaxTime.get(ga) ?? 0;
      const gtb = groupMaxTime.get(gb) ?? 0;
      if (gta !== gtb) return gtb - gta; // newest task group first
      if (ga !== gb) return ga.localeCompare(gb); // stable grouping when group time ties

      // inside the same task group: lang block -> appName block -> time desc
      const laRaw = normLower(a.lang);
      const lbRaw = normLower(b.lang);
      const laRank = langRank.get(laRaw) ?? 999;
      const lbRank = langRank.get(lbRaw) ?? 999;
      if (laRank !== lbRank) return laRank - lbRank;
      if (laRaw !== lbRaw) return laRaw.localeCompare(lbRaw);

      const aa = normLower(a.appName);
      const ab = normLower(b.appName);
      if (aa !== ab) return aa.localeCompare(ab);

      const ta = timeMs(a);
      const tb = timeMs(b);
      if (ta !== tb) return tb - ta;

      return norm(a.id).localeCompare(norm(b.id));
    });

    return arr;
  }, []);

  const records = useMemo(
    () => sortCutRecordsForDisplay(rawRecords),
    [rawRecords, sortCutRecordsForDisplay]
  );

  useEffect(() => {
    const mql = window.matchMedia("(min-width: 1600px)");
    const apply = () => setIsWideScreen(Boolean(mql.matches));
    apply();
    // Safari/旧浏览器兼容（matchMedia 旧 API）
    if ("addEventListener" in mql) {
      mql.addEventListener("change", apply);
      return () => mql.removeEventListener("change", apply);
    }
    (mql as any).addListener?.(apply);
    return () => (mql as any).removeListener?.(apply);
  }, []);

  // 固定屏幕底部的横向滚动条：与 AntD Table 横向滚动同步（不用滚到表格最底部）
  useEffect(() => {
    const wrap = tableWrapRef.current;
    if (!wrap) return;

    const findScrollEl = () =>
      (wrap.querySelector(".ant-table-body") as HTMLElement | null) ||
      (wrap.querySelector(".ant-table-content") as HTMLElement | null) ||
      null;

    const updateMetrics = () => {
      const sc = findScrollEl();
      tableScrollElRef.current = sc;

      const rect = wrap.getBoundingClientRect();
      const width = Math.max(0, Math.floor(rect.width));
      const left = Math.floor(rect.left);

      const scrollWidth = sc ? Math.floor(sc.scrollWidth || 0) : 0;
      const clientWidth = sc ? Math.floor(sc.clientWidth || 0) : 0;
      const visible = Boolean(sc && scrollWidth > clientWidth + 2);

      setStickyHScroll((prev) => {
        const next = { visible, left, width, scrollWidth };
        if (
          prev.visible === next.visible &&
          prev.left === next.left &&
          prev.width === next.width &&
          prev.scrollWidth === next.scrollWidth
        ) {
          return prev;
        }
        return next;
      });

      // 同步当前 scrollLeft
      if (visible && sc && stickyHScrollRef.current) {
        stickyHScrollRef.current.scrollLeft = sc.scrollLeft;
      }
    };

    const onTableScroll = () => {
      const sc = tableScrollElRef.current;
      const sticky = stickyHScrollRef.current;
      if (!sc || !sticky) return;
      if (syncScrollingRef.current === "sticky") return;
      syncScrollingRef.current = "table";
      sticky.scrollLeft = sc.scrollLeft;
      queueMicrotask(() => {
        if (syncScrollingRef.current === "table")
          syncScrollingRef.current = null;
      });
    };

    const onStickyScroll = () => {
      const sc = tableScrollElRef.current;
      const sticky = stickyHScrollRef.current;
      if (!sc || !sticky) return;
      if (syncScrollingRef.current === "table") return;
      syncScrollingRef.current = "sticky";
      sc.scrollLeft = sticky.scrollLeft;
      queueMicrotask(() => {
        if (syncScrollingRef.current === "sticky")
          syncScrollingRef.current = null;
      });
    };

    const ro = new ResizeObserver(() => updateMetrics());
    ro.observe(wrap);

    // 初次与后续重算
    const raf = requestAnimationFrame(updateMetrics);
    window.addEventListener("resize", updateMetrics);

    // 绑定滚动监听
    const sc0 = findScrollEl();
    if (sc0) sc0.addEventListener("scroll", onTableScroll, { passive: true });
    const sticky0 = stickyHScrollRef.current;
    if (sticky0)
      sticky0.addEventListener("scroll", onStickyScroll, { passive: true });

    return () => {
      cancelAnimationFrame(raf);
      window.removeEventListener("resize", updateMetrics);
      ro.disconnect();
      const sc = findScrollEl();
      if (sc) sc.removeEventListener("scroll", onTableScroll as any);
      if (sticky0) sticky0.removeEventListener("scroll", onStickyScroll as any);
    };
  }, [
    cropPage,
    cropPageSize,
    isWideScreen,
    outputThumbSize,
    rawRecords.length,
    recordsLoading,
    recordsTotal,
    sourceThumbSize
  ]);

  const fetchRecords = useCallback(async () => {
    setRecordsLoading(true);
    try {
      const qs = new URLSearchParams();
      qs.set("page", String(cropPage));
      qs.set("pageSize", String(cropPageSize));
      if (appName) qs.set("appName", String(appName));
      if (lang) qs.set("lang", String(lang));
      const res = await fetch(`/api/cut-records?${qs.toString()}`, {
        method: "GET"
      });
      const data = await res.json();
      if (!res.ok || !data?.ok) {
        messageApi.error(data?.error || "获取裁图记录失败");
        return;
      }
      const arr = Array.isArray(data.items) ? data.items : [];
      for (const r of arr) {
        if (r && typeof r === "object" && (r as any).id) {
          recordCacheRef.current.set(getUiRowKey(r as any), r as any);
        }
      }
      setRawRecords(arr);
      const total = Number((data as any)?.total);
      setRecordsTotal(Number.isFinite(total) ? total : arr.length);
    } catch (e) {
      messageApi.error(e instanceof Error ? e.message : String(e));
    } finally {
      setRecordsLoading(false);
    }
  }, [appName, cropPage, cropPageSize, getUiRowKey, lang, messageApi]);

  const downloadSelected = async () => {
    if (!selectedRowKeys.length) {
      messageApi.warning("请先选择要下载的记录");
      return;
    }

    const pad2 = (n: number) => String(n).padStart(2, "0");
    const sanitize = (s: string) =>
      String(s || "")
        .replace(/[\\/:*?"<>|\s]+/g, "-")
        .replace(/-+/g, "-")
        .replace(/(^-|-$)/g, "");
    const now = new Date();
    const datePrefix = `${pad2(now.getMonth() + 1)}${pad2(now.getDate())}`;
    const selectedRows = selectedRowKeys
      .map((k) => recordKeyToRow.get(k) || recordCacheRef.current.get(k))
      .filter(Boolean) as CutRecordItem[];
    const selectedIds = selectedRows.map((r) => String(r.id)).filter(Boolean);
    const pickedAppNames = selectedRows
      .map((d) => String(d.appName || "").trim())
      .filter(Boolean);
    const pickedLangs = selectedRows
      .map((d) => String(d.lang || "").trim())
      .filter(Boolean);
    const appNamePicked =
      pickedAppNames.length &&
      pickedAppNames.every((x) => x === pickedAppNames[0])
        ? pickedAppNames[0]
        : pickedAppNames.length
        ? "mixed"
        : "unknown";
    const langPicked =
      pickedLangs.length && pickedLangs.every((x) => x === pickedLangs[0])
        ? pickedLangs[0]
        : pickedLangs.length
        ? "mixed"
        : "unknown";
    const preSuggestedName = `${datePrefix}-${sanitize(
      appNamePicked
    )}-${sanitize(langPicked)}.zip`;

    // 为了保证大文件/慢请求时仍能弹出保存窗口：必须先触发文件选择（保持用户手势）再开始下载
    const w = window as any;
    if (typeof w.showSaveFilePicker === "function") {
      let fileHandle: any;
      try {
        fileHandle = await w.showSaveFilePicker({
          suggestedName: preSuggestedName,
          types: [
            { description: "Zip", accept: { "application/zip": [".zip"] } }
          ]
        });
      } catch (e: any) {
        if (e?.name === "AbortError") return;
        console.warn(
          "showSaveFilePicker failed, fallback to traditional download:",
          e
        );
        // 继续走降级方案
      }

      if (fileHandle) {
        if (isMountedRef.current) setDownloading(true);
        downloadAbortRef.current?.abort();
        const controller = new AbortController();
        downloadAbortRef.current = controller;
        try {
          const res = await fetch("/api/cut-records/download", {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({
              ids: selectedIds,
              startFolderIndex: downloadStartFolderIndex,
              fixedCode: downloadFixedCode,
              includeSubfolders: downloadWithSubfolders,
              excludedKeys: Object.keys(excludedKeys)
            }),
            signal: controller.signal
          });
          if (!res.ok) {
            const data = await res.json().catch(() => null);
            throw new Error((data as any)?.error || `下载失败(${res.status})`);
          }

          // 后端文件名仅用于 display；实际保存名以用户在对话框里选定为准
          let writable: any = null;
          try {
            writable = await fileHandle.createWritable();
            const reader = res.body ? res.body.getReader() : null;
            if (reader) {
              while (true) {
                const { done, value } = await reader.read();
                if (done) break;
                if (value) await writable.write(value);
              }
            } else {
              const blob = await res.blob();
              await writable.write(blob);
            }
            await writable.close();
          } catch (e) {
            try {
              if (writable?.abort) await writable.abort();
              else if (writable?.close) await writable.close();
            } catch {}
            throw e;
          }
          if (isMountedRef.current) {
            setToast({ type: "success", content: "已保存", id: Date.now() });
            setSelectedRowKeys([]);
          }
          return;
        } catch (e) {
          const anyErr = e as any;
          const name = anyErr?.name ? String(anyErr.name) : "";
          if (name === "AbortError") return;
          if (isMountedRef.current) {
            setToast({
              type: "error",
              content: e instanceof Error ? e.message : String(e),
              id: Date.now()
            });
          }
          return;
        } finally {
          if (downloadAbortRef.current === controller)
            downloadAbortRef.current = null;
          if (isMountedRef.current) setDownloading(false);
        }
      }
    }

    if (isMountedRef.current) setDownloading(true);
    downloadAbortRef.current?.abort();
    const controller = new AbortController();
    downloadAbortRef.current = controller;
    try {
      // 发送下载请求
      const res = await fetch("/api/cut-records/download", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          ids: selectedIds,
          startFolderIndex: downloadStartFolderIndex,
          fixedCode: downloadFixedCode,
          includeSubfolders: downloadWithSubfolders,
          excludedKeys: Object.keys(excludedKeys)
        }),
        signal: controller.signal
      });
      if (!res.ok) {
        const data = await res.json().catch(() => null);
        throw new Error((data as any)?.error || `下载失败(${res.status})`);
      }

      // 获取后端返回的文件名（格式：日期-appName-语言.zip）
      const cd = res.headers.get("Content-Disposition") || "";
      const m =
        /filename\*=UTF-8''([^;]+)/.exec(cd) || /filename="([^"]+)"/.exec(cd);
      const suggestedName = m?.[1]
        ? decodeURIComponent(m[1])
        : `cut-download-${Date.now()}.zip`;

      const blob = await res.blob();

      // 降级方案：使用传统的下载方式
      const url = window.URL.createObjectURL(blob);
      const a = document.createElement("a");
      a.href = url;
      a.download = suggestedName;
      document.body.appendChild(a);
      a.click();
      a.remove();
      window.URL.revokeObjectURL(url);
      if (isMountedRef.current) {
        setToast({ type: "success", content: "下载已开始", id: Date.now() });
        setSelectedRowKeys([]);
      }
    } catch (e) {
      const anyErr = e as any;
      const name = anyErr?.name ? String(anyErr.name) : "";
      if (name === "AbortError") return;
      if (isMountedRef.current) {
        setToast({
          type: "error",
          content: e instanceof Error ? e.message : String(e),
          id: Date.now()
        });
      }
    } finally {
      if (downloadAbortRef.current === controller)
        downloadAbortRef.current = null;
      if (isMountedRef.current) setDownloading(false);
    }
  };

  const recordKeyToRow = useMemo(() => {
    const m = new Map<string, CutRecordItem>();
    for (const r of records) m.set(getUiRowKey(r), r);
    return m;
  }, [getUiRowKey, records]);

  const excludedKeysScoped = useMemo(() => {
    const keys = Object.keys(excludedKeys || {});
    if (!keys.length) return [];
    if (!selectedRowKeys.length) return keys;
    const selectedSet = new Set(selectedRowKeys);
    return keys.filter((k) => {
      const rowK = k.split("|", 1)[0];
      return rowK && selectedSet.has(rowK);
    });
  }, [excludedKeys, selectedRowKeys]);

  const selectedRows = useMemo(() => {
    return selectedRowKeys
      .map((k) => recordKeyToRow.get(k) || recordCacheRef.current.get(k))
      .filter(Boolean) as CutRecordItem[];
  }, [recordKeyToRow, selectedRowKeys]);

  const regenerateSelectedSquarePortrait = async () => {
    if (!selectedRows.length) {
      messageApi.warning("请先选择要重新生成的记录");
      return;
    }

    const isSquareOrPortrait = (ratio: string) => {
      const [wRaw, hRaw] = String(ratio || "").split(":");
      const w = Number(wRaw);
      const h = Number(hRaw);
      if (!Number.isFinite(w) || !Number.isFinite(h) || w <= 0 || h <= 0)
        return false;
      return w <= h; // 方图(=) + 竖图(<)
    };

    setRegenerating(true);
    try {
      const items: Array<{
        sourceUrl: string;
        ratio: string;
        templateName: string;
        appName?: string;
        lang?: string;
      }> = [];
      const dedupe = new Set<string>();

      for (const row of selectedRows) {
        if (!row?.sourceUrl) continue;
        const outs =
          row.outputs && typeof row.outputs === "object"
            ? row.outputs
            : undefined;
        if (!outs) continue;
        const rowK = getUiRowKey(row);

        for (const ratio of Object.keys(outs)) {
          if (!isSquareOrPortrait(ratio)) continue;
          const byTpl = (outs as any)[ratio] as
            | Record<string, CutRecordOutputItem>
            | undefined;
          if (!byTpl || typeof byTpl !== "object") continue;
          for (const templateName of Object.keys(byTpl)) {
            const k = `${rowK}|${ratio}|${templateName}`;
            if (dedupe.has(k)) continue;
            dedupe.add(k);
            items.push({
              sourceUrl: String(row.sourceUrl),
              ratio: String(ratio),
              templateName: String(templateName),
              appName: row.appName ? String(row.appName) : undefined,
              lang: row.lang ? String(row.lang) : undefined
            });
          }
        }
      }

      if (!items.length) {
        messageApi.warning("选中的记录里没有可重新生成的方/竖图输出");
        return;
      }

      const res = await fetch("/api/cut-jobs/start", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ items, concurrency: 64 })
      });
      const data = await res.json().catch(() => null);
      if (!res.ok || !data?.ok) {
        throw new Error((data as any)?.error || "重新生成失败");
      }

      try {
        const jobId = String((data as any)?.jobId || "").trim();
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

      messageApi.success(
        `已创建重新生成任务(方/竖): ${String(data.jobId || "") || "-"}`
      );
      fetchRecords();
    } catch (e) {
      messageApi.error(e instanceof Error ? e.message : String(e));
    } finally {
      setRegenerating(false);
    }
  };

  const regenerateExcluded = async () => {
    if (!excludedKeysScoped.length) {
      messageApi.warning(
        selectedRowKeys.length
          ? "选中记录中没有置灰的图片"
          : "当前没有置灰的图片"
      );
      return;
    }
    setRegenerating(true);
    try {
      const items: Array<{
        sourceUrl: string;
        ratio: string;
        templateName: string;
        appName?: string;
        lang?: string;
      }> = [];
      for (const k of excludedKeysScoped) {
        const [rowK, ratio, templateName] = k.split("|");
        if (!rowK || !ratio || !templateName) continue;
        const row =
          recordKeyToRow.get(rowK) || recordCacheRef.current.get(rowK);
        if (!row?.sourceUrl) continue;
        items.push({
          sourceUrl: String(row.sourceUrl),
          ratio: String(ratio),
          templateName: String(templateName),
          appName: row.appName ? String(row.appName) : undefined,
          lang: row.lang ? String(row.lang) : undefined
        });
      }
      if (!items.length) {
        messageApi.warning("没有可重新生成的图片");
        return;
      }

      const res = await fetch("/api/cut-jobs/start", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ items, concurrency: 64 })
      });
      const data = await res.json().catch(() => null);
      if (!res.ok || !data?.ok) {
        throw new Error((data as any)?.error || "重新生成失败");
      }

      try {
        const jobId = String((data as any)?.jobId || "").trim();
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

      setExcludedKeys((prev) => {
        const next = { ...(prev || {}) };
        for (const k of excludedKeysScoped) delete next[k];
        return next;
      });

      messageApi.success(
        `已创建重新生成任务: ${String(data.jobId || "") || "-"}`
      );
      fetchRecords();
    } catch (e) {
      messageApi.error(e instanceof Error ? e.message : String(e));
    } finally {
      setRegenerating(false);
    }
  };

  const toggleExclude = useCallback((k: string) => {
    setExcludedKeys((prev) => {
      const next = { ...prev };
      if (next[k]) delete next[k];
      else next[k] = true;
      return next;
    });
  }, []);

  const buildRowPreviewItems = useCallback(
    (row: CutRecordItem) => {
      const outs =
        row.outputs && typeof row.outputs === "object"
          ? row.outputs
          : undefined;
      if (!outs) return [];
      const rowK = getUiRowKey(row);
      const ratioOrder: Record<string, number> = {
        "1:1": 1,
        "4:5": 2,
        "16:9": 3,
        "9:16": 4
      };
      const ratios = Object.keys(outs).sort(
        (a, b) =>
          (ratioOrder[a] ?? 999) - (ratioOrder[b] ?? 999) || a.localeCompare(b)
      );
      const items: { k: string; url: string }[] = [];
      for (const ratio of ratios) {
        const byTpl = outs[ratio];
        if (!byTpl || typeof byTpl !== "object") continue;
        const tplNames = Object.keys(byTpl);
        const orderedTpls = getOrderedTemplates(ratio, tplNames);
        for (const tpl of orderedTpls) {
          const it = (byTpl as any)[tpl] as CutRecordOutputItem | undefined;
          const url = it?.outputUrl ? String(it.outputUrl) : "";
          if (!url) continue;
          items.push({ k: `${rowK}|${ratio}|${tpl}`, url });
        }
      }
      return items;
    },
    [getOrderedTemplates, getUiRowKey]
  );

  const openRowPreview = useCallback(
    (row: CutRecordItem, k: string) => {
      const items = buildRowPreviewItems(row);
      if (!items.length) return;
      const idx = Math.max(
        0,
        items.findIndex((x) => x.k === k)
      );
      setPreviewItems(items);
      setPreviewIndex(idx);
      setActivePreviewKey(items[idx]?.k || null);
      setPreviewOpen(true);
    },
    [buildRowPreviewItems]
  );

  useEffect(() => {
    fetchRecords();
  }, [fetchRecords]);

  useEffect(() => {
    (async () => {
      try {
        const res = await fetch("/api/app-names", { method: "GET" });
        const data = await res.json();
        if (!res.ok || !data?.ok) return;
        const arr = Array.isArray(data.items) ? data.items : [];
        setAppNameOptions(
          arr.map((x: string) => ({ label: String(x), value: String(x) }))
        );
      } catch {
        //
      }
    })();
  }, []);

  useEffect(() => {
    const onKeyDown = (e: KeyboardEvent) => {
      if (!previewOpen || !activePreviewKey) return;
      if (String(e.key || "").toLowerCase() !== "x") return;
      e.preventDefault();
      toggleExclude(activePreviewKey);
      if (previewItems.length <= 1) {
        setPreviewOpen(false);
        setActivePreviewKey(null);
        return;
      }
      const next = (previewIndex + 1) % previewItems.length;
      setPreviewIndex(next);
      setActivePreviewKey(previewItems[next]?.k || null);
    };
    window.addEventListener("keydown", onKeyDown);
    return () => window.removeEventListener("keydown", onKeyDown);
  }, [
    activePreviewKey,
    previewOpen,
    previewIndex,
    previewItems,
    toggleExclude
  ]);

  const ratioKeys = useMemo(() => {
    const set = new Set<string>();
    for (const r of records) {
      const outs =
        r.outputs && typeof r.outputs === "object" ? r.outputs : undefined;
      if (!outs) continue;
      for (const k of Object.keys(outs)) set.add(k);
    }
    const arr = [...set];
    if (!arr.length) return ["1:1", "4:5"];
    const order: Record<string, number> = {
      "1:1": 1,
      "4:5": 2,
      "16:9": 3,
      "9:16": 4
    };
    return arr.sort(
      (a, b) => (order[a] ?? 999) - (order[b] ?? 999) || a.localeCompare(b)
    );
  }, [records]);

  const columns = useMemo(() => {
    const base: any[] = [
      {
        title: "时间",
        dataIndex: "updatedAt",
        key: "updatedAt",
        width: 132,
        align: "center",
        render: (v: any, row: CutRecordItem) => {
          const s = v || row.createdAt ? String(v || row.createdAt) : "";
          if (!s) return <Typography.Text type="secondary">-</Typography.Text>;
          const d = new Date(s);
          if (Number.isNaN(d.getTime()))
            return <Typography.Text>{s}</Typography.Text>;
          return (
            <div style={{ lineHeight: 1.15 }}>
              <Typography.Text style={{ whiteSpace: "nowrap" }}>
                {d.toLocaleDateString()}
              </Typography.Text>
              <br />
              <Typography.Text
                type="secondary"
                style={{ whiteSpace: "nowrap" }}
              >
                {d.toLocaleTimeString()}
              </Typography.Text>
            </div>
          );
        }
      },
      {
        title: "状态",
        dataIndex: "status",
        key: "status",
        width: 60,
        align: "center"
      },
      {
        title: "原图",
        dataIndex: "sourceUrl",
        key: "sourceUrl",
        width: 240,
        align: "center",
        render: (v: any) => {
          const s = v ? String(v) : "";
          return s ? (
            <Image
              width={sourceThumbSize}
              style={{ height: "auto", display: "block", marginInline: "auto" }}
              src={s}
              alt={s}
            />
          ) : (
            <Typography.Text type="secondary">-</Typography.Text>
          );
        }
      }
    ];

    const ratioCols = ratioKeys.map((ratio) => ({
      title: ratio,
      key: `ratio:${ratio}`,
      // 比例列尽量窄：缩略图强制单行，超出在单元格内横向滚动
      width: Math.max(260, outputThumbSize * 2 + 16),
      align: "center",
      render: (_v: any, row: CutRecordItem) => {
        const calcThumbHeight = (ratioStr: string, w: number) => {
          const m = String(ratioStr || "")
            .trim()
            .match(/^(\d+(?:\.\d+)?)\s*:\s*(\d+(?:\.\d+)?)$/);
          const a = m?.[1] ? Number(m[1]) : NaN;
          const b = m?.[2] ? Number(m[2]) : NaN;
          if (!Number.isFinite(a) || !Number.isFinite(b) || a <= 0 || b <= 0)
            return Math.max(56, Math.floor(w * 0.75));
          return Math.max(56, Math.round((w * b) / a));
        };
        const thumbH = calcThumbHeight(ratio, outputThumbSize);

        const byTpl =
          row.outputs && row.outputs[ratio] ? row.outputs[ratio] : undefined;
        if (!byTpl || typeof byTpl !== "object")
          return <Typography.Text type="secondary">-</Typography.Text>;
        const tplNames = Object.keys(byTpl);
        const orderedTpls = getOrderedTemplates(ratio, tplNames);
        if (!orderedTpls.length)
          return <Typography.Text type="secondary">-</Typography.Text>;
        const items = orderedTpls.map((tpl) => {
          const it = (byTpl as any)[tpl] as CutRecordOutputItem | undefined;
          const url = it?.outputUrl ? String(it.outputUrl) : "";
          const err = it?.error ? String(it.error) : "";
          const st = it?.status ? String(it.status) : "";
          const k = `${getUiRowKey(row)}|${ratio}|${tpl}`;
          return { tpl, url, err, st, k };
        });
        return (
          <div
            className="cropRatioRow"
            style={{
              display: "flex",
              flexWrap: "nowrap",
              gap: 4,
              overflowX: "auto",
              overflowY: "hidden",
              justifyContent: "center"
            }}
          >
            {items.map((it) => {
              const disabled = !it.url;
              const title = `${it.tpl}${it.st ? ` (${it.st})` : ""}${
                it.err ? `: ${it.err}` : ""
              }`;
              return (
                <div
                  key={it.k}
                  title={title}
                  style={{
                    width: outputThumbSize,
                    lineHeight: 0,
                    filter: excludedKeys[it.k]
                      ? "grayscale(1) opacity(0.35)"
                      : undefined,
                    cursor: disabled ? "default" : "pointer"
                  }}
                  onContextMenu={(e) => {
                    e.preventDefault();
                    toggleExclude(it.k);
                  }}
                  onClick={() => {
                    if (!disabled) openRowPreview(row, it.k);
                  }}
                >
                  {it.url ? (
                    <Image
                      width={outputThumbSize}
                      style={{ height: "auto" }}
                      src={it.url}
                      alt={it.tpl}
                      preview={false}
                    />
                  ) : (
                    <div
                      style={{
                        width: outputThumbSize,
                        height: thumbH,
                        display: "flex",
                        alignItems: "center",
                        justifyContent: "center",
                        background: "rgba(0,0,0,0.03)",
                        border: "1px solid rgba(0,0,0,0.06)",
                        borderRadius: 6,
                        padding: 6,
                        boxSizing: "border-box"
                      }}
                    >
                      <Typography.Text
                        type="secondary"
                        style={{ fontSize: 11, lineHeight: 1.1 }}
                      >
                        {it.st || "-"}
                      </Typography.Text>
                    </div>
                  )}
                </div>
              );
            })}
          </div>
        );
      }
    }));

    base.push(...ratioCols);
    base.push(
      {
        title: "appName",
        dataIndex: "appName",
        key: "appName",
        width: isWideScreen ? 220 : 120,
        align: "center",
        render: (v: any) => {
          const s = v ? String(v) : "";
          return s ? (
            <Typography.Text
              title={s}
              style={{
                display: "block",
                maxWidth: "100%",
                whiteSpace: "normal",
                wordBreak: "break-word",
                lineHeight: 1.15
              }}
            >
              {s}
            </Typography.Text>
          ) : (
            <Typography.Text type="secondary">-</Typography.Text>
          );
        }
      },
      {
        title: "lang",
        dataIndex: "lang",
        key: "lang",
        width: 40,
        align: "center",
        render: (v: any) => {
          const s = v ? String(v) : "";
          return s ? (
            <Typography.Text>{s}</Typography.Text>
          ) : (
            <Typography.Text type="secondary">-</Typography.Text>
          );
        }
      }
    );
    base.push({
      title: "job",
      dataIndex: "jobId",
      key: "jobId",
      width: 50,
      align: "center",
      render: (v: any) => {
        const s = v ? String(v) : "";
        return s ? (
          <Typography.Link
            href={`/batch?jobId=${encodeURIComponent(s)}`}
            target="_blank"
            title={s}
            style={{
              display: "inline-block",
              maxWidth: "100%",
              whiteSpace: "nowrap"
            }}
          >
            跳转
          </Typography.Link>
        ) : (
          <Typography.Text type="secondary">-</Typography.Text>
        );
      }
    });

    return base;
  }, [
    excludedKeys,
    getOrderedTemplates,
    getUiRowKey,
    isWideScreen,
    openRowPreview,
    outputThumbSize,
    ratioKeys,
    sourceThumbSize,
    toggleExclude
  ]);

  return (
    <AdminShell defaultSelectedKey="/crop" headerTitle="裁图展示">
      {contextHolder}
      <Card styles={{ body: { padding: 8 } }}>
        <style jsx global>{`
          .cropTable .ant-table {
            font-size: 12px;
          }
          .cropTable .ant-table-thead > tr > th,
          .cropTable .ant-table-tbody > tr > td {
            padding: 4px 6px !important;
          }
          .cropTable .ant-typography {
            font-size: 12px;
          }
          /* 输出缩略图：强制单行，不换行（可横向滚动） */
          .cropTable .cropRatioRow::-webkit-scrollbar {
            height: 6px;
          }
          .cropTable .cropRatioRow::-webkit-scrollbar-thumb {
            background: rgba(0, 0, 0, 0.15);
            border-radius: 999px;
          }

          /* 固定底部横向滚动条（同步表格横向滚动） */
          .cropStickyHScroll {
            height: 12px;
            overflow-x: auto;
            overflow-y: hidden;
            background: rgba(255, 255, 255, 0.92);
            backdrop-filter: blur(6px);
            border-top: 1px solid rgba(0, 0, 0, 0.06);
          }
          .cropStickyHScroll::-webkit-scrollbar {
            height: 10px;
          }
          .cropStickyHScroll::-webkit-scrollbar-thumb {
            background: rgba(0, 0, 0, 0.18);
            border-radius: 999px;
          }
        `}</style>
        <Image.PreviewGroup
          items={previewItems.map((x) => x.url)}
          preview={{
            open: previewOpen,
            current: previewIndex,
            onOpenChange: (open, info: any) => {
              setPreviewOpen(open);
              if (!open) setActivePreviewKey(null);
              else {
                const c = typeof info?.current === "number" ? info.current : 0;
                setPreviewIndex(c);
                setActivePreviewKey(previewItems[c]?.k || null);
              }
            },
            onChange: (current: number) => {
              setPreviewIndex(current);
              setActivePreviewKey(previewItems[current]?.k || null);
            }
          }}
        />
        <Space wrap style={{ marginBottom: 8 }} size={8}>
          <Typography.Text strong>appName：</Typography.Text>
          <Select
            size="small"
            allowClear
            placeholder="全部"
            style={{ width: 180 }}
            value={appName || undefined}
            options={appNameOptions}
            showSearch={{
              filterOption: (input, option) =>
                (option?.label ?? "")
                  .toString()
                  .toLowerCase()
                  .includes((input || "").toLowerCase())
            }}
            onChange={(v) => {
              setAppName(String(v ?? ""));
              setCropPage(1);
            }}
          />
          <Typography.Text strong>lang：</Typography.Text>
          <Select
            size="small"
            allowClear
            placeholder="全部"
            style={{ width: 120 }}
            value={lang || undefined}
            options={SUPPORTED_LANGUAGES.map((x) => ({ label: x, value: x }))}
            showSearch={{
              filterOption: (input, option) =>
                (option?.label ?? "")
                  .toString()
                  .toLowerCase()
                  .includes((input || "").toLowerCase())
            }}
            onChange={(v) => {
              setLang(String(v ?? ""));
              setCropPage(1);
            }}
          />
          <Button
            size="small"
            icon={<ReloadOutlined />}
            onClick={fetchRecords}
            loading={recordsLoading}
          >
            刷新
          </Button>
          <Typography.Text type="secondary">
            {recordsLoading ? "加载中..." : `${recordsTotal} 条`}
          </Typography.Text>
          <Space size={6}>
            <Typography.Text type="secondary">起始序号</Typography.Text>
            <InputNumber
              size="small"
              min={1}
              value={downloadStartFolderIndex}
              onChange={(v) => setDownloadStartFolderIndex(Number(v || 1))}
            />
            <Typography.Text type="secondary">固定码</Typography.Text>
            <Input
              size="small"
              style={{ width: 90 }}
              value={downloadFixedCode}
              onChange={(e) => setDownloadFixedCode(e.target.value)}
            />
            <Typography.Text type="secondary">子文件夹</Typography.Text>
            <Switch
              size="small"
              checked={downloadWithSubfolders}
              onChange={(checked) => setDownloadWithSubfolders(checked)}
            />
            <Button
              size="small"
              type="primary"
              disabled={!selectedRowKeys.length}
              loading={downloading}
              onClick={downloadSelected}
            >
              下载选中({selectedRowKeys.length})
            </Button>
            <Button
              size="small"
              disabled={!selectedRowKeys.length}
              onClick={() => setSelectedRowKeys([])}
            >
              清空选择
            </Button>
            <Button
              size="small"
              disabled={!selectedRowKeys.length}
              loading={regenerating}
              onClick={regenerateSelectedSquarePortrait}
            >
              重新生成一组(选中{selectedRowKeys.length})
            </Button>
            <Button
              size="small"
              disabled={!excludedKeysScoped.length}
              loading={regenerating}
              onClick={regenerateExcluded}
            >
              重新生成置灰({excludedKeysScoped.length})
            </Button>
          </Space>
        </Space>
        <div
          ref={tableWrapRef}
          style={{ paddingBottom: stickyHScroll.visible ? 14 : 0 }}
        >
          <Table
            className="cropTable"
            size="small"
            rowKey={getUiRowKey}
            loading={recordsLoading}
            dataSource={records}
            pagination={{
              current: cropPage,
              pageSize: cropPageSize,
              total: recordsTotal,
              showSizeChanger: true,
              pageSizeOptions: ["10", "20", "50", "100"],
              showTotal: (total) => `共 ${total} 条`,
              onChange: (page, pageSize) => {
                setCropPage(page);
                if (pageSize !== cropPageSize) {
                  setCropPageSize(pageSize);
                  setCropPage(1);
                }
              }
            }}
            columns={columns}
            // 不强制按内容撑开整张表，1920 下尽量不出现表格外层左右滚动条
            scroll={{ x: 1600 }}
            rowSelection={{
              selectedRowKeys,
              onChange: (keys) => setSelectedRowKeys(keys as string[])
            }}
          />
        </div>

        {stickyHScroll.visible ? (
          <div
            ref={stickyHScrollRef}
            className="cropStickyHScroll"
            style={{
              position: "fixed",
              left: stickyHScroll.left,
              bottom: 0,
              width: stickyHScroll.width,
              zIndex: 999
            }}
          >
            {/* 只用来撑出 scrollWidth，从而生成滚动条 */}
            <div style={{ width: stickyHScroll.scrollWidth, height: 1 }} />
          </div>
        ) : null}
      </Card>
    </AdminShell>
  );
}
