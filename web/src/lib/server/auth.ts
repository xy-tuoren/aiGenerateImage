import crypto from "crypto";

export type SessionUser = {
  userId: string;
  username: string;
};

const COOKIE_NAME = "bg_session";
const SESSION_MAX_AGE_SECONDS = 7 * 24 * 60 * 60;

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

export function buildSessionToken(user: SessionUser) {
  const secret = getAuthSecret();
  if (!secret) return "";
  const nowSec = Math.floor(Date.now() / 1000);
  const payload = {
    v: 1,
    userId: String(user.userId || "").trim(),
    username: String(user.username || "").trim(),
    iat: nowSec,
    exp: nowSec + SESSION_MAX_AGE_SECONDS,
  };
  const payloadJson = JSON.stringify(payload);
  const payloadB64 = base64UrlEncode(payloadJson);
  const sig = sign(payloadB64);
  if (!sig) return "";
  return `${payloadB64}.${sig}`;
}

export function parseSessionToken(token: string): SessionUser | null {
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
    const userId = String(obj?.userId || "").trim();
    const username = String(obj?.username || "").trim();
    if (!userId || !username) return null;
    return { userId, username };
  } catch {
    return null;
  }
}

export function getUserFromRequest(req: Request): SessionUser | null {
  const cookieHeader = req.headers.get("cookie") || "";
  const token = getCookieValue(cookieHeader, COOKIE_NAME);
  if (!token) return null;
  return parseSessionToken(token);
}

export function readUsersFromEnv(): Array<{ username: string; password: string }> {
  const rawJson = String(process.env.AUTH_USERS_JSON || "").trim();
  if (rawJson) {
    try {
      const parsed = JSON.parse(rawJson);
      const arr = Array.isArray(parsed) ? parsed : [];
      return arr
        .map((x: any) => ({ username: String(x?.username || "").trim(), password: String(x?.password || "").trim() }))
        .filter((x) => x.username && x.password);
    } catch {
      return [];
    }
  }
  const u = String(process.env.AUTH_USERNAME || "").trim();
  const p = String(process.env.AUTH_PASSWORD || "").trim();
  if (u && p) return [{ username: u, password: p }];
  return [];
}

