import { NextRequest, NextResponse } from "next/server";
import { waitUntil } from "@vercel/functions";
import { getCollection } from "@/lib/store";
import { readAuthHeaders, assertCreatorAuth } from "@/lib/wallet-auth";

export const runtime = "nodejs";
export const maxDuration = 300;
export const dynamic = "force-dynamic";

/** Heavy ZIP → images import — returns immediately; job runs for up to 5 minutes. */
export async function POST(req: NextRequest) {
  try {
    const body = (await req.json()) as { collectionId?: string };
    const collectionId = String(body.collectionId || "").trim();
    if (!collectionId) {
      return NextResponse.json({ error: "collectionId required" }, { status: 400 });
    }

    const collection = await getCollection(collectionId);
    if (!collection) {
      return NextResponse.json({ error: "Collection not found" }, { status: 404 });
    }
    try {
      assertCreatorAuth(readAuthHeaders(req), collection.payments.creatorWallet);
    } catch (e) {
      const message = e instanceof Error ? e.message : "Unauthorized";
      return NextResponse.json({ error: message }, { status: 401 });
    }
    if (!collection.pendingZipUrl) {
      return NextResponse.json({ error: "No pending ZIP import for this collection" }, { status: 400 });
    }
    if (collection.status !== "importing") {
      return NextResponse.json({ ok: true, alreadyDone: true });
    }

    const jobParams = {
      collectionId,
      zipUrl: collection.pendingZipUrl,
      name: collection.name,
      description: collection.description,
      creatorWallet: collection.payments.creatorWallet ?? "",
    };

    waitUntil(
      import("@/lib/import-images-job")
        .then(({ runImageImportJob }) => runImageImportJob(jobParams))
        .catch((err) => {
          console.error(`[import job ${collectionId}] background failure`, err);
        }),
    );

    return NextResponse.json({ ok: true, started: true }, { status: 202 });
  } catch (err) {
    console.error("[POST /api/import/images/process]", err);
    const message = err instanceof Error ? err.message : "Import processing failed";
    return NextResponse.json({ error: message }, { status: 500 });
  }
}
