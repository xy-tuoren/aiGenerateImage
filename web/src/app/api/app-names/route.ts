import { NextResponse } from "next/server";
import * as fs from "fs-extra";
import { join } from "path";
import { requireApiAccess } from "@/lib/server/auth";
import { CUSTOM_APP_NAMES } from "./customAppNames";

const CACHE_TTL_MS = 60_000;
let mergedAppNamesCache: { at: number; items: string[] } | null = null;

async function readRemoteAdCostMonthFallbackAppNames(cwd: string) {
  try {
    const cacheDir = join(cwd, ".cache");
    const st = await fs.stat(cacheDir).catch(() => null);
    if (!st?.isDirectory()) return [];

    const names = await fs.readdir(cacheDir).catch(() => []);
    const targets = names
      .map((x) => String(x || "").trim())
      .filter((x) => /^adCostMonth\.byAppName\.[a-f0-9]{40}\.json$/i.test(x));
    if (!targets.length) return [];

    // 选取最新的一个缓存文件（按 mtime）
    let best: { name: string; mtimeMs: number } | null = null;
    for (const name of targets) {
      const abs = join(cacheDir, name);
      const st2 = await fs.stat(abs).catch(() => null);
      if (!st2?.isFile?.()) continue;
      const mtimeMs = typeof (st2 as any).mtimeMs === "number" ? (st2 as any).mtimeMs : 0;
      if (!best || mtimeMs > best.mtimeMs) best = { name, mtimeMs };
    }
    if (!best) return [];

    const absFile = join(cacheDir, best.name);
    const raw = await fs.readFile(absFile, "utf8").catch(() => "");
    if (!raw) return [];
    const json = JSON.parse(raw) as any;
    const data =
      json?.data && typeof json.data === "object" ? (json.data as Record<string, any>) : {};

    const out: string[] = [];
    for (const [k, bucket] of Object.entries(data)) {
      const appName = String(bucket?.app_name || k || "").trim();
      if (appName) out.push(appName);
    }
    return Array.from(new Set(out)).sort((a, b) => a.localeCompare(b));
  } catch {
    return [];
  }
}

export async function GET(req: Request) {
  try {
    const guard = requireApiAccess(req);
    if (!guard.ok) return NextResponse.json({ ok: false, error: guard.error }, { status: guard.status });

    const now = Date.now();
    if (mergedAppNamesCache && now - mergedAppNamesCache.at < CACHE_TTL_MS) {
      return NextResponse.json({ ok: true, items: mergedAppNamesCache.items });
    }

    const cwd = process.cwd();

    // 1) 本地：public/material 下的文件夹名
    const refImageDatasPath = join(cwd, "public", "material");
    const folderNames: string[] = [];
    const st = await fs.stat(refImageDatasPath).catch(() => null);
    if (st?.isDirectory()) {
      const folders = await fs.readdir(refImageDatasPath, { withFileTypes: true }).catch(() => []);
      for (const item of folders) {
        if (!item?.isDirectory?.()) continue;
        const name = String((item as any).name || "").trim();
        if (name) folderNames.push(name);
      }
    }

    // 2) 远端：.cache/referenceImages.remoteAppNames.json（兼容 array 或 {updatedAt,data}）
    const remoteAppNamesFile = join(cwd, ".cache", "referenceImages.remoteAppNames.json");
    const remoteRaw = await fs.readFile(remoteAppNamesFile, "utf8").catch(() => "");
    let remoteNames: string[] = [];
    if (remoteRaw) {
      try {
        const json = JSON.parse(remoteRaw) as any;
        const arr = Array.isArray(json) ? json : Array.isArray(json?.data) ? json.data : [];
        remoteNames = arr.map((x: any) => String(x || "").trim()).filter(Boolean);
      } catch {
        remoteNames = [];
      }
    }

    if (!remoteNames.length) {
      remoteNames = await readRemoteAdCostMonthFallbackAppNames(cwd);
    }

    const customNames = Array.isArray(CUSTOM_APP_NAMES)
      ? CUSTOM_APP_NAMES.map((x) => String(x || "").trim()).filter(Boolean)
      : [];

    const merged = Array.from(
      new Set([...folderNames, ...remoteNames, ...customNames])
    ).sort((a, b) => a.localeCompare(b));
    mergedAppNamesCache = { at: now, items: merged };
    return NextResponse.json({ ok: true, items: merged });
  } catch (error) {
    console.error("读取文件夹列表失败:", error);
    return NextResponse.json(
      { ok: false, error: error instanceof Error ? error.message : String(error) },
      { status: 500 }
    );
  }
}
