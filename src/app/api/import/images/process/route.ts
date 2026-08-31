import { NextRequest, NextResponse } from "next/server";
import { getCollection } from "@/lib/store";

export const runtime = "nodejs";
export const maxDuration = 300;
export const dynamic = "force-dynamic";

/** Heavy ZIP → images import — separate invocation with a 5-minute budget. */
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
    if (!collection.pendingZipUrl) {
      return NextResponse.json({ error: "No pending ZIP import for this collection" }, { status: 400 });
    }
    if (collection.status !== "importing") {
      return NextResponse.json({ ok: true, alreadyDone: true });
    }

    const { runImageImportJob } = await import("@/lib/import-images-job");
    await runImageImportJob({
      collectionId,
      zipUrl: collection.pendingZipUrl,
      name: collection.name,
      description: collection.description,
      creatorWallet: collection.payments.creatorWallet ?? "",
    });

    return NextResponse.json({ ok: true });
  } catch (err) {
    console.error("[POST /api/import/images/process]", err);
    const message = err instanceof Error ? err.message : "Import processing failed";
    return NextResponse.json({ error: message }, { status: 500 });
  }
}
