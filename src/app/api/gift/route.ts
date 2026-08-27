/**
 * POST /api/gift  — build Core mint tx from client-uploaded Arweave URIs
 * PATCH /api/gift — confirm on-chain mint after wallet signature
 *
 * Each gift appends a token to the shared gift bundle collection (Market UI).
 */

import { NextRequest, NextResponse } from "next/server";
import { saveCollection, getCollection } from "@/lib/store";
import { rateLimit } from "@/lib/rate-limit";
import { type GeneratedToken } from "@/lib/types";
import { buildGiftTransaction, isValidSolanaAddress } from "@/lib/mint-nft";
import {
  appendGiftToken,
  findGiftToken,
  giftDisplayNameFromToken,
  syncGiftBundleCounts,
} from "@/lib/gift-bundle";
import { getOrCreateGiftBundle } from "@/lib/gift-bundle-server";
import {
  GIFT_NAME,
  buildGiftAttributes,
  giftMintName,
  sanitizeForPhantomMetadata,
} from "@/lib/gift-metadata";
import { explorerClusterQuery, parseNetwork } from "@/lib/solana-config";
import { verifyMintTransaction } from "@/lib/verify-mint";

export const runtime = "nodejs";

export async function POST(req: NextRequest) {
  const ip = req.headers.get("x-forwarded-for")?.split(",")[0] ?? "unknown";
  const rl = await rateLimit(`gift:${ip}`, 20, 60 * 60 * 1000);
  if (!rl.allowed)
    return NextResponse.json({ error: "Too many requests" }, { status: 429 });

  const body = await req.json() as {
    name?: string;
    recipient?: string;
    payer?: string;
    note?: string;
    imageUri?: string;
    metadataUri?: string;
    contentType?: string;
    imageExt?: string;
    network?: string;
  };

  const name = sanitizeForPhantomMetadata(String(body.name || GIFT_NAME).trim()) || GIFT_NAME;
  if (name.length > 32)
    return NextResponse.json({ error: "Name must be 32 characters or fewer" }, { status: 400 });

  const recipient = String(body.recipient || "").trim();
  const payer = String(body.payer || "").trim();
  const note = String(body.note || "").slice(0, 200);
  const imageUri = String(body.imageUri || "").trim();
  const metadataUri = String(body.metadataUri || "").trim();
  const safeExt = String(body.imageExt || ".png");
  const network = parseNetwork(body.network);

  if (!recipient || !isValidSolanaAddress(recipient))
    return NextResponse.json({ error: "Recipient is not a valid Solana address" }, { status: 400 });
  if (!payer || !isValidSolanaAddress(payer))
    return NextResponse.json({ error: "Connect your wallet before sending" }, { status: 400 });
  if (!imageUri.startsWith("http") && !imageUri.startsWith("/api/"))
    return NextResponse.json({ error: "Image must be uploaded to Arweave first" }, { status: 400 });
  if (!metadataUri.startsWith("http") && !metadataUri.startsWith("/api/"))
    return NextResponse.json({ error: "Metadata must be uploaded to Arweave first" }, { status: 400 });

  const nftName = giftMintName(name);

  let txBase64: string | null = null;
  let assetAddress: string | null = null;
  let pendingMint = undefined;

  const txResult = await buildGiftTransaction({
    name: nftName,
    metadataUri,
    recipient,
    payer,
    network,
  });

  if (txResult) {
    txBase64 = txResult.txBase64;
    assetAddress = txResult.assetAddress;
    pendingMint = txResult.pendingMint;
  }

  const tokenInput: Omit<GeneratedToken, "tokenId"> = {
    dna: "gift",
    attributes: buildGiftAttributes(note, payer),
    imageRelPath: `images/gift-${Date.now()}${safeExt}`,
    metadataRelPath: `metadata/gift-${Date.now()}.json`,
    imageUri,
    metadataUri,
    owner: recipient,
    ...(assetAddress ? { assetAddress } : {}),
  };

  let bundle = await getOrCreateGiftBundle();
  const { bundle: nextBundle, tokenId } = appendGiftToken(bundle, tokenInput);
  bundle = nextBundle;

  if (pendingMint) {
    bundle.pendingMint = { ...pendingMint, tokenId };
  }

  await saveCollection(bundle);

  return NextResponse.json({
    collectionId: bundle.id,
    tokenId,
    displayName: giftDisplayNameFromToken(findGiftToken(bundle, tokenId)!),
    imageUri,
    metadataUri,
    storageMethod: "arweave",
    txBase64,
    assetAddress,
    network,
    requiresWalletSignature: !!txBase64,
    ...(txBase64
      ? {}
      : {
          warning:
            "Image saved to Arweave, but on-chain mint was skipped — set ARWEAVE_SOLANA_KEY on the server.",
        }),
  });
}

export async function PATCH(req: NextRequest) {
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
  if (!Number.isFinite(tokenId) || tokenId < 1)
    return NextResponse.json({ error: "tokenId required" }, { status: 400 });

  const collection = await getCollection(collectionId);
  if (!collection)
    return NextResponse.json({ error: "Collection not found" }, { status: 404 });

  const token = findGiftToken(collection, tokenId);
  if (!token)
    return NextResponse.json({ error: "Gift token not found in bundle" }, { status: 404 });

  const verified = await verifyMintTransaction(txSignature, network);
  if (!verified.ok) {
    return NextResponse.json({ error: verified.reason }, { status: 400 });
  }

  token.mintTxUrl = `https://explorer.solana.com/tx/${txSignature}${explorerClusterQuery(network)}`;
  delete collection.pendingMint;
  syncGiftBundleCounts(collection);
  collection.updatedAt = new Date().toISOString();

  await saveCollection(collection);
  return NextResponse.json({ ok: true, collection, tokenId });
}
