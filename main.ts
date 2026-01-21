import 'dotenv/config';
import * as path from 'path';
import async from 'async';
import sharp from 'sharp';
import { GeminiClient } from './gemini.js';
import { mimeTypeToExt, readConfigJsonAsGeminiJobs, writeGeneratedImageFile, resizeImageByAspectRatio, ensureCutExtraStitchedImages } from './utils.js';
import * as promptTemplates from './prompt.js';

async function runBatchFromConfig(configPath: string = path.resolve(process.cwd(), 'config.json')): Promise<void> {
  const jobs = await readConfigJsonAsGeminiJobs(configPath);
  const client = new GeminiClient({});
  const filteredJobs = jobs.filter(job => {
    const numCount = job.count !== undefined && job.count !== null && !isNaN(Number(job.count)) ? Number(job.count) : undefined;
    const count = numCount !== undefined ? Math.floor(numCount) : 1;
    return count > 0;
  });
  console.log(filteredJobs);

  // 收集所有任务
  interface TaskItem {
    jobIndex: number;
    taskIndex: number;
    job: typeof jobs[0];
    outputDir: string;
  }
  const tasks: TaskItem[] = [];
  for (let jobIndex = 0; jobIndex < jobs.length; jobIndex++) {
    const job = jobs[jobIndex];
    const outputDir = job.output ? path.resolve(process.cwd(), job.output) : path.resolve(process.cwd(), 'output');
    const numCount = job.count !== undefined && job.count !== null && !isNaN(Number(job.count)) ? Number(job.count) : undefined;
    const count = numCount !== undefined ? Math.floor(numCount) : 1;
    if (count <= 0) continue;

    for (let i = 0; i < count; i++) {
      tasks.push({ jobIndex, taskIndex: i, job, outputDir });
    }
  }

  // 使用 async.eachLimit 限制最大并发数为 100
  await async.eachLimit(tasks, 100, async (task: TaskItem) => {
    const { jobIndex, taskIndex, job, outputDir } = task;
    try {
      const result = await client.generateImage(job.prompt, job.options);
      let imageData = result.data;
      const aspectRatio = job.options.imageConfig?.aspectRatio;
      if (aspectRatio === '4:5' || aspectRatio === '1:1' || aspectRatio === '16:9') {
        imageData = await resizeImageByAspectRatio(result.data, aspectRatio);
      }
      const ext = mimeTypeToExt(result.mimeType);
      const imageBuffer = Buffer.from(imageData, 'base64');
      const metadata = await sharp(imageBuffer).metadata();
      const width = metadata.width || 0;
      const height = metadata.height || 0;
      const timestamp = Date.now();
      const filename = path.join(outputDir, `${timestamp}-${width}x${height}.${ext}`);
      await writeGeneratedImageFile(filename, imageData);
      console.log(`已生成: ${filename}`);
      if (job.nextPromptFun && Array.isArray(job.nextPromptFun) && job.nextPromptFun.length > 0) {
        let nextRef: { data: string; mimeType: string } = { data: imageData, mimeType: result.mimeType };
        for (let i = 0; i < job.nextPromptFun.length; i++) {
          const fnName = (job.nextPromptFun[i] ?? '').toString().trim();
          if (!fnName) continue;
          const fn = (promptTemplates as any)[fnName];
          if (typeof fn !== 'function') {
            throw new Error(`nextPromptFun 指定的方法不存在或不是函数: ${fnName}`);
          }
          const meta: any = job.meta && typeof job.meta === 'object' ? job.meta : {};
          const templateParams = {
            ...meta,
            appName: meta.appName ? String(meta.appName) : '',
            lang: meta.lang ? String(meta.lang) : '',
            prompt: meta.prompt ? String(meta.prompt) : job.prompt,
            aspectRatio: meta.aspectRatio ? String(meta.aspectRatio) : (meta.imageConfig?.aspectRatio ? String(meta.imageConfig.aspectRatio) : (aspectRatio ? String(aspectRatio) : ''))
          };
          const nextPrompt = fn(templateParams);
          const nextResult = await client.generateImage(nextPrompt, { ...job.options, referenceImages: [nextRef] });
          let nextImageData = nextResult.data;
          if (aspectRatio === '4:5' || aspectRatio === '1:1' || aspectRatio === '16:9') {
            nextImageData = await resizeImageByAspectRatio(nextResult.data, aspectRatio);
          }
          const nextExt = mimeTypeToExt(nextResult.mimeType);
          const nextImageBuffer = Buffer.from(nextImageData, 'base64');
          const nextMetadata = await sharp(nextImageBuffer).metadata();
          const nextWidth = nextMetadata.width || 0;
          const nextHeight = nextMetadata.height || 0;
          const nextTimestamp = Date.now();
          const nextFilename = path.join(outputDir, `${nextTimestamp}-${nextWidth}x${nextHeight}-next-${i + 1}-${fnName}.${nextExt}`);
          await writeGeneratedImageFile(nextFilename, nextImageData);
          console.log(`已生成(next): ${nextFilename}`);
          nextRef = { data: nextImageData, mimeType: nextResult.mimeType };
        }
      }
      await ensureCutExtraStitchedImages(outputDir, (job as any).meta);
    } catch (error) {
      console.error(`任务失败 [Job ${jobIndex + 1}, Task ${taskIndex + 1}]:`, error instanceof Error ? error.message : String(error));
    }
  });
}

runBatchFromConfig().catch((err) => {
  console.error(err);
  process.exit(1);
});
