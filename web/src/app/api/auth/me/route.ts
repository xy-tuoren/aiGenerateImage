import { NextRequest } from "next/server";
import { getUserFromRequest, resolveAuthzForUsername } from "@/lib/server/auth";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function GET(req: NextRequest) {
  const headers = { "Cache-Control": "no-store, max-age=0", Vary: "Cookie" };
  const user = getUserFromRequest(req);
  if (!user) return Response.json({ ok: false, error: "未登录" }, { status: 401, headers });
  const authz = resolveAuthzForUsername(user.username);
  return Response.json(
    { ok: true, user: { ...user, role: authz.role, isSuperAdmin: authz.isSuperAdmin, permissions: authz.permissions } },
    { headers }
  );
}

