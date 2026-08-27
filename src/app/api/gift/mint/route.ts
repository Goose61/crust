/**
 * POST /api/gift/mint — build a mint tx for an existing gift token in the bundle
 * that was uploaded to Arweave but never minted on-chain.
 */

import { NextRequest, NextResponse } from "next/server";
import { getCollection, updateCollection, saveCollection } from "@/lib/store";
import { buildGiftTransaction, isValidSolanaAddress } from "@/lib/mint-nft";
import { findGiftToken, isGiftBundle, syncGiftBundleCounts } from "@/lib/gift-bundle";
import { giftMintName } from "@/lib/gift-metadata";
import { explorerClusterQuery, parseNetwork, type SolanaNetwork } from "@/lib/solana-config";
import {
  resetStaleMintState,
  txSignatureFromMintUrl,
  verifyMintTransaction,
} from "@/lib/verify-mint";
import type { Collection } from "@/lib/types";

export const runtime = "nodejs";
export const maxDuration = 30;

async function ensureMintAllowed(
  collection: Collection,
  collectionId: string,
  tokenId: number,
  network: SolanaNetwork,
): Promise<Collection> {
  const token = findGiftToken(collection, tokenId);
  const sig = txSignatureFromMintUrl(token?.mintTxUrl);
  if (sig) {
    const verified = await verifyMintTransaction(sig, network);
    if (verified.ok) {
      throw new Error("Already minted on-chain");
    }
    await resetStaleMintState(collectionId);
    const fresh = await getCollection(collectionId);
    if (!fresh) throw new Error("Collection not found");
    return fresh;
  }
  return collection;
}

function resolveTokenId(collection: Collection, tokenId?: number): number {
  if (tokenId && tokenId > 0) return tokenId;
  if (collection.tokens.length === 1) return collection.tokens[0].tokenId;
  throw new Error("tokenId required for gift bundle remint");
}

export async function POST(req: NextRequest) {
  try {
    const body = await req.json() as {
      collectionId?: string;
      tokenId?: number;
      payer?: string;
      network?: string;
    };
    const collectionId = String(body.collectionId || "").trim();
    const payer = String(body.payer || "").trim();
    const network = parseNetwork(body.network);

    if (!collectionId)
      return NextResponse.json({ error: "collectionId required" }, { status: 400 });
    if (!payer || !isValidSolanaAddress(payer))
      return NextResponse.json({ error: "Connect your wallet first" }, { status: 400 });

    let collection = await getCollection(collectionId);
    if (!collection)
      return NextResponse.json({ error: "Collection not found" }, { status: 404 });

    const tokenId = resolveTokenId(collection, body.tokenId);

    try {
      collection = await ensureMintAllowed(collection, collectionId, tokenId, network);
    } catch (err) {
      const msg = err instanceof Error ? err.message : "Mint not allowed";
      const status = msg.includes("Already minted") ? 400 : 500;
      return NextResponse.json({ error: msg }, { status });
    }

    const token = findGiftToken(collection, tokenId);
    if (!token)
      return NextResponse.json({ error: "Gift token not found" }, { status: 400 });
    if (!token.metadataUri?.startsWith("http"))
      return NextResponse.json({ error: "Metadata URI missing" }, { status: 400 });

    const recipient = token.owner;
    if (!recipient || !isValidSolanaAddress(recipient))
      return NextResponse.json({ error: "Recipient address missing" }, { status: 400 });

    const noteAttr = token.attributes.find((a) => a.trait_type === "Note")?.value;
    const label = typeof noteAttr === "string" && noteAttr.trim() ? noteAttr.trim() : collection.name;
    const nftName = giftMintName(label);

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
      const t = findGiftToken(c, tokenId);
      if (t) t.assetAddress = txResult.assetAddress;
      c.pendingMint = { ...txResult.pendingMint, tokenId };
      if (!isGiftBundle(c)) {
        c.status = "draft";
        c.mintedCount = 0;
      }
      return c;
    });

    return NextResponse.json({
      collectionId,
      tokenId,
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

export async function PATCH(req: NextRequest) {
  try {
    const body = await req.json() as {
      collectionId?: string;
      tokenId?: number;
      txSignature?: string;
      network?: string;
    };
    const { collectionId, txSignature } = body;
    const tokenId = Number(body.tokenId);
    const network = parseNetwork(body.network);

    if (!collectionId || !txSignature)
      return NextResponse.json({ error: "collectionId and txSignature required" }, { status: 400 });

    const collection = await getCollection(collectionId);
    if (!collection)
      return NextResponse.json({ error: "Collection not found" }, { status: 404 });

    const verified = await verifyMintTransaction(txSignature, network);
    if (!verified.ok) {
      return NextResponse.json({ error: verified.reason }, { status: 400 });
    }

    const resolvedTokenId = resolveTokenId(collection, tokenId);
    const token = findGiftToken(collection, resolvedTokenId);
    if (!token)
      return NextResponse.json({ error: "Gift token not found" }, { status: 404 });

    token.mintTxUrl = `https://explorer.solana.com/tx/${txSignature}${explorerClusterQuery(network)}`;
    delete collection.pendingMint;

    if (isGiftBundle(collection)) {
      syncGiftBundleCounts(collection);
    } else {
      collection.status = "sold_out";
      collection.mintedCount = 1;
    }
    collection.updatedAt = new Date().toISOString();

    await saveCollection(collection);
    return NextResponse.json({ ok: true, collection, tokenId: resolvedTokenId });
  } catch (err) {
    console.error("[PATCH /api/gift/mint]", err);
    const message = err instanceof Error ? err.message : "Failed to confirm mint";
    return NextResponse.json({ error: message }, { status: 500 });
  }
}
