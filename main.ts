import 'dotenv/config';
import * as path from 'path';
import async from 'async';
import { GeminiClient } from './gemini.js';
import { mimeTypeToExt, readConfigJsonAsGeminiJobs, writeGeneratedImageFile, resizeImageByAspectRatio } from './utils.js';

async function runBatchFromConfig(configPath: string = path.resolve(process.cwd(), 'config.json')): Promise<void> {
  const jobs = await readConfigJsonAsGeminiJobs(configPath);
  const client = new GeminiClient({});
  console.log(jobs);

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
      const timestamp = Date.now();
      const filename = path.join(outputDir, `${timestamp}.${ext}`);
      await writeGeneratedImageFile(filename, imageData);
      console.log(`已生成: ${filename}`);
    } catch (error) {
      console.error(`任务失败 [Job ${jobIndex + 1}, Task ${taskIndex + 1}]:`, error instanceof Error ? error.message : String(error));
    }
  });
}

runBatchFromConfig().catch((err) => {
  console.error(err);
  process.exit(1);
});
