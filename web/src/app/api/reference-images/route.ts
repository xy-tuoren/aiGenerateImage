import { NextResponse } from "next/server";
import { fetchAdCostMonthAllThenMatchAppNamesAndDownloadToPublicMaterial } from "@/lib/server/getReferenceImages";

export const dynamic = "force-dynamic";

export async function POST(req: Request) {
  try {
    const body = await req.json().catch(() => ({}));
    const result = await fetchAdCostMonthAllThenMatchAppNamesAndDownloadToPublicMaterial({
      forceRefresh: body?.forceRefresh === true,
    });
    const appNames = Object.keys(result || {});
    let totalItems = 0;
    let totalFiles = 0;
    for (const k of appNames) {
      const bucket = (result as any)[k];
      totalItems += Array.isArray(bucket?.items) ? bucket.items.length : 0;
      totalFiles += Array.isArray(bucket?.local_files) ? bucket.local_files.length : 0;
    }
    return NextResponse.json({ ok: true, appNames: appNames.length, totalItems, totalFiles });
  } catch (e) {
    const message = e instanceof Error ? e.message : "未知错误";
    return NextResponse.json({ ok: false, error: message }, { status: 500 });
  }
}
