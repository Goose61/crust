/**
 * POST /api/gift/mint — build a mint tx for an existing gift that was
 * uploaded to Arweave but never minted on-chain (e.g. ARWEAVE_SOLANA_KEY
 * was missing when the gift was first created).
 */

import { NextRequest, NextResponse } from "next/server";
import { getCollection, updateCollection } from "@/lib/store";
import { buildGiftTransaction, isValidSolanaAddress } from "@/lib/mint-nft";
import { explorerClusterQuery } from "@/lib/solana-config";

export const runtime = "nodejs";

export async function POST(req: NextRequest) {
  const body = await req.json() as { collectionId?: string; payer?: string };
  const collectionId = String(body.collectionId || "").trim();
  const payer = String(body.payer || "").trim();

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
  });

  if (!txResult) {
    return NextResponse.json(
      {
        error:
          "Mint transaction could not be built. Set ARWEAVE_SOLANA_KEY in server environment variables.",
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
    requiresWalletSignature: true,
  });
}

/** Confirm mint after wallet signature (same as PATCH /api/gift). */
export async function PATCH(req: NextRequest) {
  const body = await req.json() as { collectionId?: string; txSignature?: string };
  const { collectionId, txSignature } = body;

  if (!collectionId || !txSignature)
    return NextResponse.json({ error: "collectionId and txSignature required" }, { status: 400 });

  const collection = await getCollection(collectionId);
  if (!collection)
    return NextResponse.json({ error: "Collection not found" }, { status: 404 });

  collection.status = "sold_out";
  collection.mintedCount = 1;
  if (collection.tokens[0]) {
    collection.tokens[0].mintTxUrl = `https://explorer.solana.com/tx/${txSignature}${explorerClusterQuery()}`;
  }
  collection.updatedAt = new Date().toISOString();

  const { saveCollection } = await import("@/lib/store");
  await saveCollection(collection);
  return NextResponse.json({ ok: true, collection });
}
