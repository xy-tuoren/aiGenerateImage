import { NextResponse } from "next/server";
import { requireApiAccess } from "@/lib/server/auth";
import { searchReferenceImagesByVector } from "@/lib/server/referenceImageVectorize";

export const dynamic = "force-dynamic";

export async function POST(req: Request) {
  try {
    const guard = requireApiAccess(req);
    if (!guard.ok) {
      return NextResponse.json({ ok: false, error: guard.error }, { status: guard.status });
    }

    const body = await req.json().catch(() => ({} as any));
    const appName =
      typeof body?.appName === "string" && body.appName.trim()
        ? body.appName.trim()
        : "";
    const imageUrl =
      typeof body?.imageUrl === "string" && body.imageUrl.trim()
        ? body.imageUrl.trim()
        : "";
    const text =
      typeof body?.text === "string" && body.text.trim()
        ? body.text.trim()
        : "";
    const topKRaw = Number(body?.topK ?? 50);
    const topK =
      Number.isFinite(topKRaw) && topKRaw > 0
        ? Math.floor(topKRaw)
        : 50;

    const result = await searchReferenceImagesByVector({
      appName,
      imageUrl: imageUrl || undefined,
      text: text || undefined,
      topK,
    });

    return NextResponse.json({
      ok: true,
      ...result,
      images: result.matches.map((x) => x.url),
    });
  } catch (e) {
    const message = e instanceof Error ? e.message : "未知错误";
    console.error("[reference-image-vector-search] route failed", e);
    return NextResponse.json({ ok: false, error: message }, { status: 500 });
  }
}
