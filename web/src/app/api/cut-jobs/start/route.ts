import * as fs from "fs-extra";
import { join, normalize } from "path";
import { ObjectId } from "mongodb";
import { getMongoDb } from "@/lib/server/mongodb";
import { startCutJob } from "@/lib/server/batchJobRunner";
import { getCutTemplatesForAppRatio } from "@/lib/server/utils";
import { requireApiAccess, resolveGalleryOwnerUserId } from "@/lib/server/auth";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const envInt = (name: string, fallback: number) => {
  const raw = String(process.env[name] ?? "").trim();
  const n = raw ? Number(raw) : NaN;
  if (!Number.isFinite(n)) return fallback;
  return Math.max(1, Math.floor(n));
};

let ensuredLockIndex = false;

type CutJobItemDoc = {
  _id?: ObjectId;
  userId: string;
  jobId: ObjectId;
  sourceUrl: string;
  sourceAbsPath: string;
  appName?: string;
  lang?: string;
  ratio: string;
  templateName: string;
  status: "queued" | "running" | "completed" | "failed";
  total: number;
  done: number;
  error?: string;
  outputUrl?: string;
  outputMimeType?: string;
  createdAt: Date;
  updatedAt: Date;
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
  outputs?: Record<string, Record<string, any>>;
  createdAt: Date;
  updatedAt: Date;
};

type CutDedupeLockDoc = {
  _id?: ObjectId;
  ownerUserId: string;
  sourceUrl: string;
  sourceAbsPath: string;
  ratio: string;
  templateName: string;
  status: "queued" | "running" | "completed" | "failed";
  requestId: string;
  operatorUserId: string;
  operatorUsername: string;
  createdAt: Date;
  updatedAt: Date;
};

function publicUrlToAbsPath(u: string) {
  const url = String(u || "").trim();
  if (!url.startsWith("/")) throw new Error("url 必须是站内路径（以 / 开头）");
  const rawPath = url.split("?")[0].split("#")[0];
  const decodedPath = rawPath
    .split("/")
    .map((seg, idx) => {
      if (idx === 0) return seg; // leading ""
      if (!seg) return seg;
      try {
        const d = decodeURIComponent(seg);
        if (d.includes("/") || d.includes("\\")) throw new Error("非法路径");
        return d;
      } catch {
        return seg;
      }
    })
    .join("/");
  const rel = normalize(decodedPath).replaceAll("\\", "/");
  if (rel.includes("..")) throw new Error("非法路径");
  return join(process.cwd(), "public", rel.replace(/^\//, ""));
}

export async function POST(req: Request) {
  const guard = requireApiAccess(req);
  if (!guard.ok) return Response.json({ ok: false, error: guard.error }, { status: guard.status });
  const user = guard.user;

  const { searchParams } = new URL(req.url);
  const scope = String(searchParams.get("scope") || "").trim();
  const useGalleryScope = scope === "gallery";

  const operatorUserId = user.userId;
  const operatorUsername = String(user.username || "").trim();
  const ownerUserId = useGalleryScope ? (resolveGalleryOwnerUserId(user.username) || user.userId) : user.userId;

  const body = await req.json().catch(() => null);
  if (!body || typeof body !== "object") {
    return Response.json({ ok: false, error: "body 必须是 JSON 对象" }, { status: 400 });
  }

  const imagesRaw = (body as any).images;
  const images = Array.isArray(imagesRaw) ? imagesRaw : [];
  const itemsRaw = (body as any).items;
  const items = Array.isArray(itemsRaw) ? itemsRaw : [];
  const isRegenerate = items.length > 0;
  if (!images.length && !items.length) {
    return Response.json({ ok: false, error: "images / items 不能为空" }, { status: 400 });
  }

  const nonAdminMax = envInt("NON_ADMIN_CONCURRENCY_MAX", 10);
  const concurrencyRaw = Math.max(1, Number((body as any).concurrency ?? 8) || 8);
  const concurrency = guard.authz.isSuperAdmin ? concurrencyRaw : Math.min(concurrencyRaw, nonAdminMax);

  const ratios = ["1:1", "4:5"];

  const now = new Date();
  const requestId = new ObjectId();

  const db = await getMongoDb();
  const jobsCol = db.collection("batch_jobs");
  const cutItemsCol = db.collection<CutJobItemDoc>("cut_job_items");
  const cutRecordsCol = db.collection<CutRecordDoc>("cut_records");
  const locksCol = db.collection<CutDedupeLockDoc>("cut_dedupe_locks");

  if (useGalleryScope && !ensuredLockIndex) {
    ensuredLockIndex = true;
    void locksCol
      .createIndex({ ownerUserId: 1, sourceAbsPath: 1, ratio: 1, templateName: 1 }, { unique: true } as any)
      .catch(() => { });
  }

  const claimLock = async (d: { url: string; abs: string; ratio: string; templateName: string }) => {
    if (!useGalleryScope) return true;
    const staleMs = 30 * 60 * 1000;
    const staleBefore = new Date(Date.now() - staleMs);
    const filter: any = {
      ownerUserId,
      sourceAbsPath: d.abs,
      ratio: d.ratio,
      templateName: d.templateName,
      $or: [{ status: { $exists: false } }, { status: "failed" }, { updatedAt: { $lt: staleBefore } }],
    };
    const update: any = {
      $set: {
        ownerUserId,
        sourceUrl: d.url,
        sourceAbsPath: d.abs,
        ratio: d.ratio,
        templateName: d.templateName,
        status: "queued",
        requestId: String(requestId),
        operatorUserId,
        operatorUsername,
        updatedAt: now,
      },
      $setOnInsert: { createdAt: now },
    };
    try {
      const r: any = await locksCol.updateOne(filter, update, { upsert: true } as any);
      return Boolean(r?.modifiedCount) || Boolean(r?.upsertedCount);
    } catch (e: any) {
      const msg = String(e?.message || "");
      if (msg.includes("E11000")) return false;
      return false;
    }
  };

  // Build desired outputs list
  const desired: Array<{ url: string; abs: string; appName?: string; lang?: string; ratio: string; templateName: string }> = [];
  if (!isRegenerate) {
    for (const it of images) {
      const url = String((it as any)?.url || "").trim();
      if (!url) continue;
      const appName = (it as any)?.appName ? String((it as any).appName) : undefined;
      const lang = (it as any)?.lang ? String((it as any).lang) : undefined;
      const abs = publicUrlToAbsPath(url);
      if (!(await fs.pathExists(abs))) return Response.json({ ok: false, error: `图片不存在: ${url}` }, { status: 400 });

      for (const ratio of ratios) {
        const templateNames = getCutTemplatesForAppRatio(appName, ratio);
        for (const templateName of templateNames) desired.push({ url, abs, appName, lang, ratio, templateName });
      }
    }
  } else {
    for (const it of items) {
      const url = String((it as any)?.sourceUrl || (it as any)?.url || "").trim();
      if (!url) continue;
      const ratio = String((it as any)?.ratio || "").trim();
      const templateName = String((it as any)?.templateName || "").trim();
      const appName = (it as any)?.appName ? String((it as any).appName) : undefined;
      const lang = (it as any)?.lang ? String((it as any).lang) : undefined;
      if (!ratio || !templateName) continue;
      const abs = publicUrlToAbsPath(url);
      if (!(await fs.pathExists(abs))) return Response.json({ ok: false, error: `图片不存在: ${url}` }, { status: 400 });
      desired.push({ url, abs, appName, lang, ratio, templateName });
    }
  }

  // Claim locks (gallery scope) and collect claimed
  const claimed: typeof desired = [];
  for (const d of desired) {
    const ok = await claimLock({ url: d.url, abs: d.abs, ratio: d.ratio, templateName: d.templateName });
    if (ok) claimed.push(d);
  }

  if (!claimed.length) return Response.json({ ok: true, jobId: null, createdItems: 0, skipped: true });

  // Upsert operator cut_records: only for claimed outputs
  try {
    const byAbs = new Map<string, { sourceUrl: string; sourceAbsPath: string; appName?: string; lang?: string; set: any }>();
    for (const c of claimed) {
      const abs = String(c.abs);
      const got = byAbs.get(abs) || { sourceUrl: c.url, sourceAbsPath: abs, appName: c.appName, lang: c.lang, set: {} as any };
      got.sourceUrl = c.url;
      got.appName = c.appName;
      got.lang = c.lang;
      got.set[`outputs.${String(c.ratio)}.${String(c.templateName)}`] = { status: "queued", updatedAt: now };
      byAbs.set(abs, got);
    }
    const ops: any[] = [];
    for (const v of byAbs.values()) {
      ops.push({
        updateOne: {
          filter: { userId: operatorUserId, sourceAbsPath: v.sourceAbsPath } as any,
          update: {
            $set: {
              userId: operatorUserId,
              sourceUrl: v.sourceUrl,
              sourceAbsPath: v.sourceAbsPath,
              ...(v.appName ? { appName: v.appName } : {}),
              ...(v.lang ? { lang: v.lang } : {}),
              status: "queued",
              updatedAt: now,
              ...v.set,
            } as any,
            $setOnInsert: { createdAt: now } as any,
          } as any,
          upsert: true,
        },
      });
    }
    if (ops.length) await cutRecordsCol.bulkWrite(ops as any[], { ordered: false } as any);
  } catch { }

  const total = claimed.length;
  const job = {
    userId: operatorUserId,
    username: operatorUsername,
    role: guard.authz.role,
    isSuperAdmin: guard.authz.isSuperAdmin,
    status: "queued",
    concurrency,
    total,
    done: 0,
    createdAt: now,
    updatedAt: now,
    extra: useGalleryScope ? { type: "cut", scope: "gallery", ownerUserId } : { type: "cut" },
  };
  const insertJob = await jobsCol.insertOne(job as any);
  const jobId = insertJob.insertedId as ObjectId;

  try {
    const absSet = Array.from(new Set(claimed.map((x) => String(x.abs || "").trim()).filter(Boolean)));
    if (absSet.length) await cutRecordsCol.updateMany({ userId: operatorUserId, sourceAbsPath: { $in: absSet } } as any, { $set: { jobId, updatedAt: now } } as any);
  } catch { }

  const itemDocs: Array<Omit<CutJobItemDoc, "_id">> = claimed.map((c) => ({
    userId: operatorUserId,
    jobId,
    sourceUrl: c.url,
    sourceAbsPath: c.abs,
    appName: c.appName,
    lang: c.lang,
    ratio: c.ratio,
    templateName: c.templateName,
    status: "queued",
    total: 1,
    done: 0,
    createdAt: now,
    updatedAt: now,
  }));
  await cutItemsCol.insertMany(itemDocs as any[]);

  await startCutJob({ jobId: String(jobId), concurrency });
  return Response.json({ ok: true, jobId: String(jobId), createdItems: total });
}
