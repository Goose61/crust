/**
 * POST /api/gift/prepare-sign
 *
 * Immediately before Phantom signing:
 *   1. Rebuild unsigned tx with a fresh blockhash (same asset keypair)
 *   2. simulateTransaction with sigVerify: false
 *
 * @see https://docs.phantom.com/solana/sending-a-transaction
 * @see https://www.metaplex.com/docs/smart-contracts/core/create-asset
 */

import { NextRequest, NextResponse } from "next/server";
import { getCollection } from "@/lib/store";
import { isValidSolanaAddress, prepareGiftTransactionForSigning } from "@/lib/mint-nft";
import { parseNetwork } from "@/lib/solana-config";
import { rateLimit } from "@/lib/rate-limit";
import type { Collection, PendingMint } from "@/lib/types";

export const runtime = "nodejs";
export const maxDuration = 30;

function resolvePendingMint(collection: Collection, payer: string): PendingMint {
  const pm = collection.pendingMint;
  if (!pm) {
    throw new Error("No pending mint for this collection — rebuild the mint transaction.");
  }

  const token = collection.tokens[0];
  if (pm.name && pm.metadataUri && pm.recipient && pm.payer) {
    return pm;
  }

  if (!token?.metadataUri || !token.owner) {
    throw new Error("Collection is missing token metadata for mint refresh.");
  }

  return {
    ...pm,
    name: pm.name ?? `${collection.name} #${token.tokenId}`,
    metadataUri: pm.metadataUri ?? token.metadataUri,
    recipient: pm.recipient ?? token.owner,
    payer: pm.payer ?? payer,
  };
}

export async function POST(req: NextRequest) {
  try {
    const ip = req.headers.get("x-forwarded-for")?.split(",")[0] ?? "unknown";
    const rl = await rateLimit(`gift-prepare-sign:${ip}`, 60, 60 * 60 * 1000);
    if (!rl.allowed) {
      return NextResponse.json({ error: "Too many requests" }, { status: 429 });
    }

    const body = await req.json() as {
      collectionId?: string;
      payer?: string;
      network?: string;
    };

    const collectionId = String(body.collectionId || "").trim();
    const payer = String(body.payer || "").trim();
    const network = parseNetwork(body.network);

    if (!collectionId) {
      return NextResponse.json({ error: "collectionId required" }, { status: 400 });
    }
    if (!payer || !isValidSolanaAddress(payer)) {
      return NextResponse.json({ error: "Valid payer wallet required" }, { status: 400 });
    }

    const collection = await getCollection(collectionId);
    if (!collection) {
      return NextResponse.json({ error: "Collection not found" }, { status: 404 });
    }

    const pendingMint = resolvePendingMint(collection, payer);
    const prepared = await prepareGiftTransactionForSigning({
      pendingMint,
      payer,
      network,
    });

    return NextResponse.json({
      txBase64: prepared.txBase64,
      assetAddress: prepared.assetAddress,
      network,
    });
  } catch (err) {
    console.error("[POST /api/gift/prepare-sign]", err);
    const message = err instanceof Error ? err.message : "Prepare sign failed";
    const status = message.includes("would fail") ? 400 : 500;
    return NextResponse.json({ error: message }, { status });
  }
}
