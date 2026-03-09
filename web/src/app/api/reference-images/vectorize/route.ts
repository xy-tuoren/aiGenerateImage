import { NextResponse } from "next/server";
import { requireApiAccess } from "@/lib/server/auth";
import {
  clearAllVectorsFromCloudflareIndex,
  vectorizeRemoteIndexAndSaveToCloudflare,
} from "@/lib/server/referenceImageVectorize";

export const dynamic = "force-dynamic";
// 临时调试限制：设置为 >0 时，仅向量化前 N 条；0 表示不限制。
const TEMP_DEBUG_LIMIT = 0;

export async function POST(req: Request) {
  try {
    const guard = requireApiAccess(req);
    if (!guard.ok) {
      return NextResponse.json({ ok: false, error: guard.error }, { status: guard.status });
    }

    const body = await req.json().catch(() => ({} as any));
    const remoteIndexFile =
      typeof body?.remoteIndexFile === "string" && body.remoteIndexFile.trim()
        ? body.remoteIndexFile.trim()
        : undefined;
    const indexName =
      typeof body?.indexName === "string" && body.indexName.trim()
        ? body.indexName.trim()
        : undefined;
    const appName =
      typeof body?.appName === "string" && body.appName.trim()
        ? body.appName.trim()
        : undefined;
    const bodyDebugLimitRaw = Number(body?.debugLimit ?? 0);
    const bodyDebugLimit =
      Number.isFinite(bodyDebugLimitRaw) && bodyDebugLimitRaw > 0
        ? Math.floor(bodyDebugLimitRaw)
        : 0;
    const debugLimit = bodyDebugLimit > 0 ? bodyDebugLimit : TEMP_DEBUG_LIMIT > 0 ? TEMP_DEBUG_LIMIT : undefined;
    const clearAll = body?.clear === true || String(body?.action || "").trim().toLowerCase() === "clear";

    if (clearAll) {
      const result = await clearAllVectorsFromCloudflareIndex({
        indexName,
      });
      return NextResponse.json({ ok: true, mode: "clear", ...result });
    }

    const result = await vectorizeRemoteIndexAndSaveToCloudflare({
      remoteIndexFile,
      indexName,
      appName,
      debugLimit,
    });

    return NextResponse.json({
      ok: true,
      ...result,
      failedCount: Array.isArray(result.failed) ? result.failed.length : 0,
    });
  } catch (e) {
    const message = e instanceof Error ? e.message : "未知错误";
    console.error("[reference-image-vectorize] route failed", e);
    return NextResponse.json({ ok: false, error: message }, { status: 500 });
  }
}
