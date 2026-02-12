import { getMongoDb } from "@/lib/server/mongodb";
import { requireApiAccess, resolveGalleryGroupUserIds } from "@/lib/server/auth";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

type CutRecordDoc = { sourceUrl: string; updatedAt?: Date };
type DownloadRecordDoc = { sourceUrl: string; updatedAt?: Date };
type FireplayUploadRecordDoc = { sourceUrl: string; uploadedAt?: Date; updatedAt?: Date };

function toIsoOrNow(d: Date | undefined) {
  const t = d instanceof Date ? d.getTime() : 0;
  if (!Number.isFinite(t) || t <= 0) return new Date().toISOString();
  return new Date(t).toISOString();
}

export async function GET(req: Request) {
  const guard = requireApiAccess(req);
  if (!guard.ok) return Response.json({ ok: false, error: guard.error }, { status: guard.status });
  const user = guard.user;
  const groupUserIds = resolveGalleryGroupUserIds(user.username);
  const userIdFilter = groupUserIds.length ? { $in: groupUserIds } : user.userId;

  const { searchParams } = new URL(req.url);
  const intervalMs = Math.min(10_000, Math.max(800, Number(searchParams.get("intervalMs") || 2000) || 2000));
  const sinceRaw = Number(searchParams.get("since") || 0) || 0;
  let sinceDate = sinceRaw > 0 ? new Date(sinceRaw) : new Date(Date.now() - 15_000);

  const encoder = new TextEncoder();

  const stream = new ReadableStream<Uint8Array>({
    async start(controller) {
      let stopped = false;
      const stop = () => {
        if (stopped) return;
        stopped = true;
        try {
          controller.close();
        } catch {
        }
      };
      if ((req as any).signal?.aborted) stop();
      else (req as any).signal?.addEventListener?.("abort", stop);

      const write = (s: string) => controller.enqueue(encoder.encode(s));
      const sendEvent = (event: string, data: any) => {
        write(`event: ${event}\n`);
        write(`data: ${JSON.stringify(data)}\n\n`);
      };

      // initial hello + keepalive hints
      sendEvent("hello", { ok: true, serverTime: Date.now(), intervalMs });

      while (!stopped) {
        try {
          const db = await getMongoDb();
          const cutCol = db.collection<CutRecordDoc>("cut_records");
          const downloadCol = db.collection<DownloadRecordDoc>("download_records");
          const fireplayCol = db.collection<FireplayUploadRecordDoc>("fireplay_upload_records");

          const [cutDocs, dlDocs, fpDocs] = await Promise.all([
            cutCol
              .find({ userId: userIdFilter as any, updatedAt: { $gt: sinceDate } } as any, { projection: { sourceUrl: 1, updatedAt: 1 } as any, limit: 2000 } as any)
              .toArray(),
            downloadCol
              .find({ userId: userIdFilter as any, updatedAt: { $gt: sinceDate } } as any, { projection: { sourceUrl: 1, updatedAt: 1 } as any, limit: 2000 } as any)
              .toArray(),
            fireplayCol
              .find(
                {
                  userId: userIdFilter as any,
                  $or: [{ uploadedAt: { $gt: sinceDate } }, { updatedAt: { $gt: sinceDate } }],
                } as any,
                { projection: { sourceUrl: 1, uploadedAt: 1, updatedAt: 1 } as any, limit: 2000 } as any
              )
              .toArray(),
          ]);

          const cutUrls = Array.from(new Set((cutDocs || []).map((d: any) => String(d?.sourceUrl || "").trim()).filter(Boolean)));
          const downloadedUrls = Array.from(new Set((dlDocs || []).map((d: any) => String(d?.sourceUrl || "").trim()).filter(Boolean)));
          const fireplayUploadedUrls = Array.from(new Set((fpDocs || []).map((d: any) => String(d?.sourceUrl || "").trim()).filter(Boolean)));

          // advance sinceDate to "now" to avoid re-sending same batch forever
          const nextSince = new Date();
          const payload = {
            ok: true,
            serverTime: Date.now(),
            since: sinceDate.getTime(),
            nextSince: nextSince.getTime(),
            cutUrls,
            downloadedUrls,
            fireplayUploadedUrls,
          };

          // Only push when there is something meaningful.
          if (cutUrls.length || downloadedUrls.length || fireplayUploadedUrls.length) {
            sendEvent("flags", payload);
          } else {
            // keepalive comment (so proxies don't kill the connection)
            write(`: ping ${toIsoOrNow(undefined)}\n\n`);
          }

          sinceDate = nextSince;
        } catch (e: any) {
          sendEvent("error", { ok: false, error: e instanceof Error ? e.message : String(e) });
          // backoff a bit on errors
          await new Promise((r) => setTimeout(r, Math.min(5000, intervalMs)));
        }

        await new Promise((r) => setTimeout(r, intervalMs));
      }
    },
  });

  return new Response(stream, {
    headers: {
      "Content-Type": "text/event-stream; charset=utf-8",
      "Cache-Control": "no-cache, no-transform",
      Connection: "keep-alive",
    },
  });
}

