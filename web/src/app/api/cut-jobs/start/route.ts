import * as fs from "fs-extra";
import { join, normalize } from "path";
import { ObjectId } from "mongodb";
import { getMongoDb } from "@/lib/server/mongodb";
import { startCutJob } from "@/lib/server/batchJobRunner";
import { requireApiAccess } from "@/lib/server/auth";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const envInt = (name: string, fallback: number) => {
  const raw = String(process.env[name] ?? "").trim();
  const n = raw ? Number(raw) : NaN;
  if (!Number.isFinite(n)) return fallback;
  return Math.max(1, Math.floor(n));
};

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
        if (d.includes("/") || d.includes("\\"))
          throw new Error("非法路径");
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

  const templateNames = ["getCutLogoFinalPrompt", "getCutOtherFinalPrompt", "getCutScaleFinalPrompt"];
  const ratios = ["1:1", "4:5"];
  const stitchTemplateName = "stitchLongImage1024";
  const verticalCollageTemplateName = "getCutVerticalCollagePrompt";

  const now = new Date();
  const itemDocs: Omit<CutJobItemDoc, "_id" | "jobId">[] = [];

  if (!isRegenerate) {
    for (const it of images) {
      const url = String((it as any)?.url || "").trim();
      if (!url) continue;
      const appName = (it as any)?.appName ? String((it as any).appName) : undefined;
      const lang = (it as any)?.lang ? String((it as any).lang) : undefined;

      const abs = publicUrlToAbsPath(url);
      const exists = await fs.pathExists(abs);
      if (!exists) {
        return Response.json({ ok: false, error: `图片不存在: ${url}` }, { status: 400 });
      }

      for (const ratio of ratios) {
        for (const templateName of templateNames) {
          itemDocs.push({
            userId: user.userId,
            sourceUrl: url,
            sourceAbsPath: abs,
            appName,
            lang,
            ratio,
            templateName,
            status: "queued",
            total: 1,
            done: 0,
            createdAt: now,
            updatedAt: now,
          });
        }
        if (ratio === "4:5") {
          itemDocs.push({
            userId: user.userId,
            sourceUrl: url,
            sourceAbsPath: abs,
            appName,
            lang,
            ratio,
            templateName: verticalCollageTemplateName,
            status: "queued",
            total: 1,
            done: 0,
            createdAt: now,
            updatedAt: now,
          });
        }
      }
      itemDocs.push({
        userId: user.userId,
        sourceUrl: url,
        sourceAbsPath: abs,
        appName,
        lang,
        ratio: "1:1",
        templateName: stitchTemplateName,
        status: "queued",
        total: 1,
        done: 0,
        createdAt: now,
        updatedAt: now,
      });
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
      const exists = await fs.pathExists(abs);
      if (!exists) {
        return Response.json({ ok: false, error: `图片不存在: ${url}` }, { status: 400 });
      }

      itemDocs.push({
        userId: user.userId,
        sourceUrl: url,
        sourceAbsPath: abs,
        appName,
        lang,
        ratio,
        templateName,
        status: "queued",
        total: 1,
        done: 0,
        createdAt: now,
        updatedAt: now,
      });
    }
  }

  if (!itemDocs.length) {
    return Response.json({ ok: false, error: "没有可创建的裁图任务" }, { status: 400 });
  }

  const db = await getMongoDb();
  const jobsCol = db.collection("batch_jobs");
  const cutItemsCol = db.collection<CutJobItemDoc>("cut_job_items");
  const cutRecordsCol = db.collection<CutRecordDoc>("cut_records");

  const total = itemDocs.length;
  const job = {
    userId: user.userId,
    username: user.username,
    role: guard.authz.role,
    isSuperAdmin: guard.authz.isSuperAdmin,
    status: "queued",
    concurrency,
    total,
    done: 0,
    createdAt: now,
    updatedAt: now,
    extra: { type: "cut" },
  };
  const insertJob = await jobsCol.insertOne(job as any);
  const jobId = insertJob.insertedId as ObjectId;

  if (!isRegenerate) {
    // upsert 聚合记录：同一张原图（按 sourceAbsPath）后续再次裁剪会覆盖 outputs
    const recordOps: any[] = [];
    for (const it of images) {
      const url = String((it as any)?.url || "").trim();
      if (!url) continue;
      const appName = (it as any)?.appName ? String((it as any).appName) : undefined;
      const lang = (it as any)?.lang ? String((it as any).lang) : undefined;
      const abs = publicUrlToAbsPath(url);
      const reset: any = {};
      for (const ratio of ratios) {
        for (const templateName of templateNames) {
          reset[`outputs.${ratio}.${templateName}`] = { status: "queued", updatedAt: now };
        }
        if (ratio === "4:5") {
          reset[`outputs.${ratio}.${verticalCollageTemplateName}`] = { status: "queued", updatedAt: now };
        }
      }
      reset[`outputs.1:1.${stitchTemplateName}`] = { status: "queued", updatedAt: now };
      recordOps.push({
        updateOne: {
          filter: { userId: user.userId, sourceAbsPath: abs },
          update: {
            $set: { userId: user.userId, jobId, sourceUrl: url, sourceAbsPath: abs, appName, lang, status: "queued", updatedAt: now, ...reset },
            $setOnInsert: { createdAt: now },
          },
          upsert: true,
        },
      });
    }
    if (recordOps.length) await cutRecordsCol.bulkWrite(recordOps as any[], { ordered: false } as any);
  } else {
    const byAbs = new Map<string, { sourceUrl: string; sourceAbsPath: string; appName?: string; lang?: string; set: any }>();
    for (const it of itemDocs) {
      const abs = String(it.sourceAbsPath);
      const got = byAbs.get(abs) || { sourceUrl: it.sourceUrl, sourceAbsPath: abs, appName: it.appName, lang: it.lang, set: {} as any };
      got.sourceUrl = it.sourceUrl;
      got.appName = it.appName;
      got.lang = it.lang;
      got.set[`outputs.${String(it.ratio)}.${String(it.templateName)}`] = { status: "queued", updatedAt: now };
      byAbs.set(abs, got);
    }
    for (const v of byAbs.values()) {
      try {
        await cutRecordsCol.updateOne(
          { userId: user.userId, sourceAbsPath: v.sourceAbsPath } as any,
          {
            $set: { userId: user.userId, jobId, sourceUrl: v.sourceUrl, sourceAbsPath: v.sourceAbsPath, appName: v.appName, lang: v.lang, status: "queued", updatedAt: now, ...v.set } as any,
            $setOnInsert: { createdAt: now } as any,
          } as any,
          { upsert: true } as any
        );
      } catch {
      }
    }
  }

  await cutItemsCol.insertMany(itemDocs.map((x) => ({ ...x, jobId })) as any[]);

  await startCutJob({
    jobId: String(jobId),
    concurrency,
  });

  return Response.json({ ok: true, jobId: String(jobId), createdItems: total });
}

