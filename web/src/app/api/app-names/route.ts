import { NextResponse } from "next/server";
import * as fs from "fs-extra";
import { join } from "path";
import { getUserFromRequest } from "@/lib/server/auth";

export async function GET(req: Request) {
  try {
    const user = getUserFromRequest(req);
    if (!user) return NextResponse.json({ ok: false, error: "未登录" }, { status: 401 });
    // refImageDatas 文件夹相对于 web 目录的路径
    const refImageDatasPath = join(process.cwd(), "public", "material");
    const folders = await fs.readdir(refImageDatasPath, { withFileTypes: true });
    const folderNames = folders
      .filter((item) => item.isDirectory())
      .map((item) => item.name)
      .sort();
    return NextResponse.json({ ok: true, items: folderNames });
  } catch (error) {
    console.error("读取文件夹列表失败:", error);
    return NextResponse.json(
      { ok: false, error: error instanceof Error ? error.message : String(error) },
      { status: 500 }
    );
  }
}
