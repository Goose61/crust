import { NextRequest, NextResponse } from "next/server";
import { prepareCoreCollectionTransaction } from "@/lib/create-core-collection";
import { getCollection, updateCollection } from "@/lib/store";
import { assertCreatorAuth, requireWalletAuth } from "@/lib/wallet-auth";
import { parseNetwork } from "@/lib/solana-config";

export const runtime = "nodejs";
export const maxDuration = 120;
export const dynamic = "force-dynamic";

type Params = { params: Promise<{ id: string }> };

export async function POST(req: NextRequest, { params }: Params) {
  try {
    const { id } = await params;
    const auth = requireWalletAuth(req);
    const collection = await getCollection(id);
    if (!collection) {
      return NextResponse.json({ error: "Collection not found" }, { status: 404 });
    }
    assertCreatorAuth(auth, collection.payments.creatorWallet);

    if (collection.coreCollectionAddress) {
      return NextResponse.json({
        collectionAddress: collection.coreCollectionAddress,
        alreadyCreated: true,
      });
    }

    const body = (await req.json()) as { network?: string };
    const network = parseNetwork(body.network);

    const prepared = await prepareCoreCollectionTransaction({
      collection,
      payer: auth.wallet,
      network,
    });

    await updateCollection(id, (current) => ({
      ...current,
      pendingCoreCollection: prepared.pendingCoreCollection,
    }));

    return NextResponse.json({
      txBase64: prepared.txBase64,
      collectionAddress: prepared.collectionAddress,
      metadataUri: prepared.metadataUri,
      network,
    });
  } catch (err) {
    console.error("[POST /api/collections/[id]/core-collection/prepare-sign]", err);
    const message = err instanceof Error ? err.message : "Prepare sign failed";
    const status =
      message.includes("would fail") ||
      message.includes("Not enough SOL") ||
      message.includes("does not have enough SOL")
        ? 400
        : 500;
    return NextResponse.json({ error: message }, { status });
  }
}
