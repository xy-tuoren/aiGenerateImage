import { NextResponse } from "next/server";
import * as fs from "fs-extra";
import { join } from "path";
import { requireApiAccess } from "@/lib/server/auth";

export async function GET(req: Request) {
  try {
    const guard = requireApiAccess(req);
    if (!guard.ok) return NextResponse.json({ ok: false, error: guard.error }, { status: guard.status });

    const cwd = process.cwd();

    // 1) 本地：public/material 下的文件夹名
    const refImageDatasPath = join(cwd, "public", "material");
    const folderNames: string[] = [];
    const st = await fs.stat(refImageDatasPath).catch(() => null);
    if (st?.isDirectory()) {
      const folders = await fs.readdir(refImageDatasPath, { withFileTypes: true }).catch(() => []);
      for (const item of folders) {
        if (!item?.isDirectory?.()) continue;
        const name = String((item as any).name || "").trim();
        if (name) folderNames.push(name);
      }
    }

    // 2) 远端：.cache/referenceImages.remoteAppNames.json（兼容 array 或 {updatedAt,data}）
    const remoteAppNamesFile = join(cwd, ".cache", "referenceImages.remoteAppNames.json");
    const remoteRaw = await fs.readFile(remoteAppNamesFile, "utf8").catch(() => "");
    let remoteNames: string[] = [];
    if (remoteRaw) {
      try {
        const json = JSON.parse(remoteRaw) as any;
        const arr = Array.isArray(json) ? json : Array.isArray(json?.data) ? json.data : [];
        remoteNames = arr.map((x: any) => String(x || "").trim()).filter(Boolean);
      } catch {
        remoteNames = [];
      }
    }

    const merged = Array.from(new Set([...folderNames, ...remoteNames])).sort((a, b) => a.localeCompare(b));
    return NextResponse.json({ ok: true, items: merged });
  } catch (error) {
    console.error("读取文件夹列表失败:", error);
    return NextResponse.json(
      { ok: false, error: error instanceof Error ? error.message : String(error) },
      { status: 500 }
    );
  }
}
