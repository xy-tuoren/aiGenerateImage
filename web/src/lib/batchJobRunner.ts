import * as asyncLib from "async";
import * as fs from "fs-extra";
import { join } from "path";
import { ObjectId } from "mongodb";
import { getMongoDb } from "@/lib/mongodb";
import { GeminiClient } from "@/lib/gemini";
import * as promptFns from "@/lib/prompt";

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
  aspectRatio?: string;
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
};

type StartJobInput = {
  jobId: string;
  configIds: string[];
  concurrency: number;
};

declare global {
  var __batchJobRunning: Map<string, Promise<void>> | undefined;
}

const runningMap = global.__batchJobRunning ?? (global.__batchJobRunning = new Map<string, Promise<void>>());

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

async function readReferenceImageToBase64(ref: string): Promise<{ data: string; mimeType: string }> {
  const isHttp = /^https?:\/\//i.test(ref);
  if (isHttp) {
    const res = await fetch(ref);
    if (!res.ok) throw new Error(`下载参考图失败: ${ref}, status=${res.status}`);
    const ab = await res.arrayBuffer();
    const buf = Buffer.from(ab);
    const mimeType = res.headers.get("content-type") || "image/jpeg";
    return { data: buf.toString("base64"), mimeType };
  }
  const buf = await fs.readFile(ref);
  return { data: buf.toString("base64"), mimeType: guessMimeFromPath(ref) };
}

function buildPrompt(config: ImageConfigDoc): string {
  const fnName = (config.promptTmpFunName || "").trim();
  const baseArgs = {
    appName: config.appName,
    lang: config.lang,
    prompt: config.prompt,
    aspectRatio: config.aspectRatio,
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

async function runBatchJob(input: StartJobInput) {
  const db = await getMongoDb();
  const jobObjectId = new ObjectId(input.jobId);
  const jobsCol = db.collection<BatchJobDoc>("batch_jobs");
  const jobConfigsCol = db.collection<BatchJobConfigDoc>("batch_job_configs");
  const configsCol = db.collection<ImageConfigDoc>("image_configs");
  const imagesCol = db.collection<GeneratedImageDoc>("generated_images");

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
    const referenceImagesRaw = Array.isArray(config.referenceImages) ? config.referenceImages : [];
    const referenceImages = referenceImagesRaw.length
      ? await Promise.all(referenceImagesRaw.map((r) => readReferenceImageToBase64(String(r))))
      : undefined;

    const client = new GeminiClient({});
    const generated = await client.generateImage(prompt, {
      responseModalities: Array.isArray(config.responseModalities) ? config.responseModalities : ["IMAGE"],
      imageConfig: config.imageConfig,
      generationConfig: config.generationConfig,
      referenceImages,
    });

    const ext = extFromMime(generated.mimeType);
    const filename = `${task.index + 1}-${Date.now()}.${ext}`;
    const relDir = join("generated", String(jobObjectId), String(config._id));
    const absDir = join(process.cwd(), "public", relDir);
    await fs.ensureDir(absDir);
    const absFile = join(absDir, filename);
    await fs.writeFile(absFile, Buffer.from(generated.data, "base64"));

    const url = `/${relDir.replaceAll("\\", "/")}/${filename}`;
    await imagesCol.insertOne({
      jobId: jobObjectId,
      configId: config._id,
      index: task.index,
      url,
      filePath: absFile,
      mimeType: generated.mimeType,
      createdAt: new Date(),
      prompt,
    });

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

