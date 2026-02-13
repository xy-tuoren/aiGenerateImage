import { NextResponse } from "next/server";
import { fetchAdCostMonthAllThenMatchAppNamesAndDownloadToPublicMaterial } from "@/lib/server/getReferenceImages";
import fs from "fs-extra";
import path from "path";
import { isImageFileName } from "@/lib/server/utils";
import { requireApiAccess } from "@/lib/server/auth";

export const dynamic = "force-dynamic";

const CACHE_TTL_MS = 60_000;
let cachedAppDirs: { at: number; appDirs: string[] } | null = null;
const cachedFilesByApp = new Map<string, { at: number; files: string[] }>();

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
    if (!st || !st.isDirectory()) {
      if (namesOnly) return NextResponse.json({ ok: true, appNames: [] });
      if (qAppName) return NextResponse.json({ ok: true, appNames: [], appName: qAppName, page, pageSize, total: 0, images: [] });
      return NextResponse.json({ ok: true, groups: [], totalApps: 0, totalImages: 0 });
    }

    const now = Date.now();
    let appDirs: string[] = [];
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

    const cacheHeaders = { "cache-control": "public, max-age=60, stale-while-revalidate=300" };
    const resolvedAppName = qAppName ? (appDirs.find((x) => x.toLowerCase() === qAppNameNorm) || "") : "";

    if (namesOnly) {
      return NextResponse.json({ ok: true, appNames: appDirs }, { headers: cacheHeaders });
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
      if (!resolvedAppName) {
        return NextResponse.json({ ok: true, appNames: appDirs, appName: qAppName, page, pageSize, total: 0, images: [] }, { headers: cacheHeaders });
      }
      let all: string[] = [];
      const cached = cachedFilesByApp.get(resolvedAppName);
      if (cached && now - cached.at < CACHE_TTL_MS) {
        all = cached.files;
      } else {
        const absDir = path.join(publicMaterialDir, resolvedAppName);
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

      const sortedAll =
        sortByCost === "default"
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
            return sortByCost === "asc" ? (ca! - cb!) : (cb! - ca!);
          });

      const total = sortedAll.length;
      const start = (page - 1) * pageSize;
      const slice = sortedAll.slice(start, start + pageSize).map((file) => `/material/${encodeURIComponent(resolvedAppName)}/${encodeURIComponent(file)}`);
      return NextResponse.json(
        { ok: true, appNames: appDirs, appName: resolvedAppName, page, pageSize, total, images: slice },
        { headers: cacheHeaders }
      );
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
    const result = await fetchAdCostMonthAllThenMatchAppNamesAndDownloadToPublicMaterial({
      forceRefresh: body?.forceRefresh === true,
    });
    const appNames = Object.keys(result || {});
    let totalItems = 0;
    let totalFiles = 0;
    for (const k of appNames) {
      const bucket = (result as any)[k];
      totalItems += Array.isArray(bucket?.items) ? bucket.items.length : 0;
      totalFiles += Array.isArray(bucket?.local_files) ? bucket.local_files.length : 0;
    }
    return NextResponse.json({ ok: true, appNames: appNames.length, totalItems, totalFiles });
  } catch (e) {
    const message = e instanceof Error ? e.message : "未知错误";
    return NextResponse.json({ ok: false, error: message }, { status: 500 });
  }
}
