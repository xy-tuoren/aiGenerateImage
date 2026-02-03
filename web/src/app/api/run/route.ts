import { getUserFromRequest } from "@/lib/server/auth";
import { getMongoDb } from "@/lib/server/mongodb";
import { toUserId } from "@/lib/server/auth";

async function migrateAllToAdmin() {
  const adminUsername = "admin";
  const adminUserId = toUserId(adminUsername);
  const db = await getMongoDb();

  const targets: Array<{ name: string; setUsername: boolean }> = [
    { name: "image_configs", setUsername: true },
    { name: "batch_jobs", setUsername: true },
    { name: "batch_job_configs", setUsername: true },
    { name: "generated_images", setUsername: false },
    { name: "generation_records", setUsername: false },
    { name: "cut_job_items", setUsername: false },
    { name: "cut_records", setUsername: false },
    { name: "fireplay_upload_records", setUsername: false },
  ];

  const existing = new Set((await db.listCollections().toArray()).map((c: any) => String(c?.name || "").trim()).filter(Boolean));

  const results: Array<{ name: string; matched?: number; modified?: number; skipped?: boolean; reason?: string }> = [];
  for (const t of targets) {
    if (!existing.has(t.name)) {
      results.push({ name: t.name, skipped: true, reason: "missing" });
      continue;
    }
    const col = db.collection(t.name);
    const $set: any = { userId: adminUserId };
    if (t.setUsername) $set.username = adminUsername;
    const r = await col.updateMany({}, { $set } as any);
    results.push({ name: t.name, matched: r.matchedCount, modified: r.modifiedCount });
  }

  return { adminUserId, adminUsername, results };
}

function requireAdmin(req: Request) {
  const user = getUserFromRequest(req);
  if (!user) return { ok: false as const, status: 401 as const, error: "未登录" };
  if (String(user.username || "").trim() !== "admin") return { ok: false as const, status: 403 as const, error: "仅 admin 可执行" };
  return { ok: true as const, user };
}

export async function GET(req: Request) {
  const { searchParams } = new URL(req.url);
  const action = String(searchParams.get("action") || "").trim();
  if (action !== "migrateToAdmin") {
    return Response.json({ ok: true, note: "ok" });
  }
  const guard = requireAdmin(req);
  if (!guard.ok) return Response.json({ ok: false, error: guard.error }, { status: guard.status });
  const migrated = await migrateAllToAdmin();
  return Response.json({ ok: true, ...migrated });
}

export async function POST(req: Request) {
  const user = getUserFromRequest(req);
  if (!user) return Response.json({ ok: false, error: "未登录" }, { status: 401 });
  const body = await req.json().catch(() => ({}));
  const action = String((body as any)?.action || "").trim();
  if (action === "migrateToAdmin") {
    const guard = requireAdmin(req);
    if (!guard.ok) return Response.json({ ok: false, error: guard.error }, { status: guard.status });
    const migrated = await migrateAllToAdmin();
    return Response.json({ ok: true, ...migrated });
  }
  const id = `${Date.now()}`;
  return Response.json({ ok: true, id });
}

