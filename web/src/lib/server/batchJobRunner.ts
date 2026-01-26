import * as asyncLib from "async";
import * as fs from "fs-extra";
import { join } from "path";
import { ObjectId } from "mongodb";
import { getMongoDb } from "@/lib/server/mongodb";
import { GeminiClient } from "@/lib/server/gemini";
import * as promptFns from "@/common/prompt";
import { resizeImageByAspectRatio } from "@/lib/server/utils";

type ImageConfigDoc = {
  _id: ObjectId;
  prompt: string;
  referenceImages?: string[];
  generationConfig?: Record<string, unknown>;
  imageConfig?: Record<string, unknown>;
  responseModalities?: string[];
  output?: string;
  count?: number;
  nextPromptFun?: string[];
  appName?: string;
  lang?: string;
  batchFun?: string;
  promptTmpFunName?: string;
  extra?: Record<string, unknown>;
};

type BatchJobDoc = {
  _id?: ObjectId;
  status: "queued" | "running" | "completed" | "failed";
  concurrency: number;
  total: number;
  done: number;
  createdAt: Date;
  updatedAt: Date;
  error?: string;
};

type BatchJobConfigDoc = {
  _id?: ObjectId;
  jobId: ObjectId;
  configId: ObjectId;
  status: "queued" | "running" | "completed" | "failed";
  total: number;
  done: number;
  error?: string;
  createdAt: Date;
  updatedAt: Date;
};

type GeneratedImageDoc = {
  _id?: ObjectId;
  jobId: ObjectId;
  configId: ObjectId;
  index: number;
  url: string;
  filePath: string;
  mimeType: string;
  createdAt: Date;
  prompt: string;
  appName?: string;
  lang?: string;
  referenceImages?: string[];
};

type GenerationRecordDoc = {
  _id?: ObjectId;
  jobId: ObjectId;
  configId: ObjectId;
  index: number;
  status: "completed" | "failed";
  prompt: string;
  error?: string;
  url?: string;
  mimeType?: string;
  createdAt: Date;
  appName?: string;
  lang?: string;
  referenceImages?: string[];
};

type StartJobInput = {
  jobId: string;
  configIds: string[];
  concurrency: number;
};

declare global {
  var __batchJobRunning: Map<string, Promise<void>> | undefined;
  var __cutJobRunning: Map<string, Promise<void>> | undefined;
}

const runningMap = global.__batchJobRunning ?? (global.__batchJobRunning = new Map<string, Promise<void>>());
const cutRunningMap = global.__cutJobRunning ?? (global.__cutJobRunning = new Map<string, Promise<void>>());

type CutJobItemDoc = {
  _id?: ObjectId;
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
  outputFilePath?: string;
  outputMimeType?: string;
  createdAt: Date;
  updatedAt: Date;
};

function extFromMime(mimeType: string) {
  const t = (mimeType || "").toLowerCase();
  if (t.includes("png")) return "png";
  if (t.includes("webp")) return "webp";
  if (t.includes("gif")) return "gif";
  if (t.includes("jpeg") || t.includes("jpg")) return "jpg";
  return "png";
}

function guessMimeFromPath(p: string) {
  const lower = (p || "").toLowerCase();
  if (lower.endsWith(".png")) return "image/png";
  if (lower.endsWith(".webp")) return "image/webp";
  if (lower.endsWith(".gif")) return "image/gif";
  if (lower.endsWith(".jpg") || lower.endsWith(".jpeg")) return "image/jpeg";
  return "image/jpeg";
}

function safePathSegment(input: unknown) {
  const s = String(input ?? "").trim();
  const cleaned = s.replace(/[<>:"/\\|?*\u0000-\u001F]/g, "_").replace(/\s+/g, " ").trim();
  return cleaned || "unknown";
}

function parseAspectRatio(aspectRatio: unknown): { w: number; h: number } | null {
  const s = String(aspectRatio ?? "").trim();
  const m = s.match(/^(\d+(?:\.\d+)?)\s*:\s*(\d+(?:\.\d+)?)$/);
  if (!m) return null;
  const w = Number(m[1]);
  const h = Number(m[2]);
  if (!Number.isFinite(w) || !Number.isFinite(h) || w <= 0 || h <= 0) return null;
  return { w, h };
}

function aspectRatioToken(aspectRatio: unknown) {
  const r = parseAspectRatio(aspectRatio) || { w: 1, h: 1 };
  const w = Number.isInteger(r.w) ? String(r.w) : String(r.w).replaceAll(".", "_");
  const h = Number.isInteger(r.h) ? String(r.h) : String(r.h).replaceAll(".", "_");
  return `${w}x${h}`;
}

function isImageFileName(name: string) {
  const lower = String(name || "").toLowerCase();
  return (
    lower.endsWith(".png") ||
    lower.endsWith(".webp") ||
    lower.endsWith(".gif") ||
    lower.endsWith(".jpg") ||
    lower.endsWith(".jpeg") ||
    lower.endsWith(".jfif")
  );
}

async function collectImagesFromDirRecursive(dir: string): Promise<string[]> {
  const root = String(dir || "").trim();
  if (!root) return [];
  const st = await fs.stat(root).catch(() => null);
  if (!st) throw new Error(`参考图不存在: ${root}`);
  if (!st.isDirectory()) throw new Error(`参考图不是目录: ${root}`);

  const results: string[] = [];
  const walk = async (d: string) => {
    const names = await fs.readdir(d).catch(() => []);
    const sorted = [...names].sort();
    for (const name of sorted) {
      const abs = join(d, name);
      const s = await fs.stat(abs).catch(() => null);
      if (!s) continue;
      if (s.isDirectory()) {
        await walk(abs);
        continue;
      }
      if (s.isFile() && isImageFileName(name)) results.push(abs);
    }
  };

  await walk(root);
  return results;
}

async function expandReferenceToPaths(ref: string): Promise<string[]> {
  const r = String(ref || "").trim();
  if (!r) return [];
  if (/^https?:\/\//i.test(r)) return [r];
  const st = await fs.stat(r).catch(() => null);
  if (!st) throw new Error(`参考图不存在: ${r}`);
  if (st.isDirectory()) {
    const files = await collectImagesFromDirRecursive(r);
    if (!files.length) throw new Error(`参考图目录下没有图片文件: ${r}`);
    return files;
  }
  if (!st.isFile()) throw new Error(`参考图不是文件: ${r}`);
  return [r];
}

async function readReferenceImageToBase64(ref: string): Promise<{ data: string; mimeType: string }> {
  const r = String(ref || "").trim();
  const isHttp = /^https?:\/\//i.test(r);
  if (isHttp) {
    const res = await fetch(r);
    if (!res.ok) throw new Error(`下载参考图失败: ${r}, status=${res.status}`);
    const ab = await res.arrayBuffer();
    const buf = Buffer.from(ab);
    const mimeType = res.headers.get("content-type") || "image/jpeg";
    return { data: buf.toString("base64"), mimeType };
  }
  const buf = await fs.readFile(r);
  return { data: buf.toString("base64"), mimeType: guessMimeFromPath(r) };
}

async function readReferenceImagesToBase64(refs: string[]) {
  const raw = Array.isArray(refs) ? refs.map((x) => String(x || "").trim()).filter(Boolean) : [];
  const expanded: string[] = [];
  for (const r of raw) expanded.push(...(await expandReferenceToPaths(r)));
  return expanded.length ? await Promise.all(expanded.map((p) => readReferenceImageToBase64(p))) : [];
}

function buildPrompt(config: ImageConfigDoc): string {
  const fnName = (config.promptTmpFunName || "").trim();
  const aspectRatio = (config.imageConfig as any)?.aspectRatio;
  const baseArgs = {
    appName: config.appName,
    lang: config.lang,
    prompt: config.prompt,
    aspectRatio,
    ...(config.extra || {}),
  };
  const fn = fnName ? (promptFns as Record<string, unknown>)[fnName] : undefined;
  if (typeof fn === "function") return String((fn as (args: typeof baseArgs) => unknown)(baseArgs));
  return config.prompt;
}

export async function startBatchJob(input: StartJobInput) {
  const { jobId, configIds, concurrency } = input;
  if (runningMap.has(jobId)) return;
  const p = runBatchJob({ jobId, configIds, concurrency }).finally(() => {
    runningMap.delete(jobId);
  });
  runningMap.set(jobId, p);
}

export async function startCutJob(input: { jobId: string; concurrency: number }) {
  const { jobId, concurrency } = input;
  if (cutRunningMap.has(jobId)) return;
  const p = runCutJob({ jobId, concurrency }).finally(() => {
    cutRunningMap.delete(jobId);
  });
  cutRunningMap.set(jobId, p);
}

async function runBatchJob(input: StartJobInput) {
  const db = await getMongoDb();
  const jobObjectId = new ObjectId(input.jobId);
  const jobsCol = db.collection<BatchJobDoc>("batch_jobs");
  const jobConfigsCol = db.collection<BatchJobConfigDoc>("batch_job_configs");
  const configsCol = db.collection<ImageConfigDoc>("image_configs");
  const imagesCol = db.collection<GeneratedImageDoc>("generated_images");
  const recordsCol = db.collection<GenerationRecordDoc>("generation_records");

  await jobsCol.updateOne(
    { _id: jobObjectId },
    { $set: { status: "running", updatedAt: new Date() } }
  );

  const configObjectIds = input.configIds.map((id) => new ObjectId(id));
  const configs = await configsCol.find({ _id: { $in: configObjectIds } }).toArray();
  const configMap = new Map<string, ImageConfigDoc>(configs.map((c) => [String(c._id), c]));

  const q = asyncLib.queue(async (task: { configId: string; index: number }) => {
    const config = configMap.get(task.configId);
    if (!config) throw new Error(`配置不存在: ${task.configId}`);

    await jobConfigsCol.updateOne(
      { jobId: jobObjectId, configId: new ObjectId(task.configId) },
      { $set: { status: "running", updatedAt: new Date() } }
    );

    const prompt = buildPrompt(config);
    try {
      const referenceImagesRaw = Array.isArray(config.referenceImages) ? config.referenceImages : [];
      const refImgs = referenceImagesRaw.length ? await readReferenceImagesToBase64(referenceImagesRaw) : [];
      const referenceImages = refImgs.length ? refImgs : undefined;

      const client = new GeminiClient({});
      const generated = await client.generateImage(prompt, {
        responseModalities: Array.isArray(config.responseModalities) ? config.responseModalities : ["IMAGE"],
        imageConfig: config.imageConfig,
        generationConfig: config.generationConfig,
        referenceImages,
      });

      const ext = extFromMime(generated.mimeType);
      let imageBase64 = generated.data;
      try {
        const ar = String((config.imageConfig as any)?.aspectRatio || "");
        imageBase64 = await resizeImageByAspectRatio(imageBase64, ar);
      } catch {
      }
      const ts = Date.now();
      const ratio = aspectRatioToken((config.imageConfig as any)?.aspectRatio);
      const baseName = `${ts}-${ratio}.${ext}`;
      const appNameSeg = safePathSegment(config.appName);
      const langSeg = safePathSegment(config.lang);
      const relDir = join("generated", appNameSeg, langSeg, String(jobObjectId));
      const absDir = join(process.cwd(), "public", relDir);
      await fs.ensureDir(absDir);
      let filename = baseName;
      let absFile = join(absDir, filename);
      if (await fs.pathExists(absFile)) {
        let i = 2;
        while (true) {
          filename = `${ts}-${ratio}-${i}.${ext}`;
          absFile = join(absDir, filename);
          if (!(await fs.pathExists(absFile))) break;
          i += 1;
        }
      }
      await fs.writeFile(absFile, Buffer.from(imageBase64, "base64"));

      const url = `/${relDir.replaceAll("\\", "/")}/${filename}`;
      const now = new Date();
      await imagesCol.insertOne({
        jobId: jobObjectId,
        configId: config._id,
        index: task.index,
        url,
        filePath: absFile,
        mimeType: generated.mimeType,
        createdAt: now,
        prompt,
        appName: config.appName,
        lang: config.lang,
        referenceImages: config.referenceImages,
      });
      await recordsCol.insertOne({
        jobId: jobObjectId,
        configId: config._id,
        index: task.index,
        status: "completed",
        prompt,
        url,
        mimeType: generated.mimeType,
        createdAt: now,
        appName: config.appName,
        lang: config.lang,
        referenceImages: config.referenceImages,
      });
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err);
      await recordsCol.insertOne({
        jobId: jobObjectId,
        configId: config._id,
        index: task.index,
        status: "failed",
        prompt,
        error: msg,
        createdAt: new Date(),
        appName: config.appName,
        lang: config.lang,
        referenceImages: config.referenceImages,
      });
      throw err;
    }

    await jobsCol.updateOne(
      { _id: jobObjectId },
      { $inc: { done: 1 }, $set: { updatedAt: new Date() } }
    );
    await jobConfigsCol.updateOne(
      { jobId: jobObjectId, configId: config._id },
      { $inc: { done: 1 }, $set: { updatedAt: new Date() } }
    );
  }, Math.max(1, Number(input.concurrency) || 1));

  q.error(async (err, task) => {
    const msg = err instanceof Error ? err.message : String(err);
    const now = new Date();
    await jobsCol.updateOne(
      { _id: jobObjectId },
      { $set: { status: "failed", error: msg, updatedAt: now } }
    );
    if (task?.configId) {
      await jobConfigsCol.updateOne(
        { jobId: jobObjectId, configId: new ObjectId(task.configId) },
        { $set: { status: "failed", error: msg, updatedAt: now } }
      );
    }
  });

  const tasks: Array<{ configId: string; index: number }> = [];
  for (const configId of input.configIds) {
    const cfg = configMap.get(configId);
    const count = Math.max(0, Number(cfg?.count ?? 1) || 0);
    for (let i = 0; i < count; i += 1) tasks.push({ configId, index: i });
  }

  if (!tasks.length) {
    await jobsCol.updateOne(
      { _id: jobObjectId },
      { $set: { status: "completed", updatedAt: new Date() } }
    );
    await jobConfigsCol.updateMany(
      { jobId: jobObjectId },
      { $set: { status: "completed", updatedAt: new Date() } }
    );
    return;
  }

  const drained = new Promise<void>((resolve) => {
    q.drain(() => resolve());
  });
  await jobConfigsCol.updateMany(
    { jobId: jobObjectId, configId: { $in: configObjectIds } },
    { $set: { status: "queued", updatedAt: new Date() } }
  );

  for (const t of tasks) q.push(t);
  await drained;

  const jobAfter = await jobsCol.findOne({ _id: jobObjectId });
  if (jobAfter?.status !== "failed") {
    await jobsCol.updateOne(
      { _id: jobObjectId },
      { $set: { status: "completed", updatedAt: new Date() } }
    );
    await jobConfigsCol.updateMany(
      { jobId: jobObjectId },
      { $set: { status: "completed", updatedAt: new Date() } }
    );
  }
}

async function runCutJob(input: { jobId: string; concurrency: number }) {
  const db = await getMongoDb();
  const jobObjectId = new ObjectId(input.jobId);
  const jobsCol = db.collection<BatchJobDoc>("batch_jobs");
  const cutItemsCol = db.collection<CutJobItemDoc>("cut_job_items");

  await jobsCol.updateOne(
    { _id: jobObjectId },
    { $set: { status: "running", updatedAt: new Date() } }
  );

  const items = await cutItemsCol.find({ jobId: jobObjectId }).toArray();
  if (!items.length) {
    await jobsCol.updateOne(
      { _id: jobObjectId },
      { $set: { status: "completed", updatedAt: new Date() } }
    );
    return;
  }

  const q = asyncLib.queue(async (task: { itemId: ObjectId }) => {
    const item = await cutItemsCol.findOne({ _id: task.itemId });
    if (!item) throw new Error(`裁图任务不存在: ${String(task.itemId)}`);

    const now0 = new Date();
    await cutItemsCol.updateOne(
      { _id: task.itemId },
      { $set: { status: "running", updatedAt: now0 } }
    );

    const baseArgs = {
      appName: item.appName,
      lang: item.lang,
      prompt: "",
      aspectRatio: item.ratio,
      sourceType: "generated_image",
      sourceUrl: item.sourceUrl,
      cutRatio: item.ratio,
      cutTemplate: item.templateName,
    };
    const fn = (promptFns as Record<string, unknown>)[item.templateName];
    const prompt = typeof fn === "function" ? String((fn as (args: typeof baseArgs) => unknown)(baseArgs)) : "";

    try {
      const refImgs = await readReferenceImagesToBase64([String(item.sourceAbsPath)]);
      const referenceImages = refImgs.length ? refImgs : undefined;
      const client = new GeminiClient({});
      const generated = await client.generateImage(prompt, {
        responseModalities: ["IMAGE"],
        imageConfig: { aspectRatio: item.ratio, imageSize: "1K" },
        referenceImages,
      });

      const ext = extFromMime(generated.mimeType);
      let imageBase64 = generated.data;
      try {
        imageBase64 = await resizeImageByAspectRatio(imageBase64, item.ratio);
      } catch {
      }

      const ts = Date.now();
      const ratioToken = aspectRatioToken(item.ratio);
      const baseName = `${ts}-${ratioToken}.${ext}`;
      const appNameSeg = safePathSegment(item.appName);
      const langSeg = safePathSegment(item.lang);
      const relDir = join("cut", appNameSeg, langSeg, String(jobObjectId));
      const absDir = join(process.cwd(), "public", relDir);
      await fs.ensureDir(absDir);

      let filename = baseName;
      let absFile = join(absDir, filename);
      if (await fs.pathExists(absFile)) {
        let i = 2;
        while (true) {
          filename = `${ts}-${ratioToken}-${i}.${ext}`;
          absFile = join(absDir, filename);
          if (!(await fs.pathExists(absFile))) break;
          i += 1;
        }
      }
      await fs.writeFile(absFile, Buffer.from(imageBase64, "base64"));
      const url = `/${relDir.replaceAll("\\", "/")}/${filename}`;

      const now = new Date();
      await cutItemsCol.updateOne(
        { _id: task.itemId },
        {
          $set: {
            status: "completed",
            done: 1,
            updatedAt: now,
            outputUrl: url,
            outputFilePath: absFile,
            outputMimeType: generated.mimeType,
          },
        }
      );
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err);
      const now = new Date();
      await cutItemsCol.updateOne(
        { _id: task.itemId },
        { $set: { status: "failed", error: msg, updatedAt: now } }
      );
      throw err;
    }

    await jobsCol.updateOne(
      { _id: jobObjectId },
      { $inc: { done: 1 }, $set: { updatedAt: new Date() } }
    );
  }, Math.max(1, Number(input.concurrency) || 1));

  q.error(async (err) => {
    const msg = err instanceof Error ? err.message : String(err);
    const now = new Date();
    await jobsCol.updateOne(
      { _id: jobObjectId },
      { $set: { status: "failed", error: msg, updatedAt: now } }
    );
  });

  const tasks = items.map((it) => ({ itemId: it._id! }));
  const drained = new Promise<void>((resolve) => {
    q.drain(() => resolve());
  });
  for (const t of tasks) q.push(t);
  await drained;

  const jobAfter = await jobsCol.findOne({ _id: jobObjectId });
  if (jobAfter?.status !== "failed") {
    await jobsCol.updateOne(
      { _id: jobObjectId },
      { $set: { status: "completed", updatedAt: new Date() } }
    );
  }
}
