import { NextRequest, NextResponse } from "next/server";
import { getSessionCookieName } from "@/lib/server/auth";

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
  const secure = isHttpsRequest(req);
  const res = NextResponse.json({ ok: true });
  res.cookies.delete(getSessionCookieName());
  res.cookies.set(getSessionCookieName(), "", {
    httpOnly: true,
    sameSite: "lax",
    secure,
    path: "/",
    maxAge: 0,
    expires: new Date(0),
  });
  return res;
}

