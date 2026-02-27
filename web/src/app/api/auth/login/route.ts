import { NextRequest, NextResponse } from "next/server";
import { buildSessionToken, computePwdSig, getSessionCookieName, getSessionMaxAgeSeconds, readUsersFromEnv, resolveAuthzForUser, toUserId } from "@/lib/server/auth";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

function isHttpsRequest(req: NextRequest) {
  const xfProto = String(req.headers.get("x-forwarded-proto") || "").split(",")[0].trim().toLowerCase();
  if (xfProto) return xfProto === "https";
  try {
    return new URL(req.url).protocol === "https:";
  } catch {
    return false;
  }
}

export async function POST(req: NextRequest) {
  const body = await req.json().catch(() => null);
  if (!body || typeof body !== "object") {
    return NextResponse.json({ ok: false, error: "body 必须是 JSON 对象" }, { status: 400 });
  }
  const username = String((body as any).username || "").trim();
  const password = String((body as any).password || "").trim();
  if (!username || !password) {
    return NextResponse.json({ ok: false, error: "username / password 不能为空" }, { status: 400 });
  }

  const users = readUsersFromEnv();
  if (!users.length) {
    return NextResponse.json({ ok: false, error: "未配置登录账号：请设置 AUTH_USERS_JSON 或 AUTH_USERNAME/AUTH_PASSWORD" }, { status: 500 });
  }
  const hit = users.find((u) => u.username === username && u.password === password);
  if (!hit) {
    return NextResponse.json({ ok: false, error: "账号或密码错误" }, { status: 401 });
  }

  const authz = resolveAuthzForUser(username, hit.role);
  const sessionUser = { userId: toUserId(username), username };
  const user = { ...sessionUser, role: authz.role, isSuperAdmin: authz.isSuperAdmin, permissions: authz.permissions };
  const token = buildSessionToken(sessionUser, computePwdSig(username, hit.password));
  if (!token) {
    return NextResponse.json({ ok: false, error: "AUTH_SECRET 未配置（生产环境必须配置）" }, { status: 500 });
  }

  const res = NextResponse.json({ ok: true, user });
  res.cookies.set(getSessionCookieName(), token, {
    httpOnly: true,
    sameSite: "lax",
    secure: isHttpsRequest(req),
    path: "/",
    maxAge: getSessionMaxAgeSeconds(),
  });
  return res;
}

