import * as fs from "fs-extra";
import { join, normalize } from "path";
import { resizeImage } from "@/lib/server/utils";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

function getDimsByRatio(ratio: string) {
  const r = (ratio || "").trim();
  const map: Record<string, { width: number; height: number }> = {
    "4:5": { width: 960, height: 1200 },
    "1:1": { width: 1024, height: 1024 },
    "16:9": { width: 1200, height: 628 },
    "9:16": { width: 628, height: 1200 },
  };
  return map[r];
}

async function readImageBytes(url: string): Promise<Buffer> {
  const u = String(url || "").trim();
  if (!u) throw new Error("url 不能为空");

  const isHttp = /^https?:\/\//i.test(u);
  if (isHttp) {
    const res = await fetch(u);
    if (!res.ok) throw new Error(`下载图片失败: status=${res.status}`);
    const ab = await res.arrayBuffer();
    return Buffer.from(ab);
  }

  if (!u.startsWith("/")) throw new Error("url 必须是 http(s) 或以 / 开头的站内路径");
  const rel = normalize(u).replaceAll("\\", "/");
  if (rel.includes("..")) throw new Error("非法路径");
  const abs = join(process.cwd(), "public", rel.replace(/^\//, ""));
  const st = await fs.stat(abs).catch(() => null);
  if (!st) throw new Error("文件不存在");
  if (st.isDirectory()) throw new Error("url 指向目录，必须是文件");
  return await fs.readFile(abs);
}

export async function POST(req: Request) {
  const body = await req.json().catch(() => null);
  if (!body || typeof body !== "object") {
    return Response.json({ ok: false, error: "body 必须是 JSON 对象" }, { status: 400 });
  }

  const url = String((body as any).url || "").trim();
  const ratiosRaw = (body as any).ratios;
  const ratios = Array.isArray(ratiosRaw) ? ratiosRaw.map((x: any) => String(x || "").trim()).filter(Boolean) : [];
  const finalRatios = ratios.length ? ratios : ["16:9", "1:1", "4:5", "9:16"];

  let buf: Buffer;
  try {
    buf = await readImageBytes(url);
  } catch (e) {
    return Response.json({ ok: false, error: e instanceof Error ? e.message : String(e) }, { status: 400 });
  }

  const inputBase64 = buf.toString("base64");

  const items: Array<{ ratio: string; dataUrl: string; width: number; height: number }> = [];
  for (const ratio of finalRatios) {
    const dims = getDimsByRatio(ratio);
    if (!dims) continue;
    const outBase64 = await resizeImage(inputBase64, dims.width, dims.height, { fit: "cover", format: "jpeg" });
    items.push({
      ratio,
      width: dims.width,
      height: dims.height,
      dataUrl: `data:image/jpeg;base64,${outBase64}`,
    });
  }

  return Response.json({ ok: true, items });
}

