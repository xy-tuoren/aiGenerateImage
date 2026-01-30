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
  await client.connect();
  return client;
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
  project: string;
  cost: number;
};

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

    total = pageTotal;

    for (const item of data) {
      const assets = Array.isArray(item?.assets) ? item.assets : [];
      const url = typeof assets[0] === "string" ? assets[0] : "";
      all.push({
        url,
        final_urls: typeof item?.final_urls === "string" ? item.final_urls : "",
        category: typeof item?.category === "string" ? item.category : "",
        project: typeof item?.project === "string" ? item.project : "",
        cost: typeof item?.cost === "number" ? item.cost : 0,
      });
    }

    if (!data.length) break;
    page += 1;
  }
  
  return all;
}

export async function fetchPackageIdToAppNamesMap(params?: { site?: string[]; cacheMaxAgeMs?: number; forceRefresh?: boolean }) {
  const client = await getAdminMongoClient();
  try {
    const db = client.db("appsite");
    const col = db.collection<{ package_id?: string; app_name?: string; site?: string }>("dd_app_data");
    const sites = Array.isArray(params?.site) && params!.site!.length ? params!.site! : null;
    const cacheMaxAgeMs = typeof params?.cacheMaxAgeMs === "number" && Number.isFinite(params.cacheMaxAgeMs) && params.cacheMaxAgeMs >= 0 ? params.cacheMaxAgeMs : 24 * 60 * 60 * 1000;
    const forceRefresh = params?.forceRefresh === true;
    const sitesKey = createHash("sha1").update(JSON.stringify(sites || [])).digest("hex");
    const cacheDir = path.join(process.cwd(), ".cache");
    const cacheFile = path.join(cacheDir, `packageIdToAppNamesMap.${sitesKey}.json`);
    if (!forceRefresh) {
      const cached = await readPackageIdToAppNamesMapCache(cacheFile, cacheMaxAgeMs);
      if (cached) return cached;
    }
    const query: Record<string, unknown> = { package_id: { $type: "string", $ne: "" }, app_name: { $type: "string", $ne: "" } };
    if (sites) query["site"] = { $in: sites };
    const cursor = col.find(query, { projection: { package_id: 1, app_name: 1 } });
    const map: Record<string, string[]> = {};
    for await (const doc of cursor) {
      const package_id = typeof doc?.package_id === "string" ? doc.package_id : "";
      const app_name = normalizeAppName(typeof doc?.app_name === "string" ? doc.app_name : "");
      if (!package_id || !app_name) continue;
      const arr = map[package_id] || (map[package_id] = []);
      if (!arr.includes(app_name)) arr.push(app_name);
    }
    await writePackageIdToAppNamesMapCache(cacheDir, cacheFile, map);
    return map;
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
  downloadConcurrency?: number;
  downloadTimeoutMs?: number;
  progressEvery?: number;
}) {
  const cacheMaxAgeMs =
    typeof params?.cacheMaxAgeMs === "number" && Number.isFinite(params.cacheMaxAgeMs) && params.cacheMaxAgeMs >= 0 ? params.cacheMaxAgeMs : 24 * 60 * 60 * 1000;
  const forceRefresh = params?.forceRefresh === true;
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
        ad_type: params?.ad_type || null,
        sort_field: params?.sort_field || null,
        sort_type: params?.sort_type || null,
        offset: params?.offset || null,
      })
    )
    .digest("hex");
  const cacheFile = path.join(cacheDir, `adCostMonth.byAppName.${cacheKey}.json`);

  let byAppName: AdCostMonthByAppNameCache | null = null;
  if (!forceRefresh) {
    const cached = await readJsonCache<AdCostMonthByAppNameCache>(cacheFile, cacheMaxAgeMs);
    if (cached) byAppName = cached;
  }

  if (!byAppName) {
    const all = await fetchAdCostMonthAll(params);
    const sites = Array.from(new Set(all.map((x) => (x?.project || "").trim()).filter(Boolean)));
    const packageIdToAppNamesMap = await fetchPackageIdToAppNamesMap({ site: sites, forceRefresh });

    byAppName = {};
    for (const it of all) {
      const package_id = extractPackageIdFromFinalUrls(it.final_urls);
      const app_names = package_id ? packageIdToAppNamesMap[package_id] || [] : [];
      const item: AdCostMonthWithAppNamesItem = { ...it, package_id, app_names };
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

  const publicMaterialDir = path.join(process.cwd(), "public", "material");
  await fs.ensureDir(publicMaterialDir);

  const downloadJobs: Array<{ app_name: string; url: string; cost: number }> = [];
  for (const [app_name, bucket] of Object.entries(byAppName)) {
    for (const it of bucket.items) {
      const url = (it?.url || "").trim();
      if (!url) continue;
      downloadJobs.push({ app_name, url, cost: it.cost });
    }
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
        const dashIdx = base.indexOf("-");
        if (dashIdx <= 0) continue;
        const idPart = base.slice(0, dashIdx).trim();
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
      const idPart = /^\d+$/.test(lastSeg) ? lastSeg : createHash("sha1").update(url).digest("hex").slice(0, 16);
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