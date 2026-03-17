import { NextResponse } from "next/server";
import { fetchAdCostMonthAllThenMatchAppNamesAndDownloadToPublicMaterial } from "@/lib/server/getReferenceImages";
import fs from "fs-extra";
import path from "path";
import { isImageFileName } from "@/lib/server/utils";
import { requireApiAccess } from "@/lib/server/auth";

export const dynamic = "force-dynamic";

const CACHE_TTL_MS = 60_000;
const UPLOAD_APP_NAME = "reference-uploads";
let cachedAppDirs: { at: number; appDirs: string[] } | null = null;
const cachedFilesByApp = new Map<string, { at: number; files: string[] }>();
const cachedUploadSortedFilesByApp = new Map<string, { at: number; files: string[]; sourceAt: number; sourceCount: number }>();
let cachedRemoteAdCost: { at: number; appNames: string[]; byAppLower: Map<string, { appName: string; items: Array<{ url: string; cost?: number }> }> } | null = null;
let cachedRemoteAppNames: { at: number; appNames: string[] } | null = null;
let cachedRemoteIndex: { at: number; byAppLower: Map<string, { appName: string; items: Array<{ url: string; cost: number }> }> } | null = null;

async function readRemoteAppNamesCache() {
  const now = Date.now();
  if (cachedRemoteAppNames && now - cachedRemoteAppNames.at < CACHE_TTL_MS) return cachedRemoteAppNames;

  const cacheDir = path.join(process.cwd(), ".cache");
  const absFile = path.join(cacheDir, "referenceImages.remoteAppNames.json");
  const raw = await fs.readFile(absFile, "utf8").catch(() => "");
  if (!raw) {
    cachedRemoteAppNames = { at: now, appNames: [] };
    return cachedRemoteAppNames;
  }
  try {
    const json = JSON.parse(raw) as any;
    // 兼容两种格式：["a","b"] 或 {updatedAt, data:["a","b"]}
    const arr = Array.isArray(json) ? json : Array.isArray(json?.data) ? json.data : [];
    const appNames = arr
      .map((x: any) => String(x || "").trim())
      .filter(Boolean)
      .sort((a: string, b: string) => a.localeCompare(b));
    cachedRemoteAppNames = { at: now, appNames };
    return cachedRemoteAppNames;
  } catch {
    cachedRemoteAppNames = { at: now, appNames: [] };
    return cachedRemoteAppNames;
  }
}

async function readRemoteIndexCache() {
  const now = Date.now();
  if (cachedRemoteIndex && now - cachedRemoteIndex.at < CACHE_TTL_MS) return cachedRemoteIndex;

  const cacheDir = path.join(process.cwd(), ".cache");
  const absFile = path.join(cacheDir, "referenceImages.remoteIndex.json");
  const raw = await fs.readFile(absFile, "utf8").catch(() => "");
  if (!raw) {
    cachedRemoteIndex = { at: now, byAppLower: new Map() };
    return cachedRemoteIndex;
  }
  try {
    const json = JSON.parse(raw) as any;
    // 兼容两种格式：{[appName]: items[]} 或 {updatedAt, data:{[appName]: items[]}}
    const data =
      json?.data && typeof json.data === "object"
        ? (json.data as Record<string, any>)
        : json && typeof json === "object"
          ? (json as Record<string, any>)
          : {};
    const byAppLower = new Map<string, { appName: string; items: Array<{ url: string; cost: number }> }>();
    for (const [k, v] of Object.entries(data)) {
      const appName = String(k || "").trim();
      if (!appName) continue;
      const key = appName.toLowerCase();
      const itemsRaw = Array.isArray(v) ? v : Array.isArray((v as any)?.items) ? (v as any).items : [];
      const items = itemsRaw
        .map((it: any) => ({ url: String(it?.url || "").trim(), cost: typeof it?.cost === "number" && Number.isFinite(it.cost) ? it.cost : 0 }))
        .filter((x: any) => x.url);
      byAppLower.set(key, { appName, items });
    }
    cachedRemoteIndex = { at: now, byAppLower };
    return cachedRemoteIndex;
  } catch {
    cachedRemoteIndex = { at: now, byAppLower: new Map() };
    return cachedRemoteIndex;
  }
}

async function readRemoteAdCostMonthCache() {
  const now = Date.now();
  if (cachedRemoteAdCost && now - cachedRemoteAdCost.at < CACHE_TTL_MS) return cachedRemoteAdCost;

  const cacheDir = path.join(process.cwd(), ".cache");
  const st = await fs.stat(cacheDir).catch(() => null);
  if (!st || !st.isDirectory()) {
    cachedRemoteAdCost = { at: now, appNames: [], byAppLower: new Map() };
    return cachedRemoteAdCost;
  }

  const names = await fs.readdir(cacheDir).catch(() => []);
  const targets = names
    .map((x) => String(x || "").trim())
    .filter((x) => /^adCostMonth\.byAppName\.[a-f0-9]{40}\.json$/i.test(x));

  if (!targets.length) {
    cachedRemoteAdCost = { at: now, appNames: [], byAppLower: new Map() };
    return cachedRemoteAdCost;
  }

  // 选取最新的一个缓存文件（按 mtime）
  let best: { name: string; mtimeMs: number } | null = null;
  for (const name of targets) {
    const abs = path.join(cacheDir, name);
    const st2 = await fs.stat(abs).catch(() => null);
    if (!st2 || !st2.isFile()) continue;
    const mtimeMs = typeof st2.mtimeMs === "number" ? st2.mtimeMs : 0;
    if (!best || mtimeMs > best.mtimeMs) best = { name, mtimeMs };
  }

  if (!best) {
    cachedRemoteAdCost = { at: now, appNames: [], byAppLower: new Map() };
    return cachedRemoteAdCost;
  }

  const absFile = path.join(cacheDir, best.name);
  const raw = await fs.readFile(absFile, "utf8").catch(() => "");
  const json = (raw ? JSON.parse(raw) : null) as any;
  const data = json?.data && typeof json.data === "object" ? (json.data as Record<string, any>) : {};

  const appNames: string[] = [];
  const byAppLower = new Map<string, { appName: string; items: Array<{ url: string; cost?: number }> }>();

  for (const [k, bucket] of Object.entries(data)) {
    const appName = String(bucket?.app_name || k || "").trim();
    if (!appName) continue;
    const itemsRaw = Array.isArray(bucket?.items) ? bucket.items : [];
    const items = itemsRaw
      .map((it: any) => ({ url: String(it?.url || "").trim(), cost: typeof it?.cost === "number" ? it.cost : undefined }))
      .filter((x: any) => x.url);
    appNames.push(appName);
    byAppLower.set(appName.toLowerCase(), { appName, items });
  }

  appNames.sort((a, b) => a.localeCompare(b));
  cachedRemoteAdCost = { at: now, appNames, byAppLower };
  return cachedRemoteAdCost;
}

export async function GET(req: Request) {
  try {
    const guard = requireApiAccess(req);
    if (!guard.ok) return NextResponse.json({ ok: false, error: guard.error }, { status: guard.status });
    const { searchParams } = new URL(req.url);
    const namesOnly = searchParams.get("names") === "1";
    const folderPathOnly = searchParams.get("folderPath") === "1";
    const pathsForUrls = searchParams.get("paths") === "1";
    const qAppName = String(searchParams.get("appName") || "").trim();
    const qAppNameNorm = qAppName.toLowerCase();
    const urlsParam = searchParams.get("urls") || "";
    const sortByCostRaw = String(searchParams.get("sortByCost") || "default")
      .trim()
      .toLowerCase();
    const sortByCost: "default" | "asc" | "desc" =
      sortByCostRaw === "asc" ? "asc" : sortByCostRaw === "desc" ? "desc" : "default";
    const qPageRaw = Number(searchParams.get("page") || "1");
    const qPageSizeRaw = Number(searchParams.get("pageSize") || "100");
    const page = Number.isFinite(qPageRaw) && qPageRaw > 0 ? Math.floor(qPageRaw) : 1;
    const pageSize = Number.isFinite(qPageSizeRaw) && qPageSizeRaw > 0 ? Math.floor(qPageSizeRaw) : 100;

    const publicMaterialDir = path.join(process.cwd(), "public", "material");
    const st = await fs.stat(publicMaterialDir).catch(() => null);
    const materialDirOk = !!st && st.isDirectory();

    const now = Date.now();
    let appDirs: string[] = [];
    if (materialDirOk) {
      if (cachedAppDirs && now - cachedAppDirs.at < CACHE_TTL_MS) {
        appDirs = cachedAppDirs.appDirs;
      } else {
        const dirents = await fs.readdir(publicMaterialDir, { withFileTypes: true });
        appDirs = dirents
          .filter((d) => d.isDirectory())
          .map((d) => String(d.name || "").trim())
          .filter(Boolean)
          .sort((a, b) => a.localeCompare(b));
        cachedAppDirs = { at: now, appDirs };
      }
    }

    const cacheHeaders = { "cache-control": "public, max-age=60, stale-while-revalidate=300" };
    const resolvedAppName = qAppName ? (appDirs.find((x) => x.toLowerCase() === qAppNameNorm) || "") : "";

    if (namesOnly) {
      const remoteNames = await readRemoteAppNamesCache();
      const remoteFallback = remoteNames.appNames.length ? null : await readRemoteAdCostMonthCache();
      const remoteAppNames = remoteNames.appNames.length ? remoteNames.appNames : (remoteFallback?.appNames || []);
      const merged = Array.from(new Set([...(appDirs || []), ...remoteAppNames])).sort((a, b) => a.localeCompare(b));
      return NextResponse.json({ ok: true, appNames: merged }, { headers: cacheHeaders });
    }

    const cwd = process.cwd();
    if (folderPathOnly && qAppName) {
      if (!resolvedAppName) {
        return NextResponse.json({ ok: false, error: "appName 不存在" }, { status: 400 });
      }
      const absFolder = path.join(publicMaterialDir, resolvedAppName);
      const folderPath = path.relative(cwd, absFolder);
      return NextResponse.json({ ok: true, folderPath }, { headers: cacheHeaders });
    }

    if (pathsForUrls && qAppName && urlsParam) {
      if (!resolvedAppName) {
        return NextResponse.json({ ok: false, error: "appName 不存在" }, { status: 400 });
      }
      const urlList = urlsParam.split(",").map((u) => String(u || "").trim()).filter(Boolean);
      const paths: string[] = [];
      const appDir = path.join(publicMaterialDir, resolvedAppName);
      for (const u of urlList) {
        const match = u.match(/^\/material\/[^/]+\/(.+)$/);
        if (!match) continue;
        try {
          const filename = decodeURIComponent(match[1]);
          if (filename && isImageFileName(filename)) {
            paths.push(path.relative(cwd, path.join(appDir, filename)));
          }
        } catch {
          // skip invalid
        }
      }
      return NextResponse.json({ ok: true, paths }, { headers: cacheHeaders });
    }

    if (qAppName) {
      // 优先本地；本地没有该 app 目录时，fallback 到缓存里的远端 url
      if (!resolvedAppName) {
        const remoteIdx = await readRemoteIndexCache();
        const hit = remoteIdx.byAppLower.get(qAppNameNorm);
        const remoteNames = await readRemoteAppNamesCache();
        const remoteFallback = remoteNames.appNames.length ? null : await readRemoteAdCostMonthCache();
        const remoteAppNames = remoteNames.appNames.length ? remoteNames.appNames : (remoteFallback?.appNames || []);
        const mergedNames = Array.from(new Set([...(appDirs || []), ...remoteAppNames])).sort((a, b) => a.localeCompare(b));
        if (!hit) {
          const remote = await readRemoteAdCostMonthCache();
          const hit2 = remote.byAppLower.get(qAppNameNorm);
          const mergedNames2 = Array.from(new Set([...(appDirs || []), ...(remote.appNames || [])])).sort((a, b) => a.localeCompare(b));
          if (!hit2) {
            return NextResponse.json({ ok: true, appNames: mergedNames2, appName: qAppName, page, pageSize, total: 0, images: [] }, { headers: cacheHeaders });
          }

          const uniqUrl2 = new Set<string>();
          const list2 = (hit2.items || []).filter((x) => x?.url);
          const sorted2 =
            sortByCost === "default"
              ? [...list2].sort((a, b) => a.url.localeCompare(b.url))
              : [...list2].sort((a, b) => {
                const ca = typeof a.cost === "number" && Number.isFinite(a.cost) ? a.cost : null;
                const cb = typeof b.cost === "number" && Number.isFinite(b.cost) ? b.cost : null;
                const aHas = typeof ca === "number";
                const bHas = typeof cb === "number";
                if (aHas && !bHas) return -1;
                if (!aHas && bHas) return 1;
                if (!aHas && !bHas) return a.url.localeCompare(b.url);
                if (ca === cb) return a.url.localeCompare(b.url);
                return sortByCost === "asc" ? (ca! - cb!) : (cb! - ca!);
              });

          const urls2: string[] = [];
          for (const it of sorted2) {
            if (uniqUrl2.has(it.url)) continue;
            uniqUrl2.add(it.url);
            urls2.push(it.url);
          }

          const total2 = urls2.length;
          const start2 = (page - 1) * pageSize;
          const slice2 = urls2.slice(start2, start2 + pageSize);
          return NextResponse.json(
            { ok: true, appNames: mergedNames2, appName: hit2.appName, page, pageSize, total: total2, images: slice2 },
            { headers: cacheHeaders }
          );
        }

        const uniqUrl = new Set<string>();
        const list = (hit.items || []).filter((x) => x?.url);
        const sorted =
          sortByCost === "default"
            ? [...list].sort((a, b) => a.url.localeCompare(b.url))
            : [...list].sort((a, b) => {
              const ca = typeof a.cost === "number" && Number.isFinite(a.cost) ? a.cost : null;
              const cb = typeof b.cost === "number" && Number.isFinite(b.cost) ? b.cost : null;
              const aHas = typeof ca === "number";
              const bHas = typeof cb === "number";
              if (aHas && !bHas) return -1;
              if (!aHas && bHas) return 1;
              if (!aHas && !bHas) return a.url.localeCompare(b.url);
              if (ca === cb) return a.url.localeCompare(b.url);
              return sortByCost === "asc" ? (ca! - cb!) : (cb! - ca!);
            });

        const urls: string[] = [];
        for (const it of sorted) {
          if (uniqUrl.has(it.url)) continue;
          uniqUrl.add(it.url);
          urls.push(it.url);
        }

        const total = urls.length;
        const start = (page - 1) * pageSize;
        const slice = urls.slice(start, start + pageSize);
        return NextResponse.json(
          { ok: true, appNames: mergedNames, appName: hit.appName, page, pageSize, total, images: slice },
          { headers: cacheHeaders }
        );
      }

      let all: string[] = [];
      const absDir = path.join(publicMaterialDir, resolvedAppName);
      const isUploadApp = resolvedAppName.toLowerCase() === UPLOAD_APP_NAME;
      const cached = cachedFilesByApp.get(resolvedAppName);
      if (cached && now - cached.at < CACHE_TTL_MS) {
        all = cached.files;
      } else {
        const names = await fs.readdir(absDir).catch(() => []);
        // 注意：这里缓存“原始文件列表”，排序会受 sortByCost 影响（必须先排序再分页）
        all = names
          .map((x) => String(x || "").trim())
          .filter((x) => x && isImageFileName(x));
        cachedFilesByApp.set(resolvedAppName, { at: now, files: all });
      }

      const extractCostFromFilename = (filename: string): number | null => {
        const base = String(filename || "").trim();
        if (!base) return null;
        const stem = base.replace(/\.[^.]+$/, "");
        const parts = stem.split("-").map((x) => x.trim()).filter(Boolean);
        const isNum = (s: string) => /^\d+$/.test(s);
        // 参考图下载命名：{idPart}-{costInt}[ -{k} ].ext
        // - 优先取倒数第二段（当最后一段是并发/冲突后缀时）
        if (parts.length >= 3 && isNum(parts[parts.length - 1]!) && isNum(parts[parts.length - 2]!)) {
          return Number(parts[parts.length - 2]!);
        }
        if (parts.length >= 2 && isNum(parts[parts.length - 1]!)) {
          return Number(parts[parts.length - 1]!);
        }
        return null;
      };

      let sortedAll: string[] = [];
      if (isUploadApp) {
        const sourceAt = cached?.at ?? now;
        const sourceCount = all.length;
        const uploadCached = cachedUploadSortedFilesByApp.get(resolvedAppName);
        if (
          uploadCached &&
          now - uploadCached.at < CACHE_TTL_MS &&
          uploadCached.sourceAt === sourceAt &&
          uploadCached.sourceCount === sourceCount
        ) {
          sortedAll = uploadCached.files;
        } else {
          sortedAll = (
            await Promise.all(
              all.map(async (file) => {
                const st2 = await fs.stat(path.join(absDir, file)).catch(() => null);
                const mtimeMs = st2 && typeof st2.mtimeMs === "number" ? st2.mtimeMs : 0;
                return { file, mtimeMs };
              })
            )
          )
            .sort((a, b) => {
              if (a.mtimeMs !== b.mtimeMs) return b.mtimeMs - a.mtimeMs;
              return a.file.localeCompare(b.file);
            })
            .map((x) => x.file);
          cachedUploadSortedFilesByApp.set(resolvedAppName, { at: now, files: sortedAll, sourceAt, sourceCount });
        }
      } else {
        sortedAll = sortByCost === "default"
          ? [...all].sort((a, b) => a.localeCompare(b))
          : [...all].sort((a, b) => {
            const ca = extractCostFromFilename(a);
            const cb = extractCostFromFilename(b);
            const aHas = typeof ca === "number" && Number.isFinite(ca);
            const bHas = typeof cb === "number" && Number.isFinite(cb);
            // 没有 cost 的统一排到最后（不论 asc/desc）
            if (aHas && !bHas) return -1;
            if (!aHas && bHas) return 1;
            if (!aHas && !bHas) return a.localeCompare(b);
            if (ca === cb) return a.localeCompare(b);
            return sortByCost === "asc" ? ca! - cb! : cb! - ca!;
          });
      }

      const total = sortedAll.length;
      const start = (page - 1) * pageSize;
      const slice = sortedAll.slice(start, start + pageSize).map((file) => `/material/${encodeURIComponent(resolvedAppName)}/${encodeURIComponent(file)}`);
      return NextResponse.json(
        { ok: true, appNames: appDirs, appName: resolvedAppName, page, pageSize, total, images: slice },
        { headers: cacheHeaders }
      );
    }

    if (!materialDirOk) {
      return NextResponse.json({ ok: true, groups: [], totalApps: 0, totalImages: 0 }, { headers: cacheHeaders });
    }

    const groups: Array<{ appName: string; images: string[] }> = [];
    let totalImages = 0;

    for (const appName of appDirs) {
      const absDir = path.join(publicMaterialDir, appName);
      const names = await fs.readdir(absDir).catch(() => []);
      const images = names
        .map((x) => String(x || "").trim())
        .filter((x) => x && isImageFileName(x))
        .sort((a, b) => a.localeCompare(b))
        .map((file) => `/material/${encodeURIComponent(appName)}/${encodeURIComponent(file)}`);
      if (images.length) {
        groups.push({ appName, images });
        totalImages += images.length;
      }
    }

    return NextResponse.json({ ok: true, groups, totalApps: groups.length, totalImages }, { headers: cacheHeaders });
  } catch (e) {
    const message = e instanceof Error ? e.message : "未知错误";
    return NextResponse.json({ ok: false, error: message }, { status: 500 });
  }
}

export async function POST(req: Request) {
  try {
    const guard = requireApiAccess(req);
    if (!guard.ok) return NextResponse.json({ ok: false, error: guard.error }, { status: guard.status });
    const body = await req.json().catch(() => ({}));
    const downloadFiles = body?.downloadFiles !== false;
    const refreshDdAppDataCache = body?.refreshDdAppDataCache === true;
    console.log(
      `[reference-images] sync start forceRefresh=${body?.forceRefresh === true ? "1" : "0"} downloadFiles=${downloadFiles ? "1" : "0"} refreshDdAppDataCache=${refreshDdAppDataCache ? "1" : "0"}`
    );
    const result = await fetchAdCostMonthAllThenMatchAppNamesAndDownloadToPublicMaterial({
      forceRefresh: body?.forceRefresh === true,
      forceRefreshPackageMap: refreshDdAppDataCache,
      downloadFiles,
    });
    const appNames = Object.keys(result || {});
    let totalItems = 0;
    let totalFiles = 0;
    for (const k of appNames) {
      const bucket = (result as any)[k];
      totalItems += Array.isArray(bucket?.items) ? bucket.items.length : 0;
      totalFiles += Array.isArray(bucket?.local_files) ? bucket.local_files.length : 0;
    }
    return NextResponse.json({ ok: true, mode: downloadFiles ? "download" : "remote_only", appNames: appNames.length, totalItems, totalFiles });
  } catch (e) {
    const message = e instanceof Error ? e.message : "未知错误";
    console.error("[reference-images] sync failed", e);
    return NextResponse.json({ ok: false, error: message }, { status: 500 });
  }
}
