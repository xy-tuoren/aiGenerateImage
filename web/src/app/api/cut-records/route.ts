import { ObjectId } from "mongodb";
import { getMongoDb } from "@/lib/server/mongodb";
import { requireApiAccess, resolveGalleryGroupUserIds } from "@/lib/server/auth";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

type CutRecordOutputItem = {
  status: "queued" | "running" | "completed" | "failed";
  outputUrl?: string;
  outputMimeType?: string;
  error?: string;
  updatedAt?: Date;
};

type CutRecordDoc = {
  _id?: ObjectId;
  userId: string;
  jobId?: ObjectId;
  sourceUrl: string;
  sourceAbsPath: string;
  appName?: string;
  lang?: string;
  status?: "queued" | "running" | "completed" | "failed";
  outputs?: Record<string, Record<string, CutRecordOutputItem>>;
  createdAt: Date;
  updatedAt: Date;
};

function escapeRegex(s: string) {
  return s.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

function deriveStatus(outputs: CutRecordDoc["outputs"]): "queued" | "running" | "completed" | "failed" {
  const o = outputs && typeof outputs === "object" ? outputs : undefined;
  if (!o) return "queued";
  let hasQueued = false;
  let hasRunning = false;
  let hasCompleted = false;
  for (const ratioKey of Object.keys(o)) {
    const byTpl = o[ratioKey];
    if (!byTpl || typeof byTpl !== "object") continue;
    for (const tplKey of Object.keys(byTpl)) {
      const it = byTpl[tplKey];
      const s = it?.status;
      if (s === "failed") return "failed";
      if (s === "running") hasRunning = true;
      else if (s === "queued") hasQueued = true;
      else if (s === "completed") hasCompleted = true;
    }
  }
  if (hasRunning) return "running";
  if (hasQueued) return "queued";
  if (hasCompleted) return "completed";
  return "queued";
}

export async function GET(req: Request) {
  const guard = requireApiAccess(req);
  if (!guard.ok) return Response.json({ ok: false, error: guard.error }, { status: guard.status });
  const user = guard.user;
  const { searchParams } = new URL(req.url);
  const scope = String(searchParams.get("scope") || "").trim();
  const useGalleryScope = scope === "gallery";
  const groupUserIds = useGalleryScope ? resolveGalleryGroupUserIds(user.username) : [];
  const limitRaw = searchParams.get("limit");
  const pageRaw = searchParams.get("page");
  const pageSizeRaw = searchParams.get("pageSize") ?? searchParams.get("page_size");
  const hasPaging = pageRaw !== null || pageSizeRaw !== null;

  // legacy mode (no page/pageSize): limit-only, max 5000
  const limit = Math.min(5000, Math.max(1, Number(limitRaw ?? 200) || 200));

  // paging mode: page + pageSize, pageSize max 200
  const page = Math.max(1, Number(pageRaw ?? 1) || 1);
  const pageSize = Math.min(200, Math.max(1, Number(pageSizeRaw ?? 15) || 15));
  const status = (searchParams.get("status") || "").trim();
  const appName = (searchParams.get("appName") || "").trim();
  const lang = (searchParams.get("lang") || "").trim();
  const jobId = (searchParams.get("jobId") || "").trim();

  const filter: any = {};
  filter.userId = useGalleryScope && groupUserIds.length ? { $in: groupUserIds } : user.userId;
  if (status) {
    if (status !== "queued" && status !== "running" && status !== "completed" && status !== "failed") {
      return Response.json({ ok: false, error: "status 非法" }, { status: 400 });
    }
    // NOTE: status 字段可能不完全等于派生状态（outputs 内部状态）。目前仅作为粗过滤条件。
    filter.status = status;
  }
  if (appName) filter.appName = { $regex: new RegExp(`^${escapeRegex(appName)}$`, "i") };
  if (lang) filter.lang = { $regex: new RegExp(`^${escapeRegex(lang)}$`, "i") };
  if (jobId) {
    if (!ObjectId.isValid(jobId)) return Response.json({ ok: false, error: "jobId 非法" }, { status: 400 });
    filter.jobId = new ObjectId(jobId);
  }

  const db = await getMongoDb();
  const col = db.collection<CutRecordDoc>("cut_records");
  const sort = { updatedAt: -1 } as any;
  let docs: CutRecordDoc[] = [];
  let total: number | undefined;
  if (hasPaging) {
    total = await col.countDocuments(filter as any);
    const skip = (page - 1) * pageSize;
    docs = await col.find(filter as any, { sort, skip, limit: pageSize } as any).toArray();
  } else {
    docs = await col.find(filter as any, { sort, limit } as any).toArray();
  }

  const items = docs.map((d: any) => {
    const derived = d.outputs ? deriveStatus(d.outputs) : (d.status || "queued");
    return {
      id: String(d._id),
      jobId: d.jobId ? String(d.jobId) : undefined,
      sourceUrl: d.sourceUrl,
      sourceAbsPath: d.sourceAbsPath,
      appName: d.appName,
      lang: d.lang,
      status: derived,
      outputs: d.outputs,
      createdAt: d.createdAt,
      updatedAt: d.updatedAt,
    };
  });

  if (hasPaging) {
    return Response.json({ ok: true, items, total: total ?? 0, page, pageSize });
  }
  return Response.json({ ok: true, items });
}

