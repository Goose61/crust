import { NextRequest, NextResponse } from "next/server";
import { purgeCollectionUploadZips } from "@/lib/blob-cleanup";

export const runtime = "nodejs";
export const maxDuration = 60;
export const dynamic = "force-dynamic";

/**
 * One-time maintenance: delete orphaned collection ZIP uploads.
 * Set BLOB_CLEANUP_SECRET in Vercel env, then:
 *   curl -X POST https://www.thecrust.io/api/blob/purge-uploads -H "Authorization: Bearer YOUR_SECRET"
 */
export async function POST(req: NextRequest) {
  const secret = process.env.BLOB_CLEANUP_SECRET?.trim();
  if (!secret) {
    return NextResponse.json(
      { error: "BLOB_CLEANUP_SECRET is not configured on this deployment" },
      { status: 503 },
    );
  }

  const auth = req.headers.get("authorization")?.replace(/^Bearer\s+/i, "").trim();
  if (auth !== secret) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  try {
    const result = await purgeCollectionUploadZips();
    return NextResponse.json({ ok: true, ...result });
  } catch (err) {
    console.error("[POST /api/blob/purge-uploads]", err);
    const message = err instanceof Error ? err.message : "Purge failed";
    return NextResponse.json({ error: message }, { status: 500 });
  }
}
