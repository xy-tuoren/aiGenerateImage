import { MongoClient } from "mongodb";
import axios from "axios";
import fs from "fs-extra";
import path from "path";
import { createHash } from "crypto";
import * as asyncLib from "async";

function getAdminMongoUri() {
  const uri = process.env.ADMIN_MONGODB_URI || "";
  if (!uri) throw new Error("外部 MongoDB 未配置：请设置环境变量 ADMIN_MONGODB_URI");
  return uri;
}

function getAdminMongoDbName() {
  const dbName = process.env.ADMIN_MONGODB_DB || "";
  if (!dbName) throw new Error("外部 MongoDB 未配置：请设置环境变量 ADMIN_MONGODB_DB");
  return dbName;
}

export async function getAdminMongoClient() {
  const uri = getAdminMongoUri();
  const client = new MongoClient(uri);
  const maskedUri = uri.replace(/\/\/([^@/]+)@/, "//***:***@");
  console.log(`[reference-images] mongo connect start uri=${maskedUri}`);
  try {
    await client.connect();
    console.log("[reference-images] mongo connect success");
    return client;
  } catch (e) {
    const message = e instanceof Error ? e.message : String(e);
    console.error(`[reference-images] mongo connect failed error=${message}`);
    throw e;
  }
}

export function getAdminMongoDb(client: MongoClient) {
  return client.db(getAdminMongoDbName());
}

function formatYearMonth(d: Date) {
  const y = d.getFullYear();
  const m = String(d.getMonth() + 1).padStart(2, "0");
  return `${y}-${m}`;
}

function getPastYearMonthRange(now = new Date()) {
  const end = new Date(now.getFullYear(), now.getMonth(), 1);
  const start = new Date(end.getFullYear() - 1, end.getMonth(), 1);
  return { start_date: formatYearMonth(start), end_date: formatYearMonth(end) };
}

type AdCostMonthApiItem = {
  assets?: string[];
  final_urls?: string;
  category?: string;
  campaign_name?: string;
  cost?: number;
  [k: string]: unknown;
};

type AdCostMonthApiResponse = {
  message?: string;
  code?: number;
  success?: boolean;
  result?: { total?: number; data?: AdCostMonthApiItem[] };
  [k: string]: unknown;
};

export type AdCostMonthSimplifiedItem = {
  url: string;
  final_urls: string;
  category: string;
  campaign_name: string;
  project: string;
  cost: number;
};

const KIDS_CATEGORY = "KIDS";
const KIDS_APP_NAMES = ["Kids"] as const;

export async function fetchAdCostMonthAll(params?: {
  start_date?: string;
  end_date?: string;

  category?: string[];
  ad_type?: string[];
  sort_field?: string;
  sort_type?: "asc" | "desc";
  offset?: number;
}) {
  const range = getPastYearMonthRange();
  const start_date = params?.start_date || range.start_date;
  const end_date = params?.end_date || range.end_date;
  const category = Array.isArray(params?.category) && params!.category!.length ? params!.category! : ["APP"];
  const offsetRaw = typeof params?.offset === "number" && Number.isFinite(params.offset) && params.offset > 0 ? Math.floor(params.offset) : 100000;
  const offset = Math.min(offsetRaw, 100000);
  const ad_type = params?.ad_type || [
    "DEMAND_GEN_CAROUSEL_AD",
    "RESPONSIVE_DISPLAY_AD",
    "DEMAND_GEN_MULTI_ASSET_AD",
    "PERFORMANCE_MAX",
    "IMAGE_AD",
  ];
  const sort_field = params?.sort_field || "cost";
  const sort_type = params?.sort_type || "desc";

  const endpoint = "https://cern1.cc/api/ads/get_ad_cost_month";
  const all: AdCostMonthSimplifiedItem[] = [];

  let page = 1;
  let total = Number.POSITIVE_INFINITY;

  while (all.length < total) {
    const body = {
      start_date,
      end_date,
      category,
      ad_type,
      date_type: "month",
      page,
      offset,
      sort_field,
      sort_type,
    };

    const headers: Record<string, string> = { "content-type": "application/json" };
    const cookie = process.env.CERN1_COOKIE || "";
    if (cookie) headers["cookie"] = cookie;
    const apiKey = process.env.X_API_KEY || "";
    if (apiKey) headers["X-API-KEY"] = apiKey;

    console.log(
      `[reference-images] query start endpoint=${endpoint} page=${page} category=${JSON.stringify(category)} start=${start_date} end=${end_date} offset=${offset}`
    );
    const res = await axios.post<AdCostMonthApiResponse>(endpoint, body, {
      headers,
      validateStatus: () => true,
    });
    const json = res.data || null;

    if (res.status < 200 || res.status >= 300 || !json || json.success !== true || (typeof json.code === "number" && json.code !== 200)) {
      const msg = json?.message || `请求失败：${res.status} ${res.statusText || ""}`.trim();
      throw new Error(msg);
    }

    const pageTotal = typeof json.result?.total === "number" ? json.result?.total : 0;
    const data = Array.isArray(json.result?.data) ? json.result!.data! : [];
    console.log(
      `[reference-images] query end endpoint=${endpoint} page=${page} status=${res.status} pageData=${data.length} total=${pageTotal}`
    );

    total = pageTotal;

    for (const item of data) {
      const assets = Array.isArray(item?.assets) ? item.assets : [];
      const url = typeof assets[0] === "string" ? assets[0] : "";
      all.push({
        url,
        final_urls: typeof item?.final_urls === "string" ? item.final_urls : "",
        category: typeof item?.category === "string" ? item.category : "",
        campaign_name:
          typeof item?.campaign_name === "string"
            ? item.campaign_name
            : "",
        project: typeof item?.project === "string" ? item.project : "",
        cost: typeof item?.cost === "number" ? item.cost : 0,
      });
    }

    if (!data.length) break;
    page += 1;
  }

  return all;
}

export async function fetchPackageIdToAppNamesMap(params?: {
  site?: string[];
  packageIds?: string[];
  cacheMaxAgeMs?: number;
  forceRefresh?: boolean;
}) {
  const sitesRaw = Array.isArray(params?.site) ? params.site : [];
  const sites = Array.from(new Set(sitesRaw.map((x) => String(x || "").trim()).filter(Boolean)));
  const packageIdsRaw = Array.isArray(params?.packageIds) ? params.packageIds : [];
  const packageIds = Array.from(new Set(packageIdsRaw.map((x) => String(x || "").trim()).filter(Boolean)));
  if (!packageIds.length) {
    console.log("[reference-images] mongo map skip: empty packageIds");
    return {};
  }

  const forceRefresh = params?.forceRefresh === true;
  const sitesKey = createHash("sha1").update(JSON.stringify(sites)).digest("hex");
  const cacheDir = path.join(process.cwd(), ".cache");
  const cacheFile = path.join(cacheDir, `packageIdToAppNamesMap.${sitesKey}.json`);
  let cachedAll: Record<string, string[]> = {};
  console.log(
    `[reference-images] mongo map start db=appsite col=dd_app_data sites=${sites.length} packageIds=${packageIds.length} forceRefresh=${forceRefresh ? "1" : "0"}`
  );
  if (!forceRefresh) {
    const cached = await readPackageIdToAppNamesMapCache(cacheFile, Number.POSITIVE_INFINITY);
    if (cached && typeof cached === "object") {
      cachedAll = cached;
      const missingPkgIds = packageIds.filter((pkg) => !Object.prototype.hasOwnProperty.call(cachedAll, pkg));
      console.log(
        `[reference-images] mongo map cache hit file=${path.basename(cacheFile)} packageIds=${Object.keys(cachedAll).length} missing=${missingPkgIds.length}`
      );
      if (!missingPkgIds.length) {
        const out: Record<string, string[]> = {};
        for (const pkg of packageIds) {
          out[pkg] = Array.isArray(cachedAll[pkg]) ? cachedAll[pkg] : [];
        }
        return out;
      }
    } else {
      console.log(`[reference-images] mongo map cache miss file=${path.basename(cacheFile)}`);
    }
  }

  const packageIdsToQuery = forceRefresh
    ? packageIds
    : packageIds.filter((pkg) => !Object.prototype.hasOwnProperty.call(cachedAll, pkg));
  if (!packageIdsToQuery.length) {
    const out: Record<string, string[]> = {};
    for (const pkg of packageIds) {
      out[pkg] = Array.isArray(cachedAll[pkg]) ? cachedAll[pkg] : [];
    }
    return out;
  }

  const client = await getAdminMongoClient();
  try {
    const db = client.db("appsite");
    const col = db.collection<{ package_id?: string; app_name?: string; site?: string }>("dd_app_data");
    const query: Record<string, unknown> = {
      package_id: { $in: packageIdsToQuery },
      app_name: { $type: "string", $ne: "" },
    };
    if (sites.length) query["site"] = { $in: sites };
    console.log(`[reference-images] mongo query start filter=${JSON.stringify(query)}`);
    const cursor = col.find(query, { projection: { _id: 0, package_id: 1, app_name: 1 } });
    const map: Record<string, string[]> = forceRefresh ? {} : { ...cachedAll };
    if (!forceRefresh) {
      for (const pkg of packageIdsToQuery) {
        if (!Object.prototype.hasOwnProperty.call(map, pkg)) map[pkg] = [];
      }
    }
    let docCount = 0;
    for await (const doc of cursor) {
      docCount += 1;
      const package_id = typeof doc?.package_id === "string" ? doc.package_id : "";
      const app_name = normalizeAppName(typeof doc?.app_name === "string" ? doc.app_name : "");
      if (!package_id || !app_name) continue;
      const arr = map[package_id] || (map[package_id] = []);
      if (!arr.includes(app_name)) arr.push(app_name);
    }
    const packageCount = Object.keys(map).length;
    const appNameCount = Object.values(map).reduce((n, arr) => n + arr.length, 0);
    console.log(
      `[reference-images] mongo query end docs=${docCount} queried=${packageIdsToQuery.length} packageIds=${packageCount} mappedAppNames=${appNameCount}`
    );
    await writePackageIdToAppNamesMapCache(cacheDir, cacheFile, map);
    console.log(`[reference-images] mongo map cache write file=${path.basename(cacheFile)} packageIds=${packageCount}`);
    const out: Record<string, string[]> = {};
    for (const pkg of packageIds) {
      out[pkg] = Array.isArray(map[pkg]) ? map[pkg] : [];
    }
    return out;
  } finally {
    await client.close();
  }
}

async function readPackageIdToAppNamesMapCache(cacheFile: string, maxAgeMs: number) {
  try {
    const raw = await fs.readFile(cacheFile, "utf8");
    const json = JSON.parse(raw) as { updatedAt?: number; data?: Record<string, string[]> } | null;
    if (!json || typeof json.updatedAt !== "number" || !json.data) return null;
    if (maxAgeMs === 0) return null;
    if (Date.now() - json.updatedAt > maxAgeMs) return null;
    return json.data;
  } catch {
    return null;
  }
}

async function writePackageIdToAppNamesMapCache(cacheDir: string, cacheFile: string, data: Record<string, string[]>) {
  await fs.ensureDir(cacheDir);
  const payload = JSON.stringify({ updatedAt: Date.now(), data });
  await fs.writeFile(cacheFile, payload, "utf8");
  await keepLatestCacheFiles(cacheDir, "packageIdToAppNamesMap.", 1);
}

async function keepLatestCacheFiles(cacheDir: string, prefix: string, keep: number) {
  try {
    const names = await fs.readdir(cacheDir);
    const targets = names
      .map((x) => String(x || "").trim())
      .filter((name) => name.startsWith(prefix) && name.endsWith(".json"));
    if (targets.length <= keep) return;
    const files: Array<{ name: string; mtimeMs: number }> = [];
    for (const name of targets) {
      const abs = path.join(cacheDir, name);
      const st = await fs.stat(abs).catch(() => null);
      if (!st || !st.isFile()) continue;
      files.push({ name, mtimeMs: typeof st.mtimeMs === "number" ? st.mtimeMs : 0 });
    }
    files.sort((a, b) => (b.mtimeMs - a.mtimeMs) || b.name.localeCompare(a.name));
    const toDelete = files.slice(Math.max(0, keep));
    for (const f of toDelete) {
      await fs.remove(path.join(cacheDir, f.name)).catch(() => undefined);
    }
  } catch {
    // ignore cache prune failures
  }
}

function normalizeAppName(input: string) {
  const raw = (input || "").trim();
  if (!raw) return "";
  return raw
    .replace(/[\u2028\u2029\u0085\r\n]+/g, " ")
    .replace(/[\u202A-\u202E\u2066-\u2069\u200E\u200F]/g, "")
    .replace(/\s+/g, " ")
    .trim();
}

function safeUrlBasename(input: string) {
  const base = normalizeAppName(input);
  if (!base) return "";
  return base.replace(/[\\/:*?"<>|\r\n\u2028\u2029\u0085]/g, "_").slice(0, 120);
}

function pickExtFromUrlOrContentType(url: string, contentType?: string) {
  const u = (url || "").trim();
  const m = u.match(/\.(png|jpe?g|webp|gif|bmp|svg)(?:[?#].*)?$/i);
  if (m?.[1]) return `.${m[1].toLowerCase()}`;
  const ct = (contentType || "").toLowerCase();
  if (ct.includes("image/png")) return ".png";
  if (ct.includes("image/jpeg")) return ".jpg";
  if (ct.includes("image/webp")) return ".webp";
  if (ct.includes("image/gif")) return ".gif";
  if (ct.includes("image/bmp")) return ".bmp";
  if (ct.includes("image/svg+xml")) return ".svg";
  return ".jpg";
}

function extractPackageIdFromFinalUrls(final_urls: string) {
  const raw = (final_urls || "").trim();
  if (!raw) return "";
  const noHash = raw.split("#")[0] || "";
  const noQuery = noHash.split("?")[0] || "";
  const parts = noQuery.split("/").filter(Boolean);
  const last = parts.length ? parts[parts.length - 1] : "";
  return last.trim();
}

function extractLastPathSegmentFromUrl(input: string) {
  const raw = (input || "").trim();
  if (!raw) return "";
  try {
    const u = new URL(raw);
    const parts = u.pathname.split("/").filter(Boolean);
    const last = parts.length ? parts[parts.length - 1] : "";
    return (last || "").trim();
  } catch {
    const noHash = raw.split("#")[0] || "";
    const noQuery = noHash.split("?")[0] || "";
    const parts = noQuery.split("/").filter(Boolean);
    const last = parts.length ? parts[parts.length - 1] : "";
    return (last || "").trim();
  }
}

function formatCostForFilename(cost: number) {
  const costInt = Number.isFinite(cost) ? Math.round(cost) : 0;
  return { costInt };
}

async function readJsonCache<T>(cacheFile: string, maxAgeMs: number) {
  try {
    const raw = await fs.readFile(cacheFile, "utf8");
    const json = JSON.parse(raw) as { updatedAt?: number; data?: T } | null;
    if (!json || typeof json.updatedAt !== "number" || typeof json.data === "undefined") return null;
    if (maxAgeMs === 0) return null;
    if (Date.now() - json.updatedAt > maxAgeMs) return null;
    return json.data;
  } catch {
    return null;
  }
}

async function writeJsonCache<T>(cacheDir: string, cacheFile: string, data: T) {
  await fs.ensureDir(cacheDir);
  const payload = JSON.stringify({ updatedAt: Date.now(), data });
  await fs.writeFile(cacheFile, payload, "utf8");
  const name = path.basename(cacheFile);
  if (name.startsWith("adCostMonth.byAppName.")) {
    await keepLatestCacheFiles(cacheDir, "adCostMonth.byAppName.", 1);
  }
}

export type AdCostMonthWithAppNamesItem = AdCostMonthSimplifiedItem & {
  package_id: string;
  app_names: string[];
};

export type AdCostMonthByAppNameCache = Record<string, { app_name: string; items: AdCostMonthWithAppNamesItem[]; local_files: string[] }>;

export async function fetchAdCostMonthAllThenMatchAppNamesAndDownloadToPublicMaterial(params?: {
  start_date?: string;
  end_date?: string;
  category?: string[];
  ad_type?: string[];
  sort_field?: string;
  sort_type?: "asc" | "desc";
  offset?: number;
  cacheMaxAgeMs?: number;
  forceRefresh?: boolean;
  /** 仅强制刷新 packageIdToAppNamesMap（appsite.dd_app_data 映射缓存） */
  forceRefreshPackageMap?: boolean;
  /** 是否下载图片到 public/material。false 时仅更新远端映射文件（remoteAppNames/remoteIndex） */
  downloadFiles?: boolean;
  downloadConcurrency?: number;
  downloadTimeoutMs?: number;
  progressEvery?: number;
}) {
  const requestedCategories = Array.isArray(params?.category)
    ? params!.category!.map((x) => String(x || "").trim().toUpperCase()).filter(Boolean)
    : [];
  const includeKidsFromExtraFetch = requestedCategories.length === 0;

  const cacheMaxAgeMs =
    typeof params?.cacheMaxAgeMs === "number" && Number.isFinite(params.cacheMaxAgeMs) && params.cacheMaxAgeMs >= 0 ? params.cacheMaxAgeMs : 24 * 60 * 60 * 1000;
  const forceRefresh = params?.forceRefresh === true;
  const forceRefreshPackageMap = params?.forceRefreshPackageMap === true;
  const downloadFiles = params?.downloadFiles !== false;
  const downloadConcurrency =
    typeof params?.downloadConcurrency === "number" && Number.isFinite(params.downloadConcurrency) && params.downloadConcurrency > 0 ? Math.floor(params.downloadConcurrency) : 64;
  const downloadTimeoutMs =
    typeof params?.downloadTimeoutMs === "number" && Number.isFinite(params.downloadTimeoutMs) && params.downloadTimeoutMs > 0 ? Math.floor(params.downloadTimeoutMs) : 30_000;
  const progressEveryRaw = typeof params?.progressEvery === "number" && Number.isFinite(params.progressEvery) && params.progressEvery > 0 ? Math.floor(params.progressEvery) : 20;
  const progressEvery = Math.min(Math.max(progressEveryRaw, 1), 1000);

  const cacheDir = path.join(process.cwd(), ".cache");
  const cacheKey = createHash("sha1")
    .update(
      JSON.stringify({
        start_date: params?.start_date || null,
        end_date: params?.end_date || null,
        category: params?.category || null,
        includeKidsFromExtraFetch,
        ad_type: params?.ad_type || null,
        sort_field: params?.sort_field || null,
        sort_type: params?.sort_type || null,
        offset: params?.offset || null,
      })
    )
    .digest("hex");
  const cacheFile = path.join(cacheDir, `adCostMonth.byAppName.${cacheKey}.json`);
  const remoteAppNamesCacheFile = path.join(cacheDir, "referenceImages.remoteAppNames.json");
  const remoteIndexCacheFile = path.join(cacheDir, "referenceImages.remoteIndex.json");

  let byAppName: AdCostMonthByAppNameCache | null = null;
  if (!forceRefresh) {
    const cached = await readJsonCache<AdCostMonthByAppNameCache>(cacheFile, cacheMaxAgeMs);
    if (cached) byAppName = cached;
  }

  if (!byAppName) {
    const all = await fetchAdCostMonthAll(params);
    console.log(`[reference-images] default query done items=${all.length}`);
    if (includeKidsFromExtraFetch) {
      console.log(`[reference-images] kids query start category=${KIDS_CATEGORY}`);
      const kids = await fetchAdCostMonthAll({ ...params, category: [KIDS_CATEGORY] }); 
      console.log(`[reference-images] kids query end category=${KIDS_CATEGORY} items=${kids.length}`);
      all.push(...kids);
    }

    const appItems = all.filter((x) => String(x?.category || "").trim().toUpperCase() !== KIDS_CATEGORY);
    const sites = Array.from(new Set(appItems.map((x) => (x?.project || "").trim()).filter(Boolean)));
    const packageIds = Array.from(
      new Set(
        appItems
          .map((x) => extractPackageIdFromFinalUrls(x.final_urls))
          .map((x) => x.trim())
          .filter(Boolean)
      )
    );
    const packageIdToAppNamesMap = packageIds.length
      ? await fetchPackageIdToAppNamesMap({
        site: sites,
        packageIds,
        forceRefresh: forceRefresh || forceRefreshPackageMap,
      })
      : {};

    byAppName = {};
    for (const it of all) {
      const isKidsItem = String(it?.category || "").trim().toUpperCase() === KIDS_CATEGORY;
      const package_id = isKidsItem ? "" : extractPackageIdFromFinalUrls(it.final_urls);
      const app_names = isKidsItem ? [...KIDS_APP_NAMES] : package_id ? packageIdToAppNamesMap[package_id] || [] : [];
      const item: AdCostMonthWithAppNamesItem = {
        url: it.url,
        final_urls: it.final_urls,
        category: it.category,
        campaign_name: it.campaign_name,
        project: it.project,
        cost: it.cost,
        package_id,
        app_names,
      };
      for (const app_name of app_names) {
        const key = normalizeAppName(app_name);
        if (!key) continue;
        const bucket = byAppName[key] || (byAppName[key] = { app_name: key, items: [], local_files: [] });
        bucket.items.push(item);
      }
    }

    await writeJsonCache(cacheDir, cacheFile, byAppName);
  }

  // 兼容旧缓存：避免 local_files 缺失导致下载流程报错
  for (const [k, bucket] of Object.entries(byAppName)) {
    if (!bucket || typeof bucket !== "object") continue;
    if (bucket.app_name !== k) bucket.app_name = k;
    if (!Array.isArray(bucket.items)) bucket.items = [];
    if (!Array.isArray(bucket.local_files)) bucket.local_files = [];
  }

  // 兼容旧缓存：items 中可能缺少 package_id / app_names，允许使用 final_urls 补齐
  try {
    const nonKidsItems = Object.values(byAppName)
      .flatMap((b) => (Array.isArray(b?.items) ? b.items : []))
      .filter((it: any) => String(it?.category || "").trim().toUpperCase() !== KIDS_CATEGORY);
    const sitesAll = Array.from(new Set(nonKidsItems.map((it: any) => (typeof it?.project === "string" ? it.project.trim() : "")).filter(Boolean)));
    const packageIdsAll = Array.from(
      new Set(
        nonKidsItems
          .map((it: any) => {
            const pkg = typeof it?.package_id === "string" ? it.package_id.trim() : "";
            if (pkg) return pkg;
            const finalUrls = typeof it?.final_urls === "string" ? it.final_urls : "";
            return extractPackageIdFromFinalUrls(finalUrls).trim();
          })
          .filter(Boolean)
      )
    );
    const packageIdToAppNamesMap = packageIdsAll.length
      ? await fetchPackageIdToAppNamesMap({
        site: sitesAll,
        packageIds: packageIdsAll,
        forceRefresh: forceRefresh || forceRefreshPackageMap,
      })
      : {};
    for (const bucket of Object.values(byAppName)) {
      if (!bucket || typeof bucket !== "object") continue;
      const items = Array.isArray((bucket as any).items) ? ((bucket as any).items as any[]) : [];
      for (const it of items) {
        if (!it || typeof it !== "object") continue;
        const isKidsItem = String(it?.category || "").trim().toUpperCase() === KIDS_CATEGORY;
        if (isKidsItem) {
          it.package_id = "";
          if (!Array.isArray(it.app_names) || !it.app_names.length) {
            it.app_names = [...KIDS_APP_NAMES];
          }
          continue;
        }
        const hasPkg = typeof it.package_id === "string" && it.package_id.trim();
        const finalUrls = typeof it.final_urls === "string" ? it.final_urls : "";
        if (!hasPkg && finalUrls) {
          it.package_id = extractPackageIdFromFinalUrls(finalUrls);
        }
        if (!Array.isArray(it.app_names)) {
          const pkg = typeof it.package_id === "string" ? it.package_id.trim() : "";
          it.app_names = pkg ? packageIdToAppNamesMap[pkg] || [] : [];
        }
        if (typeof it.campaign_name !== "string") {
          it.campaign_name = "";
        }
        if (typeof it.category !== "string") {
          it.category = "";
        }
      }
    }
  } catch {
    // ignore
  }

  // 为参考图广场 names=1 提供一个很小的 appName 列表缓存，避免解析大文件
  try {
    const uniq = new Set<string>();
    for (const bucket of Object.values(byAppName)) {
      const n = String(bucket?.app_name || "").trim();
      if (n) uniq.add(n);
    }
    const remoteAppNames = Array.from(uniq).sort((a, b) => a.localeCompare(b));
    // 优化格式：直接写 array，不包 updatedAt/data
    await fs.ensureDir(cacheDir);
    await fs.writeFile(remoteAppNamesCacheFile, JSON.stringify(remoteAppNames), "utf8");
  } catch {
    // ignore cache write failure
  }

  // 为参考图广场远端 fallback 提供一个更小的索引：appName -> items:[{url,cost,campaign_name,category}]
  try {
    const index: Record<string, Array<{ url: string; cost: number; campaign_name: string; category: string }>> = {};
    for (const bucket of Object.values(byAppName)) {
      const appName = String(bucket?.app_name || "").trim();
      if (!appName) continue;
      const itemsRaw = Array.isArray(bucket?.items) ? bucket.items : [];
      const seenUrl = new Set<string>();
      const items: Array<{ url: string; cost: number; campaign_name: string; category: string }> = [];
      for (const it of itemsRaw as any[]) {
        const url = String(it?.url || "").trim();
        if (!url) continue;
        if (seenUrl.has(url)) continue;
        seenUrl.add(url);
        const cost = typeof it?.cost === "number" && Number.isFinite(it.cost) ? it.cost : 0;
        const campaign_name = typeof it?.campaign_name === "string" ? it.campaign_name : "";
        const category = typeof it?.category === "string" ? it.category : "";
        items.push({ url, cost, campaign_name, category });
      }
      index[appName] = items;
    }
    // 优化格式：直接写 object，不包 updatedAt/data
    await fs.ensureDir(cacheDir);
    await fs.writeFile(remoteIndexCacheFile, JSON.stringify(index), "utf8");
  } catch {
    // ignore cache write failure
  }

  if (!downloadFiles) {
    console.log("[reference-images] download disabled: only write remote mapping files");
    return byAppName;
  }

  const publicMaterialDir = path.join(process.cwd(), "public", "material");
  await fs.ensureDir(publicMaterialDir);

  const rawDownloadJobs: Array<{ app_name: string; url: string; cost: number }> = [];
  for (const [app_name, bucket] of Object.entries(byAppName)) {
    for (const it of bucket.items) {
      const url = (it?.url || "").trim();
      if (!url) continue;
      rawDownloadJobs.push({ app_name, url, cost: it.cost });
    }
  }

  // 同一 app 下，只按“前缀数字 idPart”去重，避免并发时重复下载不同 cost 的同一张图
  const downloadJobs: Array<{ app_name: string; url: string; cost: number }> = [];
  const seenAppId = new Set<string>();
  for (const job of rawDownloadJobs) {
    const safeAppName = safeUrlBasename(job.app_name) || "unknown";
    const lastSeg = extractLastPathSegmentFromUrl(job.url);
    const idPart =
      (lastSeg.match(/^(\d+)/)?.[1] || "").trim() || createHash("sha1").update(job.url).digest("hex").slice(0, 16);
    const key = `${safeAppName}::${idPart}`;
    if (seenAppId.has(key)) continue;
    seenAppId.add(key);
    downloadJobs.push(job);
  }

  const totalJobs = downloadJobs.length;
  let done = 0;
  let success = 0;
  let skipped = 0;
  let failed = 0;
  const startedAt = Date.now();
  console.log(`[reference-images] 开始下载: total=${totalJobs} concurrency=${downloadConcurrency}`);

  // 避免“刷新后 cost 变化导致文件名变化”而重复下载同一张图：按 url 派生的 idPart 做去重
  const appDirIdPartToFilenameCache = new Map<string, Map<string, string>>();
  const getIdPartToFilenameMap = async (appDir: string) => {
    const cached = appDirIdPartToFilenameCache.get(appDir);
    if (cached) return cached;
    const map = new Map<string, string>();
    try {
      const names = await fs.readdir(appDir);
      for (const name of names) {
        const base = String(name || "").trim();
        if (!base) continue;
        const m = base.match(/^(\d+)/);
        const idPart = (m?.[1] || "").trim();
        if (!idPart) continue;
        if (!map.has(idPart)) map.set(idPart, base);
      }
    } catch {
      // ignore
    }
    appDirIdPartToFilenameCache.set(appDir, map);
    return map;
  };

  await asyncLib.eachLimit(downloadJobs, downloadConcurrency, async (job) => {
    let outcome: "success" | "skipped" | "failed" = "failed";
    try {
      const safeAppName = safeUrlBasename(job.app_name) || "unknown";
      const appDir = path.join(publicMaterialDir, safeAppName);
      await fs.ensureDir(appDir);
      const url = job.url;
      const lastSeg = extractLastPathSegmentFromUrl(url);
      const idPart =
        (lastSeg.match(/^(\d+)/)?.[1] || "").trim() || createHash("sha1").update(url).digest("hex").slice(0, 16);
      const { costInt } = formatCostForFilename(job.cost);
      const guessedExt = pickExtFromUrlOrContentType(url);
      const baseStem = `${idPart}-${costInt}`;
      let filename = `${baseStem}${guessedExt}`;
      let absFile = path.join(appDir, filename);
      let relFile = path.posix.join("/material", encodeURIComponent(safeAppName), filename);

      const idPartToFilename = await getIdPartToFilenameMap(appDir);
      const existingFilenameByIdPart = idPartToFilename.get(idPart);
      if (existingFilenameByIdPart) {
        const existingRel = path.posix.join("/material", encodeURIComponent(safeAppName), existingFilenameByIdPart);
        const bucket = byAppName[job.app_name];
        if (bucket && !bucket.local_files.includes(existingRel)) bucket.local_files.push(existingRel);
        outcome = "skipped";
        return;
      }

      if (await fs.pathExists(absFile)) {
        const bucket = byAppName[job.app_name];
        if (bucket && !bucket.local_files.includes(relFile)) bucket.local_files.push(relFile);
        outcome = "skipped";
        idPartToFilename.set(idPart, filename);
        return;
      }

      if (guessedExt === ".gif") {
        outcome = "skipped";
        return;
      }

      const res = await axios.get<ArrayBuffer>(url, {
        responseType: "arraybuffer",
        timeout: downloadTimeoutMs,
        validateStatus: () => true,
        headers: { "user-agent": "batchGenerateImage/1.0" },
      });
      if (res.status < 200 || res.status >= 300) {
        outcome = "failed";
        return;
      }
      const contentType = (res.headers?.["content-type"] as string | undefined) || "";
      const ext = pickExtFromUrlOrContentType(url, contentType);
      if (ext === ".gif") {
        outcome = "skipped";
        return;
      }
      if (ext !== guessedExt) {
        filename = `${baseStem}${ext}`;
        absFile = path.join(appDir, filename);
        relFile = path.posix.join("/material", encodeURIComponent(safeAppName), filename);
      }
      if (await fs.pathExists(absFile)) {
        const bucket = byAppName[job.app_name];
        if (bucket && !bucket.local_files.includes(relFile)) bucket.local_files.push(relFile);
        outcome = "skipped";
        idPartToFilename.set(idPart, filename);
        return;
      }
      let k = 2;
      while (await fs.pathExists(absFile)) {
        filename = `${baseStem}-${k}${ext}`;
        absFile = path.join(appDir, filename);
        relFile = path.posix.join("/material", encodeURIComponent(safeAppName), filename);
        k += 1;
      }
      await fs.writeFile(absFile, Buffer.from(res.data));
      const bucket = byAppName[job.app_name];
      if (bucket && !bucket.local_files.includes(relFile)) bucket.local_files.push(relFile);
      outcome = "success";
      idPartToFilename.set(idPart, filename);
      console.log(`[reference-images] 已保存: app=${safeAppName} file=${filename}`);
    } catch {
      outcome = "failed";
    } finally {
      done += 1;
      if (outcome === "success") success += 1;
      else if (outcome === "skipped") skipped += 1;
      else failed += 1;
      if (done === totalJobs || done % progressEvery === 0) {
        const elapsedMs = Date.now() - startedAt;
        const elapsedSec = Math.max(1, Math.round(elapsedMs / 1000));
        const speed = (done / elapsedSec).toFixed(2);
        console.log(
          `[reference-images] 进度 ${done}/${totalJobs} (${((done / Math.max(1, totalJobs)) * 100).toFixed(1)}%) success=${success} skip=${skipped} fail=${failed} ${speed}/s`
        );
      }
    }
  });

  console.log(`[reference-images] 下载完成: total=${totalJobs} success=${success} skip=${skipped} fail=${failed}`);

  await writeJsonCache(cacheDir, cacheFile, byAppName);
  return byAppName;
}