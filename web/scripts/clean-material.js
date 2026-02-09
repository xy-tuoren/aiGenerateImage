/**
 * 清理 web/public/material：
 * 1. 删除所有 .gif 文件
 * 2. 重复文件：按「前段数字」分组，只保留「后段数字」最大的那张
 * 3. 同名文件：同一文件夹内相同文件名只保留一份（不跨文件夹）
 */

const fs = require('fs');
const path = require('path');

const MATERIAL_DIR = path.join(__dirname, '..', 'public', 'material');

// 匹配文件名：纯数字-纯数字.扩展名
const PREFIX_SUFFIX_REG = /^(\d+)-(\d+)\.([a-zA-Z0-9]+)$/;

const getAllFiles = (dir, files = []) => {
  if (!fs.existsSync(dir)) {
    console.warn(`目录不存在: ${dir}`);
    return files;
  }
  const entries = fs.readdirSync(dir, { withFileTypes: true });
  for (const e of entries) {
    const full = path.join(dir, e.name);
    if (e.isDirectory()) {
      getAllFiles(full, files);
    } else {
      files.push(full);
    }
  }
  return files;
};

const run = () => {
  console.log(`目标目录: ${MATERIAL_DIR}`);
  const allFiles = getAllFiles(MATERIAL_DIR);

  let gifDeleted = 0;
  let dupDeleted = 0;
  let sameNameDeleted = 0;

  // 1. 删除所有 .gif
  for (const f of allFiles) {
    if (path.extname(f).toLowerCase() === '.gif') {
      fs.unlinkSync(f);
      gifDeleted++;
      console.log(`删除 GIF: ${path.relative(MATERIAL_DIR, f)}`);
    }
  }

  // 2. 按目录分组，再在每个目录内按「前段数字」分组，保留后段数字最大的
  const byDir = new Map();
  for (const f of allFiles) {
    if (path.extname(f).toLowerCase() === '.gif') continue;
    const dir = path.dirname(f);
    const base = path.basename(f);
    const m = base.match(PREFIX_SUFFIX_REG);
    if (!m) continue;
    const [, prefix, suffixStr, ext] = m;
    const suffix = parseInt(suffixStr, 10);
    if (!byDir.has(dir)) byDir.set(dir, new Map());
    const byPrefix = byDir.get(dir);
    if (!byPrefix.has(prefix)) {
      byPrefix.set(prefix, []);
    }
    byPrefix.get(prefix).push({ full: f, base, suffix, ext });
  }

  for (const [, byPrefix] of byDir) {
    for (const [, list] of byPrefix) {
      if (list.length <= 1) continue;
      list.sort((a, b) => b.suffix - a.suffix);
      for (let i = 1; i < list.length; i++) {
        const f = list[i].full;
        if (fs.existsSync(f)) {
          fs.unlinkSync(f);
          dupDeleted++;
          console.log(`删除重复(留大): ${path.relative(MATERIAL_DIR, f)}`);
        }
      }
    }
  }

  // 3. 同一文件夹内同名文件只保留一份（按 目录+basename 分组）
  const byDirAndName = new Map();
  const remainingFiles = getAllFiles(MATERIAL_DIR);
  for (const f of remainingFiles) {
    const dir = path.dirname(f);
    const base = path.basename(f);
    if (!byDirAndName.has(dir)) byDirAndName.set(dir, new Map());
    const byName = byDirAndName.get(dir);
    if (!byName.has(base)) byName.set(base, []);
    byName.get(base).push(f);
  }
  for (const [, byName] of byDirAndName) {
    for (const [, list] of byName) {
      if (list.length <= 1) continue;
      for (let i = 1; i < list.length; i++) {
        const f = list[i];
        if (fs.existsSync(f)) {
          fs.unlinkSync(f);
          sameNameDeleted++;
          console.log(`删除同名: ${path.relative(MATERIAL_DIR, f)}`);
        }
      }
    }
  }

  console.log(`\n完成. 删除 GIF: ${gifDeleted}, 删除重复(留大): ${dupDeleted}, 删除同名: ${sameNameDeleted}`);
};

run();
