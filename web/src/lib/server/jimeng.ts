import { createHash, createHmac } from "crypto";

type JsonRecord = Record<string, unknown>;

export interface JimengClientConfig {
  /**
   * AK/SK 模式（visual 网关）使用。
   */
  accessKeyId?: string;
  secretAccessKey?: string;
  sessionToken?: string;
  /**
   * Full request endpoint, e.g.:
   * https://visual.volcengineapi.com
   * https://ark.cn-beijing.volces.com/api/v3/images/generations
   */
  endpoint?: string;
  region?: string;
  serviceName?: string;
  action?: string;
  version?: string;
}

export interface JimengGenerateImageOptions {
  imageUrls?: string[];
  size?: number;
  width?: number;
  height?: number;
  scale?: number;
  forceSingle?: boolean;
  minRatio?: number;
  maxRatio?: number;
}

export interface JimengLogoInfo {
  add_logo?: boolean;
  position?: number;
  language?: number;
  opacity?: number;
  logo_text_content?: string;
}

export interface JimengAigcMeta {
  content_producer?: string;
  producer_id: string;
  content_propagator?: string;
  propagate_id?: string;
}

export interface JimengResultOptions {
  returnUrl?: boolean;
  logoInfo?: JimengLogoInfo;
  aigcMeta?: JimengAigcMeta;
}

export interface JimengSubmitTaskResult {
  taskId?: string;
  raw: unknown;
}

export interface JimengGetResultResult {
  status?: string;
  imageUrls: string[];
  binaryDataBase64: string[];
  raw: unknown;
}

const JIMENG_LOG_ENABLED = (() => {
  const raw = String(process.env.JIMENG_LOG || "").trim().toLowerCase();
  if (["1", "true", "yes", "on"].includes(raw)) return true;
  if (["0", "false", "no", "off"].includes(raw)) return false;
  return process.env.NODE_ENV !== "production";
})();

function nowMs() {
  return Date.now();
}

function safeTextPreview(input: unknown, maxLen = 120): string {
  const s = String(input ?? "")
    .replace(/\s+/g, " ")
    .trim();
  if (!s) return "";
  return s.length > maxLen ? `${s.slice(0, maxLen)}…` : s;
}

function logInfo(msg: string, data?: JsonRecord) {
  if (!JIMENG_LOG_ENABLED) return;
  if (data && Object.keys(data).length) console.info(`[jimeng] ${msg}`, data);
  else console.info(`[jimeng] ${msg}`);
}

function logWarn(msg: string, data?: JsonRecord) {
  if (!JIMENG_LOG_ENABLED) return;
  if (data && Object.keys(data).length) console.warn(`[jimeng] ${msg}`, data);
  else console.warn(`[jimeng] ${msg}`);
}

function logError(msg: string, data?: JsonRecord) {
  if (!JIMENG_LOG_ENABLED) return;
  if (data && Object.keys(data).length) console.error(`[jimeng] ${msg}`, data);
  else console.error(`[jimeng] ${msg}`);
}

function readJsonSafe(text: string): unknown {
  if (!text) return null;
  try {
    return JSON.parse(text);
  } catch {
    return null;
  }
}

function pickErrorMessage(payload: unknown, fallback: string): string {
  if (!payload || typeof payload !== "object") return fallback;
  const obj = payload as JsonRecord;

  const directMessage = String(obj.message || "").trim();
  if (directMessage) return directMessage;

  const error = obj.error;
  if (error && typeof error === "object") {
    const errObj = error as JsonRecord;
    const errMessage = String(errObj.message || "").trim();
    if (errMessage) return errMessage;
  }

  const errors = obj.errors;
  if (Array.isArray(errors) && errors.length > 0) {
    const first = errors[0];
    if (first && typeof first === "object") {
      const firstMessage = String((first as JsonRecord).message || "").trim();
      if (firstMessage) return firstMessage;
    }
  }

  return fallback;
}

function toObject(payload: unknown): JsonRecord {
  return payload && typeof payload === "object" ? (payload as JsonRecord) : {};
}

function toStringArray(input: unknown): string[] {
  return Array.isArray(input)
    ? input.map((item) => String(item || "").trim()).filter(Boolean)
    : [];
}

function toDataObject(payload: unknown): JsonRecord {
  if (!payload || typeof payload !== "object") return {};
  const obj = payload as JsonRecord;
  return obj.data && typeof obj.data === "object" ? (obj.data as JsonRecord) : {};
}

function buildReqJson(options: JimengResultOptions = {}): string | undefined {
  const reqJson: JsonRecord = {};
  if (typeof options.returnUrl === "boolean") reqJson.return_url = options.returnUrl;
  if (options.logoInfo) reqJson.logo_info = options.logoInfo;
  if (options.aigcMeta) reqJson.aigc_meta = options.aigcMeta;
  return Object.keys(reqJson).length > 0 ? JSON.stringify(reqJson) : undefined;
}

export class JimengClient {
  private readonly accessKeyId: string;
  private readonly secretAccessKey: string;
  private readonly sessionToken: string;
  private readonly endpoint: string;
  private readonly region: string;
  private readonly serviceName: string;
  private readonly action: string;
  private readonly version: string;

  constructor(config: JimengClientConfig = {}) {
    const endpoint = String(
      config.endpoint ||
      "https://visual.volcengineapi.com"
    ).trim();
    this.endpoint = endpoint;
    this.region = String(config.region || "cn-north-1").trim();
    this.serviceName = String(config.serviceName || "cv").trim();
    this.action = String(config.action || "CVSync2AsyncSubmitTask").trim();
    this.version = String(config.version || "2022-08-31").trim();
    const accessKeyId = String(config.accessKeyId || process.env.JIMENG_ACCESS_KEY_ID || process.env.VOLC_ACCESS_KEY_ID || "").trim();
    const secretAccessKey = String(config.secretAccessKey || process.env.JIMENG_SECRET_ACCESS_KEY || process.env.VOLC_SECRET_ACCESS_KEY || "").trim();
    const sessionToken = String(config.sessionToken || "").trim();
    this.accessKeyId = accessKeyId;
    this.secretAccessKey = secretAccessKey;
    this.sessionToken = sessionToken;

    if (!this.accessKeyId || !this.secretAccessKey) {
      throw new Error("即梦 AK/SK 未配置，请设置 JIMENG_ACCESS_KEY_ID 与 JIMENG_SECRET_ACCESS_KEY");
    }
    this.endpoint = String(endpoint).trim();
  }

  async submitTask(prompt: string, options: JimengGenerateImageOptions = {}): Promise<JimengSubmitTaskResult> {
    const t0 = nowMs();
    const safePrompt = String(prompt || "").trim();
    if (!safePrompt) {
      throw new Error("即梦生成参数缺失：prompt 不能为空");
    }

    logInfo("submitTask:start", {
      endpoint: this.endpoint,
      action: this.action,
      version: this.version,
      promptLen: safePrompt.length,
      promptPreview: safeTextPreview(safePrompt, 80),
      hasImageUrls: Array.isArray(options.imageUrls) && options.imageUrls.length > 0,
      width: typeof options.width === "number" ? Math.floor(options.width) : undefined,
      height: typeof options.height === "number" ? Math.floor(options.height) : undefined,
      minRatio: typeof options.minRatio === "number" ? options.minRatio : undefined,
      maxRatio: typeof options.maxRatio === "number" ? options.maxRatio : undefined,
      forceSingle: typeof options.forceSingle === "boolean" ? options.forceSingle : undefined,
    });

    const body: JsonRecord = {
      req_key: "jimeng_t2i_v40",
      prompt: safePrompt,
    };

    if (Array.isArray(options.imageUrls) && options.imageUrls.length > 0) body.image_urls = options.imageUrls;
    if (typeof options.size === "number" && Number.isFinite(options.size)) body.size = Math.floor(options.size);
    if (typeof options.width === "number" && Number.isFinite(options.width)) body.width = Math.floor(options.width);
    if (typeof options.height === "number" && Number.isFinite(options.height)) body.height = Math.floor(options.height);
    if (typeof options.scale === "number" && Number.isFinite(options.scale)) body.scale = options.scale;
    if (typeof options.forceSingle === "boolean") body.force_single = options.forceSingle;
    if (typeof options.minRatio === "number" && Number.isFinite(options.minRatio)) body.min_ratio = options.minRatio;
    if (typeof options.maxRatio === "number" && Number.isFinite(options.maxRatio)) body.max_ratio = options.maxRatio;

    const bodyText = JSON.stringify(body);
    const res = await this.requestByAkSk(bodyText, this.action);

    const rawText = await res.text().catch(() => "");
    const json = readJsonSafe(rawText);

    if (!res.ok) {
      const fallback = `${res.status} ${res.statusText || ""}`.trim();
      const errMsg = pickErrorMessage(json, fallback);
      logWarn("submitTask:failed", {
        ms: nowMs() - t0,
        status: res.status,
        statusText: String(res.statusText || ""),
        error: errMsg,
        respPreview: safeTextPreview(rawText, 200),
      });
      throw new Error(`即梦图片生成请求失败：${errMsg}`);
    }

    const payload = toObject(json);
    const taskId = String(payload.task_id || "").trim() || String(toDataObject(json).task_id || "").trim() || undefined;
    if (!taskId) throw new Error("即梦提交任务成功，但未解析到 task_id");

    logInfo("submitTask:ok", {
      ms: nowMs() - t0,
      status: res.status,
      taskId,
    });
    return {
      taskId,
      raw: json,
    };
  }

  async getResult(taskId: string, options: JimengResultOptions = {}): Promise<JimengGetResultResult> {
    const t0 = nowMs();
    const safeTaskId = String(taskId || "").trim();
    if (!safeTaskId) throw new Error("即梦查询参数缺失：taskId 不能为空");

    logInfo("getResult:start", {
      endpoint: this.endpoint,
      action: "CVSync2AsyncGetResult",
      version: this.version,
      taskId: safeTaskId,
      returnUrl: typeof options.returnUrl === "boolean" ? options.returnUrl : undefined,
      hasLogoInfo: Boolean(options.logoInfo),
      hasAigcMeta: Boolean(options.aigcMeta),
    });

    const body: JsonRecord = {
      req_key: "jimeng_t2i_v40",
      task_id: safeTaskId,
    };
    const reqJson = buildReqJson(options);
    if (reqJson) body.req_json = reqJson;

    const bodyText = JSON.stringify(body);
    const res = await this.requestByAkSk(bodyText, "CVSync2AsyncGetResult");
    const rawText = await res.text().catch(() => "");
    const json = readJsonSafe(rawText);
    if (!res.ok) {
      const fallback = `${res.status} ${res.statusText || ""}`.trim();
      const errMsg = pickErrorMessage(json, fallback);
      logWarn("getResult:failed", {
        ms: nowMs() - t0,
        status: res.status,
        statusText: String(res.statusText || ""),
        taskId: safeTaskId,
        error: errMsg,
        respPreview: safeTextPreview(rawText, 200),
      });
      throw new Error(`即梦查询任务失败：${errMsg}`);
    }

    const data = toDataObject(json);
    const out = {
      status: String(data.status || "").trim() || undefined,
      imageUrls: toStringArray(data.image_urls),
      binaryDataBase64: toStringArray(data.binary_data_base64),
      raw: json,
    };

    logInfo("getResult:ok", {
      ms: nowMs() - t0,
      status: res.status,
      taskId: safeTaskId,
      resultStatus: out.status,
      imageUrls: out.imageUrls.length,
      binaryData: out.binaryDataBase64.length,
    });

    return out;
  }

  private async requestByAkSk(bodyText: string, action: string): Promise<Response> {
    const baseUrl = new URL(this.endpoint);
    const query = {
      Action: String(action || this.action || "").trim(),
      Version: String(this.version || "").trim(),
    };
    baseUrl.search = queryParamsToString(query);

    const t0 = nowMs();

    const method = "POST";
    const pathName = baseUrl.pathname || "/";
    const host = baseUrl.host;
    const xDate = getDateTimeNow();
    const bodySha = sha256Hex(bodyText);
    const headers: Record<string, string> = {
      host,
      "x-date": xDate,
      "content-type": "application/json",
    };
    if (this.sessionToken) {
      headers["x-security-token"] = this.sessionToken;
    }

    const authorization = signVolcRequest({
      method,
      pathName,
      query,
      headers,
      bodySha,
      accessKeyId: this.accessKeyId,
      secretAccessKey: this.secretAccessKey,
      region: this.region,
      serviceName: this.serviceName,
    });

    const url = baseUrl.toString();
    logInfo("request:start", {
      action: query.Action,
      version: query.Version,
      host,
      path: pathName,
      bodyBytes: Buffer.byteLength(bodyText || "", "utf8"),
      hasSessionToken: Boolean(this.sessionToken),
    });

    try {
      const res = await fetch(url, {
        method,
        headers: {
          "content-type": "application/json",
          "x-date": xDate,
          ...(this.sessionToken ? { "x-security-token": this.sessionToken } : {}),
          Authorization: authorization,
        },
        body: bodyText,
      });
      logInfo("request:done", {
        action: query.Action,
        status: res.status,
        ms: nowMs() - t0,
      });
      return res;
    } catch (e) {
      logError("request:error", {
        action: query.Action,
        ms: nowMs() - t0,
        error: e instanceof Error ? e.message : String(e),
      });
      throw e;
    }
  }
}

function signVolcRequest(params: {
  method: string;
  pathName: string;
  query: Record<string, string>;
  headers: Record<string, string>;
  bodySha: string;
  accessKeyId: string;
  secretAccessKey: string;
  region: string;
  serviceName: string;
}): string {
  const {
    method,
    pathName,
    query,
    headers,
    bodySha,
    accessKeyId,
    secretAccessKey,
    region,
    serviceName,
  } = params;

  const xDate = headers["x-date"];
  if (!xDate) throw new Error("缺少 x-date，无法进行 AK/SK 签名");
  const shortDate = xDate.slice(0, 8);
  const [signedHeaders, canonicalHeaders] = buildCanonicalHeaders(headers);
  const canonicalRequest = [
    method.toUpperCase(),
    pathName || "/",
    queryParamsToString(query),
    `${canonicalHeaders}\n`,
    signedHeaders,
    bodySha || sha256Hex(""),
  ].join("\n");
  const credentialScope = `${shortDate}/${region}/${serviceName}/request`;
  const stringToSign = [
    "HMAC-SHA256",
    xDate,
    credentialScope,
    sha256Hex(canonicalRequest),
  ].join("\n");
  const kDate = hmacSha256(secretAccessKey, shortDate);
  const kRegion = hmacSha256(kDate, region);
  const kService = hmacSha256(kRegion, serviceName);
  const kSigning = hmacSha256(kService, "request");
  const signature = createHmac("sha256", kSigning).update(stringToSign, "utf8").digest("hex");
  return `HMAC-SHA256 Credential=${accessKeyId}/${credentialScope}, SignedHeaders=${signedHeaders}, Signature=${signature}`;
}

function sha256Hex(input: string): string {
  return createHash("sha256").update(input, "utf8").digest("hex");
}

function hmacSha256(secret: string | Buffer, input: string): Buffer {
  return createHmac("sha256", secret).update(input, "utf8").digest();
}

function buildCanonicalHeaders(headers: Record<string, string>): [string, string] {
  const ignored = new Set(["authorization", "content-type", "content-length", "user-agent", "expect", "presigned-expires"]);
  const entries = Object.entries(headers)
    .map(([k, v]) => [String(k || "").trim().toLowerCase(), String(v || "").trim().replace(/\s+/g, " ")] as const)
    .filter(([k]) => k && !ignored.has(k))
    .sort((a, b) => (a[0] < b[0] ? -1 : a[0] > b[0] ? 1 : 0));
  const signedHeaders = entries.map(([k]) => k).join(";");
  const canonicalHeaders = entries.map(([k, v]) => `${k}:${v}`).join("\n");
  return [signedHeaders, canonicalHeaders];
}

function queryParamsToString(params: Record<string, unknown>): string {
  return Object.keys(params)
    .sort()
    .map((key) => {
      const val = params[key];
      if (val === undefined || val === null) return "";
      return `${uriEscape(key)}=${uriEscape(String(val))}`;
    })
    .filter(Boolean)
    .join("&");
}

function uriEscape(input: string): string {
  try {
    return encodeURIComponent(input)
      .replace(/[^A-Za-z0-9_.~\-%]+/g, (m) => escape(m))
      .replace(/[*]/g, (ch) => `%${ch.charCodeAt(0).toString(16).toUpperCase()}`);
  } catch {
    return "";
  }
}

function getDateTimeNow(): string {
  return new Date().toISOString().replace(/[:-]|\.\d{3}/g, "");
}

