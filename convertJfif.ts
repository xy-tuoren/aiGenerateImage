import sharp from 'sharp';
import fs from 'fs-extra';
import path from 'path';

async function findJfifFiles(dir: string): Promise<string[]> {
  const files: string[] = [];
  const entries = await fs.readdir(dir, { withFileTypes: true });

  for (const entry of entries) {
    const fullPath = path.join(dir, entry.name);
    if (entry.isDirectory()) {
      const subFiles = await findJfifFiles(fullPath);
      files.push(...subFiles);
    } else if (entry.isFile() && /\.jfif$/i.test(entry.name)) {
      files.push(fullPath);
    }
  }

  return files;
}

async function convertJfifToJpg(inputDir: string, outputFormat: 'jpg' | 'png' = 'jpg', deleteOriginal: boolean = true) {
  const jfifFiles = await findJfifFiles(inputDir);

  console.log(`找到 ${jfifFiles.length} 个 .jfif 文件`);

  for (const inputPath of jfifFiles) {
    const outputPath = inputPath.replace(/\.jfif$/i, `.${outputFormat}`);

    try {
      await sharp(inputPath)
        .toFormat(outputFormat === 'jpg' ? 'jpeg' : 'png')
        .toFile(outputPath);

      const relativePath = path.relative(process.cwd(), inputPath);
      const relativeOutput = path.relative(process.cwd(), outputPath);
      console.log(`✓ 转换成功: ${relativePath} -> ${relativeOutput}`);

      if (deleteOriginal) {
        await fs.remove(inputPath);
        console.log(`  已删除原文件: ${relativePath}`);
      }
    } catch (error) {
      console.error(`✗ 转换失败: ${inputPath}`, error);
    }
  }

  console.log('转换完成！');
}

// 使用示例
const args = process.argv.slice(2);
const inputDirectory = args[0] || path.join(process.cwd(), 'referenceImages');
const outputFormat = (args[1] === 'png' ? 'png' : 'jpg') as 'jpg' | 'png';
const deleteOriginal = !args.includes('--keep');

console.log(`输入目录: ${inputDirectory}`);
console.log(`输出格式: ${outputFormat}`);
console.log(`删除原文件: ${deleteOriginal ? '是' : '否'}`);
console.log('');

convertJfifToJpg(inputDirectory, outputFormat, deleteOriginal).catch(console.error);
