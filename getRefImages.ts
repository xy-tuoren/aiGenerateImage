import { getMongoDb, closeMongo } from './mongodb.js';
import fs from 'fs-extra';
import * as path from 'path';
import axios from 'axios';

function extractLpTail(lpUrl: unknown): string {
  const raw = (lpUrl ?? '').toString().trim();
  if (!raw) return '';
  const noHash = raw.split('#')[0] ?? raw;    
  const noQuery = noHash.split('?')[0] ?? noHash;
  const parts = noQuery.split('/').filter(Boolean);
  const tail = (parts[parts.length - 1] ?? '').trim();
  return tail.replace(/\.html$/i, '');
}

const domain = "https://static.spga.xyz/";
async function getSiteCategoryMap(businessTypeFilter?: string): Promise<string[]> {
  const db = await getMongoDb('tool');
  const collection = db.collection('site_category');
  const docs = await collection.find({}).toArray();
  const sitesSet = new Set<string>();
  for (const doc of docs) {
    const site = (doc?.site ?? '').toString().trim();
    const businessType =
      doc?.category && typeof doc.category.default === 'string' ? doc.category.default : null;
    if (!site) continue;
    if (businessTypeFilter && businessType !== businessTypeFilter) continue;
    sitesSet.add(site);
  }
  return Array.from(sitesSet);
}

export async function getImageMaterialsWithAppsiteInfo(limit?: number): Promise<any[]> {
  if (limit !== undefined && (!Number.isInteger(limit) || limit <= 0)) {
    throw new Error('limit 必须是正整数');
  }

  const appSites = await getSiteCategoryMap('APP');
  if (!appSites.length) {
    return [];
  }

  const materialsDb = await getMongoDb('materials');
  const appsiteDb = await getMongoDb('appsite');

  const imageMaterialCol = materialsDb.collection('image_material');
  const ddAppDataCol = appsiteDb.collection('dd_app_data');

  const baseFilter: Record<string, any> = {
    project: { $in: appSites },
    cost: { $exists: true, $ne: null }
  };

  const query = imageMaterialCol.find(baseFilter, {
    projection: {
      ch_name: 1,
      lp_url: 1,
      create_time: 1,
      origin_long: 1,
      origin_square: 1,
      origin_vertical: 1,
      project: 1,
      cost: 1
    }
  });
  if (limit !== undefined) {
    query.limit(limit);
  }
  const imageMaterials = await query.toArray();

  const neededTails = new Set<string>();
  const docToTailMap = new Map<any, string>();
  for (const doc of imageMaterials) {
    const tail = extractLpTail((doc as any)?.lp_url);
    if (!tail) continue;
    neededTails.add(tail);
    docToTailMap.set(doc, tail);
  }
  const tailToApp = new Map<string, { app_name?: string; site?: string; status?: any; is_deleted?: any; package_id?: string }>();

  const neededTailsArray = Array.from(neededTails).filter(Boolean);
  if (neededTailsArray.length === 0) {
    return [];
  }

  const appDataFilter: Record<string, any> = {
    site: { $in: appSites },
    package_id: { $in: neededTailsArray }
  };

  const cursor = ddAppDataCol.find(
    appDataFilter,
    { projection: { package_id: 1, app_name: 1, site: 1, status: 1, is_deleted: 1 } }
  );

  for await (const appDoc of cursor as any) {
    const packageId = (appDoc?.package_id ?? '').toString().trim();
    if (!packageId || !neededTails.has(packageId)) continue;

    const key = packageId;
    const incoming = {
      app_name: appDoc?.app_name,
      site: appDoc?.site,
      status: appDoc?.status,
      is_deleted: appDoc?.is_deleted,
      package_id: appDoc?.package_id
    };

    const existing = tailToApp.get(key);
    if (!existing) {
      tailToApp.set(key, incoming);
      continue;
    }

    const existingScore =
      (existing?.is_deleted === 0 ? 2 : 0) +
      (existing?.status === 1 ? 1 : 0);
    const incomingScore =
      (incoming?.is_deleted === 0 ? 2 : 0) +
      (incoming?.status === 1 ? 1 : 0);
    if (incomingScore > existingScore) {
      tailToApp.set(key, incoming);
    }
  }
  const merged = imageMaterials
    .map((doc: any) => {
      const tail = docToTailMap.get(doc) ?? '';
      const app = tail ? tailToApp.get(tail) : undefined;
      if (!app?.app_name) return null;

      const processImageArray = (arr: any): string[] => {
        if (!Array.isArray(arr)) return [];
        return arr.map((item: any) => {
          const url = String(item ?? '').trim();
          if (!url) return url;
          return url.startsWith('http://') || url.startsWith('https://') ? url : domain + url;
        });
      };

      return {
        ...doc,
        origin_long: processImageArray(doc.origin_long),
        origin_square: processImageArray(doc.origin_square),
        origin_vertical: processImageArray(doc.origin_vertical),
        app_name: app.app_name,
        site: app.site ?? null,
        package_id: app.package_id ?? null
      };
    })
    .filter((item): item is any => item !== null);
  const jsonPath = path.resolve(process.cwd(), 'refImages.json');
  await fs.writeJson(jsonPath, merged);
  console.log(`数据已写入: ${jsonPath}`);
  return merged;

}

async function downloadRefImages(): Promise<void> {
  const jsonPath = path.resolve(process.cwd(), 'refImages.json');
  if (!(await fs.pathExists(jsonPath))) {
    console.error(`文件不存在: ${jsonPath}`);
    return;
  }

  const data = await fs.readJson(jsonPath);
  if (!Array.isArray(data)) {
    console.error('JSON 数据格式错误，应为数组');
    return;
  }

  const baseDir = path.resolve(process.cwd(), 'refImageDatas');
  await fs.ensureDir(baseDir);

  const sanitizeFileName = (name: string): string => {
    return name.replace(/[<>:"/\\|?*]/g, '_').trim();
  };

  const getFileExtension = (url: string): string => {
    try {
      const urlPath = new URL(url).pathname;
      const ext = path.extname(urlPath);
      return ext || '.jpg';
    } catch {
      const ext = path.extname(url);
      return ext || '.jpg';
    }
  };

  let totalDownloaded = 0;
  let totalFailed = 0;

  for (let i = 0; i < data.length; i++) {
    const item = data[i];
    const appName = item?.app_name;
    const originLong = item?.origin_long;

    if (!appName || !Array.isArray(originLong) || originLong.length === 0) {
      continue;
    }

    const sanitizedAppName = sanitizeFileName(String(appName));
    const appDir = path.join(baseDir, sanitizedAppName);
    await fs.ensureDir(appDir);

    console.log(`处理应用: ${appName} (${i + 1}/${data.length})`);

    for (let j = 0; j < originLong.length; j++) {
      const imageUrl = String(originLong[j] ?? '').trim();
      if (!imageUrl) continue;

      try {
        const response = await axios.get(imageUrl, {
          responseType: 'arraybuffer',
          timeout: 30000
        });

        const ext = getFileExtension(imageUrl);
        const fileName = `${Date.now()}-${i}-${j}${ext}`;
        const filePath = path.join(appDir, fileName);

        await fs.writeFile(filePath, response.data);
        totalDownloaded++;
        console.log(`  下载成功: ${fileName}`);
      } catch (error) {
        totalFailed++;
        console.error(`  下载失败 [${imageUrl}]:`, error instanceof Error ? error.message : String(error));
      }
    }
  }

  console.log(`\n下载完成! 成功: ${totalDownloaded}, 失败: ${totalFailed}`);
}

// await getImageMaterialsWithAppsiteInfo();
await downloadRefImages();
// await closeMongo();
process.exit(0);

