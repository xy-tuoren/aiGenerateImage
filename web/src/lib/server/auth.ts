import crypto from "crypto";

export type SessionUser = {
  userId: string;
  username: string;
};

export type EnvAuthUser = {
  username: string;
  password: string;
  role?: string;
  /**
   * 关联账号（填写另一个 username）。
   * 用于“图片广场”共享：相关接口会把数据归属到关联账号（或其链路最终指向的账号）。
   */
  related?: string;
};

export type ResolvedAuthz = {
  role: string;
  isSuperAdmin: boolean;
  permissions: Record<string, boolean>;
};

export type ApiAccessGuard =
  | { ok: true; user: SessionUser; authz: ResolvedAuthz; permissionKey: string }
  | { ok: false; status: 401 | 403; error: string };

export const ROLE_PERMISSIONS: Record<string, Record<string, boolean>> = {
  // 超级管理员（无任何限制）：代码里会直接放行；这里也给一个通配符方便前端判断
  super: { "*": true },
  // 普通用户（示例权限，可按需增删 key）
  user: {
    "ui:/reference": true,
    "ui:/configs": true,
    "ui:/batch": true,
    "ui:/gallery": true,
    "ui:/crop": true,
    "ui:/cut-settings": true,
    "ui:/make-image": true,
    "api:*": true,
  },
  // 操作员（示例权限，可按需增删 key）
  operator: {
    "ui:/gallery": true,
    "ui:/crop": true,
    "ui:/cut-settings": true,
    "api:*": true,
  },
};

const COOKIE_NAME = "bg_session";
const SESSION_MAX_AGE_SECONDS = 7 * 24 * 60 * 60;

export function computePwdSig(username: string, password: string) {
  const secret = getAuthSecret();
  if (!secret) return "";
  const u = String(username || "").trim();
  const p = String(password || "").trim();
  if (!u || !p) return "";
  // 用服务端 secret 做 HMAC，避免泄露可逆/可穷举的密码信息
  return crypto.createHmac("sha256", secret).update(`pwd:${u}:${p}`).digest("hex");
}

function timingSafeEqualText(a: string, b: string) {
  const sa = String(a || "");
  const sb = String(b || "");
  if (sa.length !== sb.length) return false;
  // 使用 Buffer + timingSafeEqual，避免时序侧信道
  return crypto.timingSafeEqual(Buffer.from(sa, "utf8"), Buffer.from(sb, "utf8"));
}

function base64UrlEncode(input: Buffer | string) {
  const buf = typeof input === "string" ? Buffer.from(input, "utf8") : input;
  return buf.toString("base64").replaceAll("+", "-").replaceAll("/", "_").replaceAll("=", "");
}

function base64UrlDecodeToString(input: string) {
  const s = String(input || "").trim().replaceAll("-", "+").replaceAll("_", "/");
  const pad = s.length % 4 === 0 ? "" : "=".repeat(4 - (s.length % 4));
  return Buffer.from(s + pad, "base64").toString("utf8");
}

function getAuthSecret() {
  const raw = String(process.env.AUTH_SECRET || "").trim();
  if (raw) return raw;
  if (process.env.NODE_ENV === "development") return "dev-secret";
  return "";
}

function sign(payloadB64: string) {
  const secret = getAuthSecret();
  if (!secret) return "";
  return crypto.createHmac("sha256", secret).update(payloadB64).digest("hex");
}

function timingSafeEqualHex(a: string, b: string) {
  try {
    const ba = Buffer.from(String(a || ""), "hex");
    const bb = Buffer.from(String(b || ""), "hex");
    if (ba.length !== bb.length) return false;
    return crypto.timingSafeEqual(ba, bb);
  } catch {
    return false;
  }
}

function getCookieValue(cookieHeader: string, name: string) {
  const raw = String(cookieHeader || "");
  if (!raw) return "";
  const parts = raw.split(";").map((x) => x.trim()).filter(Boolean);
  for (const p of parts) {
    const idx = p.indexOf("=");
    if (idx <= 0) continue;
    const k = p.slice(0, idx).trim();
    if (k !== name) continue;
    return p.slice(idx + 1).trim();
  }
  return "";
}

export function toUserId(username: string) {
  const u = String(username || "").trim();
  return crypto.createHash("sha1").update(`user:${u}`).digest("hex");
}

export function getSessionCookieName() {
  return COOKIE_NAME;
}

export function getSessionMaxAgeSeconds() {
  return SESSION_MAX_AGE_SECONDS;
}

export function buildSessionToken(user: SessionUser, pwdSig?: string) {
  const secret = getAuthSecret();
  if (!secret) return "";
  const nowSec = Math.floor(Date.now() / 1000);
  const payload = {
    v: 1,
    userId: String(user.userId || "").trim(),
    username: String(user.username || "").trim(),
    iat: nowSec,
    exp: nowSec + SESSION_MAX_AGE_SECONDS,
    ps: String(pwdSig || "").trim() || undefined,
  };
  const payloadJson = JSON.stringify(payload);
  const payloadB64 = base64UrlEncode(payloadJson);
  const sig = sign(payloadB64);
  if (!sig) return "";
  return `${payloadB64}.${sig}`;
}

function parseSessionTokenPayload(token: string): any | null {
  const raw = String(token || "").trim();
  const idx = raw.lastIndexOf(".");
  if (idx <= 0) return null;
  const payloadB64 = raw.slice(0, idx);
  const sig = raw.slice(idx + 1);
  const expected = sign(payloadB64);
  if (!expected) return null;
  if (!timingSafeEqualHex(sig, expected)) return null;
  try {
    const jsonStr = base64UrlDecodeToString(payloadB64);
    const obj: any = JSON.parse(jsonStr);
    const exp = Number(obj?.exp || 0);
    if (!Number.isFinite(exp) || exp <= 0) return null;
    const nowSec = Math.floor(Date.now() / 1000);
    if (nowSec > exp) return null;
    return obj;
  } catch {
    return null;
  }
}

export function parseSessionToken(token: string): SessionUser | null {
  const obj = parseSessionTokenPayload(token);
  if (!obj) return null;
  const userId = String(obj?.userId || "").trim();
  const username = String(obj?.username || "").trim();
  if (!userId || !username) return null;
  return { userId, username };
}

export function getUserFromRequest(req: Request): SessionUser | null {
  const cookieHeader = req.headers.get("cookie") || "";
  const token = getCookieValue(cookieHeader, COOKIE_NAME);
  if (!token) return null;
  const obj = parseSessionTokenPayload(token);
  if (!obj) return null;
  const userId = String(obj?.userId || "").trim();
  const username = String(obj?.username || "").trim();
  if (!userId || !username) return null;

  // 若 token 带密码签名，则校验当前密码是否一致；不一致则强制下线
  const ps = String(obj?.ps || "").trim();
  if (ps) {
    const users = readUsersFromEnv();
    const hit = users.find((u) => u.username === username);
    if (!hit?.password) return null;
    const expectedPs = computePwdSig(username, hit.password);
    if (!expectedPs) return null;
    if (!timingSafeEqualText(ps, expectedPs)) return null;
  }

  return { userId, username };
}

export function readUsersFromEnv(): EnvAuthUser[] {
  const rawJson = String(process.env.AUTH_USERS_JSON || "").trim();
  if (rawJson) {
    try {
      const parsed = JSON.parse(rawJson);
      const arr = Array.isArray(parsed) ? parsed : [];
      return arr
        .map((x: any) => ({
          username: String(x?.username || "").trim(),
          password: String(x?.password || "").trim(),
          role: String(x?.role || "").trim() || undefined,
          related: String(x?.related || "").trim() || undefined,
        }))
        .filter((x) => x.username && x.password);
    } catch {
      return [];
    }
  }
  const u = String(process.env.AUTH_USERNAME || "").trim();
  const p = String(process.env.AUTH_PASSWORD || "").trim();
  const r = String(process.env.AUTH_ROLE || "").trim();
  if (u && p) return [{ username: u, password: p, role: r || undefined }];
  return [];
}

/**
 * 解析“图片广场”的归属 username（related 链最终指向的账号）：
 * - 默认返回自己
 * - 若配置了 related 且 related 指向一个存在的账号，则追溯 related 链路的最终目标（最多 10 跳，防止循环）
 */
export function resolveGalleryOwnerUsername(username: string): string {
  const u0 = String(username || "").trim();
  if (!u0) return "";
  const users = readUsersFromEnv();
  const relatedMap = new Map<string, string>();
  for (const u of users) {
    const name = String(u?.username || "").trim();
    if (!name) continue;
    relatedMap.set(name, String(u?.related || "").trim());
  }

  let cur = u0;
  const seen = new Set<string>([cur]);
  for (let i = 0; i < 10; i += 1) {
    const next = String(relatedMap.get(cur) || "").trim();
    if (!next || next === cur) break;
    // 仅允许关联到“存在于配置中的账号”，避免拼错导致越权/错路由
    if (!relatedMap.has(next)) break;
    if (seen.has(next)) break;
    cur = next;
    seen.add(cur);
  }
  return cur;
}

export function resolveGalleryOwnerUserId(username: string): string {
  const owner = resolveGalleryOwnerUsername(username);
  return owner ? toUserId(owner) : "";
}

/**
 * 解析“图片广场共享组”的所有 userId。
 * 规则：所有 related 链最终指向同一个 owner 的账号，视为同一共享组。
 * 这样既能“互相看到广场”，又不需要把数据强行写到同一个 userId 下。
 */
export function resolveGalleryGroupUserIds(username: string): string[] {
  const u0 = String(username || "").trim();
  if (!u0) return [];
  const users = readUsersFromEnv();

  const relatedMap = new Map<string, string>();
  for (const u of users) {
    const name = String(u?.username || "").trim();
    if (!name) continue;
    relatedMap.set(name, String(u?.related || "").trim());
  }

  const resolveOwner = (name0: string) => {
    let cur = String(name0 || "").trim();
    if (!cur) return "";
    const seen = new Set<string>([cur]);
    for (let i = 0; i < 10; i += 1) {
      const next = String(relatedMap.get(cur) || "").trim();
      if (!next || next === cur) break;
      if (!relatedMap.has(next)) break; // 只允许指向配置中存在的账号
      if (seen.has(next)) break;
      cur = next;
      seen.add(cur);
    }
    return cur;
  };

  const myOwner = resolveOwner(u0) || u0;
  const groupUsernames = Array.from(relatedMap.keys()).filter((u) => (resolveOwner(u) || u) === myOwner);
  // 保底把自己和 owner 加进去（即使没出现在 AUTH_USERS_JSON 解析结果里也不至于空）
  const uniq = new Set<string>([...groupUsernames, u0, myOwner].map((s) => String(s || "").trim()).filter(Boolean));
  return Array.from(uniq).map((u) => toUserId(u));
}

export function isSuperAdminUser(username: string, role?: string) {
  const u = String(username || "").trim();
  const r = String(role || "").trim();
  if (u === "admin") return true;
  return r === "super" || r === "superAdmin" || r === "root";
}

export function normalizeRole(username: string, role?: string) {
  const r = String(role || "").trim();
  if (r) return r;
  if (String(username || "").trim() === "admin") return "super";
  return "user";
}

export function resolveAuthzForUser(username: string, role?: string): ResolvedAuthz {
  const finalRole = normalizeRole(username, role);
  const isSuperAdmin = isSuperAdminUser(username, finalRole);
  if (isSuperAdmin) {
    return { role: "super", isSuperAdmin: true, permissions: ROLE_PERMISSIONS.super || { "*": true } };
  }
  return { role: finalRole, isSuperAdmin: false, permissions: ROLE_PERMISSIONS[finalRole] || {} };
}

export function resolveAuthzForUsername(username: string): ResolvedAuthz {
  const users = readUsersFromEnv();
  const hit = users.find((u) => u.username === username);
  return resolveAuthzForUser(username, hit?.role);
}

export function hasPermission(authz: ResolvedAuthz | null | undefined, permissionKey: string) {
  const key = String(permissionKey || "").trim();
  if (!key) return false;
  const a = authz || undefined;
  if (!a) return false;
  if (a.isSuperAdmin) return true;
  const perms = a.permissions && typeof a.permissions === "object" ? a.permissions : {};
  if (perms["*"] === true) return true;
  if (key.startsWith("api:") && perms["api:*"] === true) return true;
  return perms[key] === true;
}

export function requirePermission(req: Request, permissionKey: string) {
  const user = getUserFromRequest(req);
  if (!user) return { ok: false as const, status: 401 as const, error: "未登录" };
  const authz = resolveAuthzForUsername(user.username);
  if (!hasPermission(authz, permissionKey)) return { ok: false as const, status: 403 as const, error: "无权限" };
  return { ok: true as const, user, authz };
}

function resolveApiPermissionKey(pathname: string, method: string): string | null {
  const p = String(pathname || "").trim();
  const m = String(method || "").trim().toUpperCase() || "GET";
  const parts = p.split("/").filter(Boolean);
  if (parts[0] !== "api") return null;

  // auth 路由不做权限映射（由对应 route 自己处理）
  if (parts[1] === "auth") return "";

  if (parts[1] === "configs") {
    if (parts.length === 2) {
      if (m === "GET") return "api:configs:read";
      if (m === "POST") return "api:configs:write";
      return null;
    }
    if (parts.length === 3) {
      if (m === "GET") return "api:configs:read";
      if (m === "PUT" || m === "DELETE") return "api:configs:write";
      return null;
    }
  }

  if (parts[1] === "reference-images") {
    if (parts.length === 2) {
      if (m === "GET") return "api:reference-images:read";
      if (m === "POST") return "api:reference-images:sync";
      return null;
    }
    if (parts.length === 3 && parts[2] === "vectorize") {
      if (m === "POST") return "api:reference-images:vectorize";
      return null;
    }
    if (parts.length === 3 && parts[2] === "upload") {
      if (m === "POST") return "api:reference-images:upload";
      return null;
    }
  }

  if (parts[1] === "app-names") {
    if (parts.length === 2 && m === "GET") return "api:app-names:read";
    return null;
  }

  if (parts[1] === "batch-jobs") {
    if (parts.length === 2) {
      if (m === "GET") return "api:batch-jobs:read";
      return null;
    }
    if (parts.length === 3 && parts[2] === "start") {
      if (m === "POST") return "api:batch-jobs:start";
      return null;
    }
    if (parts.length === 3) {
      if (m === "GET") return "api:batch-jobs:read";
      return null;
    }
    if (parts.length === 4 && parts[3] === "retry") {
      if (m === "POST") return "api:batch-jobs:retry";
      return null;
    }
  }

  if (parts[1] === "generation-records") {
    if (parts.length === 2 && m === "GET") return "api:generation-records:read";
    return null;
  }

  if (parts[1] === "cut-jobs") {
    if (parts.length === 3 && (parts[2] === "start" || parts[2] === "start2")) {
      if (m === "POST") return "api:cut-jobs:start";
      return null;
    }
  }

  if (parts[1] === "cut-settings") {
    if (parts.length === 2 && (m === "GET" || m === "PUT")) return "api:cut-settings:write";
    return null;
  }

  if (parts[1] === "cut-records") {
    if (parts.length === 2 && m === "GET") return "api:cut-records:read";
    if (parts.length === 3 && parts[2] === "download" && m === "POST") return "api:cut-records:download";
    if (parts.length === 3 && parts[2] === "flags" && m === "POST") return "api:cut-records:flags";
    return null;
  }

  if (parts[1] === "crop-previews") {
    if (parts.length === 2 && m === "POST") return "api:crop-previews";
    return null;
  }

  if (parts[1] === "fireplay") {
    if (parts.length === 3 && parts[2] === "batch-upload" && m === "POST") return "api:fireplay:batch-upload";
    return null;
  }

  if (parts[1] === "image-edit") {
    if (parts.length === 3 && parts[2] === "chat" && (m === "POST" || m === "GET")) return "api:image-edit:chat";
    if (parts.length === 3 && parts[2] === "save" && m === "POST") return "api:image-edit:save";
    return null;
  }

  if (parts[1] === "run") {
    if (parts.length === 2 && (m === "GET" || m === "POST")) return "api:run";
    return null;
  }

  return null;
}

export function requireApiAccess(req: Request): ApiAccessGuard {
  const user = getUserFromRequest(req);
  if (!user) return { ok: false, status: 401, error: "未登录" };
  const authz = resolveAuthzForUsername(user.username);

  let pathname = "";
  try {
    pathname = new URL(req.url).pathname || "";
  } catch {
    pathname = "";
  }
  const permissionKey = resolveApiPermissionKey(pathname, (req as any).method);

  // 未映射的接口：仅超级管理员允许（避免漏配导致越权）
  if (permissionKey === null) {
    if (authz.isSuperAdmin) return { ok: true, user, authz, permissionKey: "*" };
    return { ok: false, status: 403, error: "未配置权限规则" };
  }

  // auth 路由（或显式“只需登录”）
  if (permissionKey === "") {
    return { ok: true, user, authz, permissionKey: "" };
  }

  if (!hasPermission(authz, permissionKey)) return { ok: false, status: 403, error: "无权限" };
  return { ok: true, user, authz, permissionKey };
}

