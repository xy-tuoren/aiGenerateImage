import { NextResponse } from "next/server";
import { fetchAdCostMonthAllThenMatchAppNamesAndDownloadToPublicMaterial } from "@/lib/server/getReferenceImages";
import fs from "fs-extra";
import path from "path";
import { isImageFileName } from "@/lib/server/utils";

export const dynamic = "force-dynamic";

const CACHE_TTL_MS = 60_000;
let cachedAppDirs: { at: number; appDirs: string[] } | null = null;
const cachedFilesByApp = new Map<string, { at: number; files: string[] }>();

export async function GET(req: Request) {
  try {
    const { searchParams } = new URL(req.url);
    const namesOnly = searchParams.get("names") === "1";
    const folderPathOnly = searchParams.get("folderPath") === "1";
    const pathsForUrls = searchParams.get("paths") === "1";
    const qAppName = String(searchParams.get("appName") || "").trim();
    const urlsParam = searchParams.get("urls") || "";
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

    if (namesOnly) {
      return NextResponse.json({ ok: true, appNames: appDirs }, { headers: cacheHeaders });
    }

    const cwd = process.cwd();
    if (folderPathOnly && qAppName) {
      const exists = appDirs.includes(qAppName);
      if (!exists) {
        return NextResponse.json({ ok: false, error: "appName 不存在" }, { status: 400 });
      }
      const absFolder = path.join(publicMaterialDir, qAppName);
      const folderPath = path.relative(cwd, absFolder);
      return NextResponse.json({ ok: true, folderPath }, { headers: cacheHeaders });
    }

    if (pathsForUrls && qAppName && urlsParam) {
      const exists = appDirs.includes(qAppName);
      if (!exists) {
        return NextResponse.json({ ok: false, error: "appName 不存在" }, { status: 400 });
      }
      const urlList = urlsParam.split(",").map((u) => String(u || "").trim()).filter(Boolean);
      const paths: string[] = [];
      const appDir = path.join(publicMaterialDir, qAppName);
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
      const exists = appDirs.includes(qAppName);
      if (!exists) {
        return NextResponse.json({ ok: true, appNames: appDirs, appName: qAppName, page, pageSize, total: 0, images: [] }, { headers: cacheHeaders });
      }
      let all: string[] = [];
      const cached = cachedFilesByApp.get(qAppName);
      if (cached && now - cached.at < CACHE_TTL_MS) {
        all = cached.files;
      } else {
        const absDir = path.join(publicMaterialDir, qAppName);
        const names = await fs.readdir(absDir).catch(() => []);
        all = names
          .map((x) => String(x || "").trim())
          .filter((x) => x && isImageFileName(x))
          .sort((a, b) => a.localeCompare(b));
        cachedFilesByApp.set(qAppName, { at: now, files: all });
      }
      const total = all.length;
      const start = (page - 1) * pageSize;
      const slice = all.slice(start, start + pageSize).map((file) => `/material/${encodeURIComponent(qAppName)}/${encodeURIComponent(file)}`);
      return NextResponse.json({ ok: true, appNames: appDirs, appName: qAppName, page, pageSize, total, images: slice }, { headers: cacheHeaders });
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
