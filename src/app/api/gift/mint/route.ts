/**
 * POST /api/gift/mint — build a mint tx for an existing gift that was
 * uploaded to Arweave but never minted on-chain (e.g. ARWEAVE_SOLANA_KEY
 * was missing when the gift was first created).
 */

import { NextRequest, NextResponse } from "next/server";
import { getCollection, updateCollection, saveCollection } from "@/lib/store";
import { buildGiftTransaction, isValidSolanaAddress } from "@/lib/mint-nft";
import { explorerClusterQuery, parseNetwork } from "@/lib/solana-config";

export const runtime = "nodejs";
export const maxDuration = 30;

export async function POST(req: NextRequest) {
  try {
    const body = await req.json() as { collectionId?: string; payer?: string; network?: string };
    const collectionId = String(body.collectionId || "").trim();
    const payer = String(body.payer || "").trim();
    const network = parseNetwork(body.network);

    if (!collectionId)
      return NextResponse.json({ error: "collectionId required" }, { status: 400 });
    if (!payer || !isValidSolanaAddress(payer))
      return NextResponse.json({ error: "Connect your wallet first" }, { status: 400 });

    const collection = await getCollection(collectionId);
    if (!collection)
      return NextResponse.json({ error: "Collection not found" }, { status: 404 });

    const token = collection.tokens[0];
    if (!token)
      return NextResponse.json({ error: "No token in collection" }, { status: 400 });
    if (token.assetAddress)
      return NextResponse.json({ error: "Already minted on-chain" }, { status: 400 });
    if (!token.metadataUri?.startsWith("http"))
      return NextResponse.json({ error: "Metadata URI missing" }, { status: 400 });

    const recipient = token.owner;
    if (!recipient || !isValidSolanaAddress(recipient))
      return NextResponse.json({ error: "Recipient address missing" }, { status: 400 });

    const nftName = `${collection.name} #${token.tokenId}`;
    const txResult = await buildGiftTransaction({
      name: nftName,
      metadataUri: token.metadataUri,
      recipient,
      payer,
      network,
    });

    if (!txResult) {
      return NextResponse.json(
        {
          error:
            "Mint transaction could not be built. Set ARWEAVE_SOLANA_KEY in Vercel environment variables.",
        },
        { status: 503 },
      );
    }

    await updateCollection(collectionId, (c) => {
      if (c.tokens[0]) c.tokens[0].assetAddress = txResult.assetAddress;
      c.status = "draft";
      c.mintedCount = 0;
      return c;
    });

    return NextResponse.json({
      collectionId,
      txBase64: txResult.txBase64,
      assetAddress: txResult.assetAddress,
      network,
      requiresWalletSignature: true,
    });
  } catch (err) {
    console.error("[POST /api/gift/mint]", err);
    const message = err instanceof Error ? err.message : "Failed to build mint transaction";
    return NextResponse.json({ error: message }, { status: 500 });
  }
}

/** Confirm mint after wallet signature (same as PATCH /api/gift). */
export async function PATCH(req: NextRequest) {
  try {
    const body = await req.json() as { collectionId?: string; txSignature?: string; network?: string };
    const { collectionId, txSignature } = body;
    const network = parseNetwork(body.network);

    if (!collectionId || !txSignature)
      return NextResponse.json({ error: "collectionId and txSignature required" }, { status: 400 });

    const collection = await getCollection(collectionId);
    if (!collection)
      return NextResponse.json({ error: "Collection not found" }, { status: 404 });

    collection.status = "sold_out";
    collection.mintedCount = 1;
    if (collection.tokens[0]) {
      collection.tokens[0].mintTxUrl = `https://explorer.solana.com/tx/${txSignature}${explorerClusterQuery(network)}`;
    }
    collection.updatedAt = new Date().toISOString();

    await saveCollection(collection);
    return NextResponse.json({ ok: true, collection });
  } catch (err) {
    console.error("[PATCH /api/gift/mint]", err);
    const message = err instanceof Error ? err.message : "Failed to confirm mint";
    return NextResponse.json({ error: message }, { status: 500 });
  }
}
