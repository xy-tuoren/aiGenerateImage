import { createHash } from "crypto";
import fs from "fs-extra";
import path from "path";

export type ReferenceImageEmbeddingItem = {
  id: string;
  values: number[];
  metadata?: Record<string, unknown>;
};

export type VectorizeUpsertResult = {
  ids: string[];
  count: number;
};

export type SaveToCloudflareParams = {
  vectors: ReferenceImageEmbeddingItem[];
  accountId?: string;
  apiToken?: string;
  indexName?: string;
};

export type SyncRemoteIndexToCloudflareParams = {
  remoteIndexFile?: string;
  accountId?: string;
  indexName?: string;
  appName?: string;
  debugLimit?: number;
  batchSize?: number;
  concurrency?: number;
};

function getEnv(name: string): string {
  return String(process.env[name] || "").trim();
}

function getRequired(value: string, fieldName: string): string {
  if (!value) {
    throw new Error(`缺少必要参数：${fieldName}`);
  }
  return value;
}

async function readJsonSafe(res: Response): Promise<unknown> {
  const text = await res.text().catch(() => "");
  if (!text) return null;
  try {
    return JSON.parse(text);
  } catch {
    return null;
  }
}

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

function getErrorMessage(payload: unknown, fallback: string): string {
  if (!payload || typeof payload !== "object") return fallback;
  const obj = payload as Record<string, unknown>;
  if (typeof obj.message === "string" && obj.message.trim()) return obj.message;

  const error = obj.error;
  if (error && typeof error === "object") {
    const errObj = error as Record<string, unknown>;
    if (typeof errObj.message === "string" && errObj.message.trim()) return errObj.message;
  }

  const errors = obj.errors;
  if (Array.isArray(errors) && errors[0] && typeof errors[0] === "object") {
    const first = errors[0] as Record<string, unknown>;
    if (typeof first.message === "string" && first.message.trim()) return first.message;
  }

  const messages = obj.messages;
  if (Array.isArray(messages) && messages[0] && typeof messages[0] === "object") {
    const first = messages[0] as Record<string, unknown>;
    if (typeof first.message === "string" && first.message.trim()) return first.message;
  }

  return fallback;
}

function getTokenUsage(payload: unknown): number {
  if (!payload || typeof payload !== "object") return 0;
  const obj = payload as Record<string, unknown>;
  const usage = obj.usage && typeof obj.usage === "object" ? (obj.usage as Record<string, unknown>) : null;
  if (!usage) return 0;

  const fromTotalTokens =
    typeof usage.total_tokens === "number" && Number.isFinite(usage.total_tokens)
      ? usage.total_tokens
      : typeof usage.totalTokens === "number" && Number.isFinite(usage.totalTokens)
        ? usage.totalTokens
        : null;
  if (typeof fromTotalTokens === "number") return Math.max(0, Math.floor(fromTotalTokens));

  const inputTokens =
    typeof usage.input_tokens === "number" && Number.isFinite(usage.input_tokens)
      ? usage.input_tokens
      : typeof usage.inputTokens === "number" && Number.isFinite(usage.inputTokens)
        ? usage.inputTokens
        : 0;
  const outputTokens =
    typeof usage.output_tokens === "number" && Number.isFinite(usage.output_tokens)
      ? usage.output_tokens
      : typeof usage.outputTokens === "number" && Number.isFinite(usage.outputTokens)
        ? usage.outputTokens
        : 0;
  return Math.max(0, Math.floor(inputTokens + outputTokens));
}

async function requestQwenEmbedding(params: {
  imageUrl?: string;
  text?: string;
  apiKey?: string;
  endpoint?: string;
  model?: string;
  dimension?: number;
}): Promise<{ values: number[]; tokens: number }> {
  const defaultEndpoint =
    "https://dashscope.aliyuncs.com/api/v1/services/embeddings/multimodal-embedding/multimodal-embedding";
  const defaultModel = "qwen3-vl-embedding";
  const normalizeNumberArray = (input: unknown): number[] => {
    if (!Array.isArray(input)) return [];
    return input
      .map((x) => (typeof x === "number" && Number.isFinite(x) ? x : Number(x)))
      .filter((x) => Number.isFinite(x));
  };

  const imageUrl = String(params.imageUrl || "").trim();
  const text = String(params.text || "").trim();
  if (!imageUrl && !text) {
    throw new Error("imageUrl 与 text 至少需要提供一个");
  }
  const apiKey = getRequired(String(params.apiKey || getEnv("QWEN_EMBEDDING_API_KEY")).trim(), "apiKey / QWEN_EMBEDDING_API_KEY");
  const endpoint = String(params.endpoint || defaultEndpoint).trim();
  const model = String(params.model || defaultModel).trim();
  const dimensionRaw = Number(params.dimension ?? 1024);
  const dimension = Number.isFinite(dimensionRaw) && dimensionRaw > 0 ? Math.floor(dimensionRaw) : 1024;
  const contents: Array<{ image?: string; text?: string }> = [];
  if (imageUrl) contents.push({ image: imageUrl });
  if (text) contents.push({ text });

  const res = await fetch(endpoint, {
    method: "POST",
    headers: {
      "content-type": "application/json",
      Authorization: `Bearer ${apiKey}`,
    },
    body: JSON.stringify({
      model,
      parameters: {
        dimension,
      },
      input: {
        contents,
      },
    }),
  });

  const json = await readJsonSafe(res);
  if (!res.ok) {
    const fallback = `${res.status} ${res.statusText || ""}`.trim();
    throw new Error(`千问向量接口请求失败：${getErrorMessage(json, fallback)}`);
  }

  const payload = json && typeof json === "object" ? (json as Record<string, unknown>) : {};
  const output = payload.output as Record<string, unknown> | undefined;
  const embeddings = Array.isArray(output?.embeddings) ? output.embeddings : [];
  const firstEmbedding = embeddings[0] as Record<string, unknown> | undefined;
  const valuesFromOutput = normalizeNumberArray(firstEmbedding?.embedding);
  const data = Array.isArray(payload.data) ? payload.data : [];
  const firstData = data[0] as Record<string, unknown> | undefined;
  const values =
    valuesFromOutput.length > 0
      ? valuesFromOutput
      : normalizeNumberArray(firstData?.embedding);
  if (!values.length) {
    throw new Error("千问向量接口返回为空或格式不匹配");
  }

  const tokens = getTokenUsage(payload);
  console.log(
    `[reference-image-vectorize] qwen token usage hasImage=${imageUrl ? "1" : "0"} hasText=${text ? "1" : "0"} tokens=${tokens} dimension=${values.length}`
  );

  return { values, tokens };
}

/**
 * 向量化接口：输入图片 URL，返回 embedding 向量。
 */
export async function vectorizeImage(params: {
  imageUrl: string;
  text?: string;
  apiKey?: string;
  endpoint?: string;
  model?: string;
  dimension?: number;
}): Promise<number[]> {
  const result = await requestQwenEmbedding(params);
  return result.values;
}

/**
 * 保存接口：将向量批量 upsert 到 Cloudflare Vectorize。
 */
export async function saveVectorsToCloudflare(params: SaveToCloudflareParams): Promise<VectorizeUpsertResult> {
  const vectors = Array.isArray(params.vectors) ? params.vectors : [];
  if (!vectors.length) return { ids: [], count: 0 };

  const accountId = getRequired(String(params.accountId || getEnv("CLOUDFLARE_ACCOUNT_ID")).trim(), "accountId / CLOUDFLARE_ACCOUNT_ID");
  const apiToken = getRequired(String(params.apiToken || getEnv("CLOUDFLARE_API_TOKEN")).trim(), "apiToken / CLOUDFLARE_API_TOKEN");
  const indexName = getRequired(String(params.indexName || "ai-designer").trim(), "indexName");
  const endpoint = `https://api.cloudflare.com/client/v4/accounts/${encodeURIComponent(accountId)}/vectorize/v2/indexes/${encodeURIComponent(indexName)}/upsert`;
  console.log(
    `[reference-image-vectorize] cloudflare upsert start index=${indexName} count=${vectors.length}`
  );

  const res = await fetch(endpoint, {
    method: "POST",
    headers: {
      "content-type": "application/json",
      Authorization: `Bearer ${apiToken}`,
    },
    body: JSON.stringify({
      vectors: vectors.map((item) => ({
        id: item.id,
        values: item.values,
        metadata: item.metadata || {},
      })),
    }),
  });

  const json = await readJsonSafe(res);
  const failedByPayload =
    json !== null &&
    typeof json === "object" &&
    "success" in json &&
    (json as { success?: unknown }).success === false;
  if (!res.ok || failedByPayload) {
    const fallback = `${res.status} ${res.statusText || ""}`.trim();
    console.error(
      `[reference-image-vectorize] cloudflare upsert failed index=${indexName} status=${res.status} count=${vectors.length}`
    );
    throw new Error(`Cloudflare Vectorize upsert 失败：${getErrorMessage(json, fallback)}`);
  }

  console.log(
    `[reference-image-vectorize] cloudflare upsert success index=${indexName} count=${vectors.length}`
  );

  return {
    ids: vectors.map((item) => item.id),
    count: vectors.length,
  };
}

function chunkArray<T>(items: T[], size: number): T[][] {
  const out: T[][] = [];
  if (!items.length) return out;
  for (let i = 0; i < items.length; i += size) {
    out.push(items.slice(i, i + size));
  }
  return out;
}

function safeVectorId(parts: Array<string | number>): string {
  const source = parts.map((x) => String(x || "").trim()).join("::");
  const digest = createHash("sha1").update(source).digest("hex");
  return `ref-${digest.slice(0, 24)}`;
}

async function getExistingCloudflareVectorIds(params: {
  ids: string[];
  accountId?: string;
  apiToken?: string;
  indexName?: string;
}): Promise<Set<string>> {
  const ids = Array.isArray(params.ids) ? params.ids.map((x) => String(x || "").trim()).filter(Boolean) : [];
  if (!ids.length) return new Set<string>();

  const accountId = getRequired(String(params.accountId || getEnv("CLOUDFLARE_ACCOUNT_ID")).trim(), "accountId / CLOUDFLARE_ACCOUNT_ID");
  const apiToken = getRequired(String(params.apiToken || getEnv("CLOUDFLARE_API_TOKEN")).trim(), "apiToken / CLOUDFLARE_API_TOKEN");
  const indexName = getRequired(String(params.indexName || "ai-designer").trim(), "indexName");
  const endpoint = `https://api.cloudflare.com/client/v4/accounts/${encodeURIComponent(accountId)}/vectorize/v2/indexes/${encodeURIComponent(indexName)}/get_by_ids`;

  const existing = new Set<string>();
  for (const batch of chunkArray(ids, 20)) {
    const res = await fetch(endpoint, {
      method: "POST",
      headers: {
        "content-type": "application/json",
        Authorization: `Bearer ${apiToken}`,
      },
      body: JSON.stringify({ ids: batch }),
    });

    const json = await readJsonSafe(res);
    if (!res.ok) {
      const fallback = `${res.status} ${res.statusText || ""}`.trim();
      throw new Error(`Cloudflare Vectorize get_by_ids 失败：${getErrorMessage(json, fallback)}`);
    }

    const payload = json && typeof json === "object" ? (json as Record<string, unknown>) : {};
    const result = payload.result;
    const vectors =
      result && typeof result === "object" && Array.isArray((result as Record<string, unknown>).vectors)
        ? ((result as Record<string, unknown>).vectors as Array<Record<string, unknown>>)
        : [];
    for (const v of vectors) {
      const id = typeof v?.id === "string" ? v.id.trim() : "";
      if (id) existing.add(id);
    }
  }

  return existing;
}

export async function clearAllVectorsFromCloudflareIndex(params: {
  accountId?: string;
  indexName?: string;
}): Promise<{
  deleted: number;
  scanned: number;
}> {
  const accountId = getRequired(String(params.accountId || getEnv("CLOUDFLARE_ACCOUNT_ID")).trim(), "accountId / CLOUDFLARE_ACCOUNT_ID");
  const apiToken = getRequired(String(getEnv("CLOUDFLARE_API_TOKEN")).trim(), "apiToken / CLOUDFLARE_API_TOKEN");
  const indexName = String(params.indexName || "ai-designer").trim();
  const baseEndpoint = `https://api.cloudflare.com/client/v4/accounts/${encodeURIComponent(accountId)}/vectorize/v2/indexes`;
  const indexEndpoint = `${baseEndpoint}/${encodeURIComponent(indexName)}`;
  const headers = {
    "content-type": "application/json",
    Authorization: `Bearer ${apiToken}`,
  };

  console.log(`[reference-image-vectorize] cloudflare clear-all(recreate) start index=${indexName}`);

  // 读取已有索引配置，后续删除后按相同配置重建。
  const getRes = await fetch(indexEndpoint, { method: "GET", headers });
  const getJson = await readJsonSafe(getRes);
  if (getRes.status === 404) {
    console.log(`[reference-image-vectorize] cloudflare clear-all skip: index not found index=${indexName}`);
    return { deleted: 0, scanned: 0 };
  }
  if (!getRes.ok) {
    const fallback = `${getRes.status} ${getRes.statusText || ""}`.trim();
    throw new Error(`Cloudflare Vectorize 获取索引失败：${getErrorMessage(getJson, fallback)}`);
  }

  const getPayload = getJson && typeof getJson === "object" ? (getJson as Record<string, unknown>) : {};
  const result = getPayload.result && typeof getPayload.result === "object" ? (getPayload.result as Record<string, unknown>) : {};
  const config = result.config && typeof result.config === "object" ? (result.config as Record<string, unknown>) : {};
  const dimensionsRaw = Number(config.dimensions);
  const dimensions = Number.isFinite(dimensionsRaw) && dimensionsRaw > 0 ? Math.floor(dimensionsRaw) : 1024;
  const metricRaw = String(config.metric || "cosine").trim();
  const metric: "cosine" | "euclidean" | "dot-product" =
    metricRaw === "euclidean" || metricRaw === "dot-product" ? metricRaw : "cosine";
  const descriptionRaw = String(result.description || "").trim();

  // 一次性清空：直接删除索引。
  const delRes = await fetch(indexEndpoint, { method: "DELETE", headers });
  const delJson = await readJsonSafe(delRes);
  if (!delRes.ok && delRes.status !== 404) {
    const fallback = `${delRes.status} ${delRes.statusText || ""}`.trim();
    throw new Error(`Cloudflare Vectorize 删除索引失败：${getErrorMessage(delJson, fallback)}`);
  }

  // 删除后可能存在短暂最终一致性，重建时对“已存在”错误做有限重试。
  const createBody = {
    name: indexName,
    description: descriptionRaw || `${indexName} vector index`,
    config: {
      dimensions,
      metric,
    },
  };
  let created = false;
  let lastCreateError = "";
  for (let attempt = 1; attempt <= 8; attempt += 1) {
    const createRes = await fetch(baseEndpoint, {
      method: "POST",
      headers,
      body: JSON.stringify(createBody),
    });
    const createJson = await readJsonSafe(createRes);
    if (createRes.ok) {
      created = true;
      break;
    }

    const payload = createJson && typeof createJson === "object" ? (createJson as Record<string, unknown>) : {};
    const errors = Array.isArray(payload.errors) ? (payload.errors as Array<Record<string, unknown>>) : [];
    const hasAlreadyExists = errors.some((err) => Number(err?.code) === 3002);
    const fallback = `${createRes.status} ${createRes.statusText || ""}`.trim();
    lastCreateError = getErrorMessage(createJson, fallback);
    if (!hasAlreadyExists) break;
    await sleep(1000);
  }
  if (!created) {
    throw new Error(`Cloudflare Vectorize 重建索引失败：${lastCreateError || "未知错误"}`);
  }

  console.log(`[reference-image-vectorize] cloudflare clear-all(recreate) success index=${indexName}`);
  return { deleted: 0, scanned: 0 };
}

export async function searchReferenceImagesByVector(params: {
  appName: string;
  imageUrl?: string;
  text?: string;
  topK?: number;
  accountId?: string;
  apiToken?: string;
  indexName?: string;
}): Promise<{
  total: number;
  topK: number;
  appName: string;
  tokens: number;
  matches: Array<{
    id: string;
    score: number;
    url: string;
    appName: string;
    campaign_name: string;
    category: string;
  }>;
}> {
  const appName = getRequired(String(params.appName || "").trim(), "appName");
  const appNameLower = appName.toLowerCase();
  const minScore = 0.6;
  const imageUrl = String(params.imageUrl || "").trim();
  const text = String(params.text || "").trim();
  if (!imageUrl && !text) {
    throw new Error("搜图参数无效：imageUrl 与 text 至少提供一个");
  }

  const topKRaw = Number(params.topK ?? 50);
  const topK = Number.isFinite(topKRaw) ? Math.min(50, Math.max(1, Math.floor(topKRaw))) : 50;
  // returnMetadata=all 时 Cloudflare 限制 topK <= 50。
  const queryTopK = Math.min(50, Math.max(topK, 20));
  const accountId = getRequired(String(params.accountId || getEnv("CLOUDFLARE_ACCOUNT_ID")).trim(), "accountId / CLOUDFLARE_ACCOUNT_ID");
  const apiToken = getRequired(String(params.apiToken || getEnv("CLOUDFLARE_API_TOKEN")).trim(), "apiToken / CLOUDFLARE_API_TOKEN");
  const indexName = getRequired(String(params.indexName || "ai-designer").trim(), "indexName");

  const embed = await requestQwenEmbedding({
    imageUrl: imageUrl || undefined,
    text: text || undefined,
  });

  const endpoint = `https://api.cloudflare.com/client/v4/accounts/${encodeURIComponent(accountId)}/vectorize/v2/indexes/${encodeURIComponent(indexName)}/query`;
  console.log(
    `[reference-image-vectorize] query start index=${indexName} appName=${appName} topK=${topK} queryTopK=${queryTopK}`
  );
  const res = await fetch(endpoint, {
    method: "POST",
    headers: {
      "content-type": "application/json",
      Authorization: `Bearer ${apiToken}`,
    },
    body: JSON.stringify({
      vector: embed.values,
      topK: queryTopK,
      returnMetadata: "all",
      returnValues: false,
    }),
  });

  const json = await readJsonSafe(res);
  const failedByPayload =
    json !== null &&
    typeof json === "object" &&
    "success" in json &&
    (json as { success?: unknown }).success === false;
  if (!res.ok || failedByPayload) {
    const fallback = `${res.status} ${res.statusText || ""}`.trim();
    throw new Error(`Cloudflare Vectorize query 失败：${getErrorMessage(json, fallback)}`);
  }

  const payload = json && typeof json === "object" ? (json as Record<string, unknown>) : {};
  const result = payload.result && typeof payload.result === "object" ? (payload.result as Record<string, unknown>) : {};
  const matchesRaw = Array.isArray(result.matches) ? (result.matches as Array<Record<string, unknown>>) : [];
  const picked: Array<{
    id: string;
    score: number;
    url: string;
    appName: string;
    campaign_name: string;
    category: string;
  }> = [];
  for (const row of matchesRaw) {
    const metadata =
      row?.metadata && typeof row.metadata === "object" ? (row.metadata as Record<string, unknown>) : {};
    const rowAppName = String(metadata.appName || "").trim();
    const url = String(metadata.url || "").trim();
    if (!rowAppName) continue;
    if (rowAppName.toLowerCase() !== appNameLower) continue;
    const scoreRaw = Number(row.score);
    const score = Number.isFinite(scoreRaw) ? scoreRaw : 0;
    if (!(score > minScore)) continue;
    const id = String(row.id || "").trim();
    picked.push({
      id,
      score,
      url,
      appName: rowAppName,
      campaign_name: String(metadata.campaign_name || "").trim(),
      category: String(metadata.category || "").trim(),
    });
    if (picked.length >= topK) break;
  }

  console.log(
    `[reference-image-vectorize] query success index=${indexName} appName=${appName} raw=${matchesRaw.length} picked=${picked.length}`
  );
  return {
    total: picked.length,
    topK,
    appName,
    tokens: embed.tokens,
    matches: picked,
  };
}

/**
 * 读取 remoteIndex，并将未入库项向量化后写入 Cloudflare Vectorize。
 * 会先用 get_by_ids 检查“是否已经向量化过”。
 */
export async function vectorizeRemoteIndexAndSaveToCloudflare(
  params: SyncRemoteIndexToCloudflareParams
): Promise<{
  total: number;
  existed: number;
  embedded: number;
  saved: number;
  totalTokens: number;
  debugLimitApplied: number;
  failed: Array<{ id: string; url: string; reason: string }>;
}> {
  const cwd = process.cwd();
  const remoteIndexFile = String(params.remoteIndexFile || path.join(cwd, ".cache", "referenceImages.remoteIndex.json")).trim();
  const accountId = getRequired(String(params.accountId || getEnv("CLOUDFLARE_ACCOUNT_ID")).trim(), "accountId / CLOUDFLARE_ACCOUNT_ID");
  const indexName = String(params.indexName || "ai-designer").trim();
  const appNameFilter = String(params.appName || "").trim().toLowerCase();
  const debugLimitRaw = Number(params.debugLimit ?? 0);
  const debugLimit = Number.isFinite(debugLimitRaw) && debugLimitRaw > 0 ? Math.floor(debugLimitRaw) : 0;
  const batchSizeRaw = Number(params.batchSize ?? 50);
  const batchSize = Number.isFinite(batchSizeRaw) ? Math.min(200, Math.max(1, Math.floor(batchSizeRaw))) : 50;
  const concurrencyRaw = Number(params.concurrency ?? 4);
  const concurrency = Number.isFinite(concurrencyRaw) ? Math.min(20, Math.max(1, Math.floor(concurrencyRaw))) : 4;

  const raw = await fs.readFile(remoteIndexFile, "utf8").catch(() => "");
  if (!raw) {
    return { total: 0, existed: 0, embedded: 0, saved: 0, totalTokens: 0, debugLimitApplied: debugLimit, failed: [] };
  }

  const parsed = JSON.parse(raw) as unknown;
  const data =
    parsed && typeof parsed === "object" && "data" in (parsed as Record<string, unknown>)
      ? ((parsed as Record<string, unknown>).data as unknown)
      : parsed;
  const byApp = data && typeof data === "object" ? (data as Record<string, unknown>) : {};

  const records: Array<{
    id: string;
    appName: string;
    url: string;
    campaign_name: string;
    category: string;
  }> = [];

  for (const [appNameRaw, value] of Object.entries(byApp)) {
    const appName = String(appNameRaw || "").trim();
    if (!appName) continue;
    if (appNameFilter && appName.toLowerCase() !== appNameFilter) continue;
    const items = Array.isArray(value) ? value : [];
    for (const item of items) {
      const row = item && typeof item === "object" ? (item as Record<string, unknown>) : {};
      const url = String(row.url || "").trim();
      if (!url) continue;
      const campaign_name = String(row.campaign_name || "").trim();
      const category = String(row.category || "").trim();
      const id = safeVectorId([appName, url, campaign_name, category]);
      records.push({ id, appName, url, campaign_name, category });
    }
  }

  if (!records.length) {
    return { total: 0, existed: 0, embedded: 0, saved: 0, totalTokens: 0, debugLimitApplied: debugLimit, failed: [] };
  }

  const uniqueById = new Map<string, (typeof records)[number]>();
  for (const row of records) {
    if (!uniqueById.has(row.id)) uniqueById.set(row.id, row);
  }
  const uniqueRecordsAll = Array.from(uniqueById.values());
  const uniqueRecords =
    debugLimit > 0 ? uniqueRecordsAll.slice(0, Math.min(debugLimit, uniqueRecordsAll.length)) : uniqueRecordsAll;
  if (debugLimit > 0) {
    console.log(
      `[reference-image-vectorize] debug limit enabled limit=${debugLimit} selected=${uniqueRecords.length} source=${uniqueRecordsAll.length}`
    );
  }
  const existingIds = await getExistingCloudflareVectorIds({
    ids: uniqueRecords.map((x) => x.id),
    accountId,
    indexName,
  });
  const toEmbed = uniqueRecords.filter((x) => !existingIds.has(x.id));
  if (!toEmbed.length) {
    return {
      total: uniqueRecords.length,
      existed: existingIds.size,
      embedded: 0,
      saved: 0,
      totalTokens: 0,
      debugLimitApplied: debugLimit,
      failed: [],
    };
  }

  const totalToSave = toEmbed.length;
  const totalBatches = Math.ceil(totalToSave / batchSize);
  console.log(
    `[reference-image-vectorize] save plan index=${indexName} total=${uniqueRecords.length} existed=${existingIds.size} toSave=${totalToSave} batchSize=${batchSize} concurrency=${concurrency} totalBatches=${totalBatches}`
  );

  const failed: Array<{ id: string; url: string; reason: string }> = [];
  let totalTokens = 0;
  let embedded = 0;
  let saved = 0;
  let processed = 0;
  let currentBatch = 0;
  for (const embedBatch of chunkArray(toEmbed, batchSize)) {
    currentBatch += 1;
    const queue = [...embedBatch];
    const vectorsBatch: ReferenceImageEmbeddingItem[] = [];

    async function worker() {
      while (queue.length) {
        const item = queue.shift();
        if (!item) continue;
        try {
          const text = [item.campaign_name, item.category].filter(Boolean).join("\n");
          const result = await requestQwenEmbedding({
            imageUrl: item.url,
            text,
          });
          totalTokens += result.tokens;
          vectorsBatch.push({
            id: item.id,
            values: result.values,
            metadata: {
              appName: item.appName,
              url: item.url,
              campaign_name: item.campaign_name,
              category: item.category,
              source: "referenceImages.remoteIndex.json",
            },
          });
        } catch (e) {
          failed.push({
            id: item.id,
            url: item.url,
            reason: e instanceof Error ? e.message : String(e),
          });
        }
      }
    }

    await Promise.all(Array.from({ length: Math.min(concurrency, queue.length) }, () => worker()));
    embedded += vectorsBatch.length;
    if (!vectorsBatch.length) continue;

    try {
      const r = await saveVectorsToCloudflare({ vectors: vectorsBatch, accountId, indexName });
      saved += r.count;
      processed += embedBatch.length;
      console.log(
        `[reference-image-vectorize] progress index=${indexName} batch=${currentBatch}/${totalBatches} processed=${processed}/${totalToSave} embedded=${embedded} saved=${saved} failed=${failed.length}`
      );
    } catch (e) {
      console.error(
        `[reference-image-vectorize] batch upsert failed index=${indexName} batchSize=${vectorsBatch.length}`,
        e
      );
      throw e;
    }
  }

  console.log(
    `[reference-image-vectorize] qwen total token usage totalTokens=${totalTokens} embedded=${embedded} failed=${failed.length}`
  );

  return {
    total: uniqueRecords.length,
    existed: existingIds.size,
    embedded,
    saved,
    totalTokens,
    debugLimitApplied: debugLimit,
    failed,
  };
}


