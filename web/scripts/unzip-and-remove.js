/**
 * 对指定目录下所有 zip 包：解压到同目录，然后删除 zip
 * 目标目录：Z:\陈靖\1图片素材
 */

const fs = require('fs');
const path = require('path');
const AdmZip = require('adm-zip');

const TARGET_DIR = 'Z:\\陈靖\\1图片素材';
// const TARGET_DIR = 'D:\\mog素材\\ljm';

const getZipFiles = (dir, files = []) => {
  if (!fs.existsSync(dir)) {
    console.warn(`目录不存在: ${dir}`);
    return files;
  }
  const entries = fs.readdirSync(dir, { withFileTypes: true });
  for (const e of entries) {
    const full = path.join(dir, e.name);
    if (e.isDirectory()) {
      getZipFiles(full, files);
    } else if (e.name.toLowerCase().endsWith('.zip')) {
      files.push(full);
    }
  }
  return files;
};

const run = () => {
  console.log(`目标目录: ${TARGET_DIR}`);
  const zips = getZipFiles(TARGET_DIR);
  if (zips.length === 0) {
    console.log('未找到 zip 文件');
    return;
  }
  console.log(`找到 zip 数量: ${zips.length}`);

  let ok = 0;
  let err = 0;
  for (const zipPath of zips) {
    const baseName = path.basename(zipPath, '.zip');
    const destDir = path.join(path.dirname(zipPath), baseName);
    try {
      const zip = new AdmZip(zipPath);
      zip.extractAllTo(destDir, true);
      fs.unlinkSync(zipPath);
      ok++;
      console.log(`解压并删除: ${path.relative(TARGET_DIR, zipPath)}`);
    } catch (e) {
      err++;
      console.error(`失败: ${zipPath}`, e.message);
    }
  }
  console.log(`\n完成. 成功: ${ok}, 失败: ${err}`);
};

run();
