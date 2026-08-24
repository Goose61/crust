/**
 * POST /api/gift/cosign
 *
 * Completes a gift mint after Phantom signs first (multi-signer order):
 *   1. User signed unsigned tx via phantom.signTransaction()
 *   2. Server co-signs with platform + asset keys and submits to Solana
 */

import { NextRequest, NextResponse } from "next/server";
import { getCollection } from "@/lib/store";
import { cosignAndSubmitGiftTransaction } from "@/lib/mint-nft";
import { parseNetwork } from "@/lib/solana-config";
import { rateLimit } from "@/lib/rate-limit";

export const runtime = "nodejs";
export const maxDuration = 30;

export async function POST(req: NextRequest) {
  try {
    const ip = req.headers.get("x-forwarded-for")?.split(",")[0] ?? "unknown";
    const rl = await rateLimit(`gift-cosign:${ip}`, 30, 60 * 60 * 1000);
    if (!rl.allowed) {
      return NextResponse.json({ error: "Too many requests" }, { status: 429 });
    }

    const body = await req.json() as {
      collectionId?: string;
      signedTxBase64?: string;
      network?: string;
    };

    const collectionId = String(body.collectionId || "").trim();
    const signedTxBase64 = String(body.signedTxBase64 || "").trim();
    const network = parseNetwork(body.network);

    if (!collectionId) {
      return NextResponse.json({ error: "collectionId required" }, { status: 400 });
    }
    if (!signedTxBase64) {
      return NextResponse.json({ error: "signedTxBase64 required" }, { status: 400 });
    }

    const collection = await getCollection(collectionId);
    if (!collection) {
      return NextResponse.json({ error: "Collection not found" }, { status: 404 });
    }
    if (!collection.pendingMint) {
      return NextResponse.json(
        { error: "No pending mint for this collection — rebuild the mint transaction." },
        { status: 400 },
      );
    }

    const txSignature = await cosignAndSubmitGiftTransaction({
      userSignedTxBase64: signedTxBase64,
      pendingMint: collection.pendingMint,
      network,
    });

    return NextResponse.json({ txSignature, network });
  } catch (err) {
    console.error("[POST /api/gift/cosign]", err);
    const message = err instanceof Error ? err.message : "Co-sign failed";
    return NextResponse.json({ error: message }, { status: 500 });
  }
}
