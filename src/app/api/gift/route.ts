/**
 * POST /api/gift  — build mint tx from client-uploaded Arweave URIs
 * PATCH /api/gift — confirm on-chain mint after wallet signature
 *
 * Storage uploads happen client-side (minter pays via Irys).
 * This route only builds the Metaplex Core transaction and persists records.
 */

import { NextRequest, NextResponse } from "next/server";
import { newId, saveCollection, slugify, getCollection } from "@/lib/store";
import { rateLimit } from "@/lib/rate-limit";
import { defaultPayments, type Collection, type GeneratedToken } from "@/lib/types";
import { buildGiftTransaction, isValidSolanaAddress } from "@/lib/mint-nft";

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
  };

  const name = String(body.name || "Gift NFT").trim() || "Gift NFT";
  if (name.length > 32)
    return NextResponse.json({ error: "Name must be 32 characters or fewer" }, { status: 400 });

  const recipient = String(body.recipient || "").trim();
  const payer = String(body.payer || "").trim();
  const note = String(body.note || "").slice(0, 200);
  const imageUri = String(body.imageUri || "").trim();
  const metadataUri = String(body.metadataUri || "").trim();
  const contentType = String(body.contentType || "image/png");
  const safeExt = String(body.imageExt || ".png");

  if (!recipient || !isValidSolanaAddress(recipient))
    return NextResponse.json({ error: "Recipient is not a valid Solana address" }, { status: 400 });
  if (!payer || !isValidSolanaAddress(payer))
    return NextResponse.json({ error: "Connect your wallet before sending" }, { status: 400 });
  if (!imageUri.startsWith("http") && !imageUri.startsWith("/api/"))
    return NextResponse.json({ error: "Image must be uploaded to Arweave first" }, { status: 400 });
  if (!metadataUri.startsWith("http") && !metadataUri.startsWith("/api/"))
    return NextResponse.json({ error: "Metadata must be uploaded to Arweave first" }, { status: 400 });

  const id = newId();
  const nftName = `${name} #1`;

  let txBase64: string | null = null;
  let assetAddress: string | null = null;

  const txResult = await buildGiftTransaction({
    name: nftName,
    metadataUri,
    recipient,
    payer,
  });

  if (txResult) {
    txBase64 = txResult.txBase64;
    assetAddress = txResult.assetAddress;
  }

  const token: GeneratedToken = {
    tokenId: 1,
    dna: "gift",
    attributes: [
      ...(note ? [{ trait_type: "Note", value: note }] : []),
      { trait_type: "Type", value: "Gift" },
      { trait_type: "Edition", value: "1/1" },
    ],
    imageRelPath: `images/1${safeExt}`,
    metadataRelPath: "metadata/1.json",
    imageUri,
    metadataUri,
    owner: recipient,
    ...(assetAddress ? { assetAddress } : {}),
  };

  const collection: Collection = {
    id,
    slug: slugify(name),
    name,
    symbol: name.slice(0, 6).toUpperCase().replace(/\s/g, ""),
    description: note || `1/1 gift from ${payer} to ${recipient}.`,
    nameTemplate: "{name} #{id}",
    chain: "solana",
    status: txBase64 ? "draft" : "sold_out",
    supply: 1,
    mintedCount: txBase64 ? 0 : 1,
    artPath: "path-a",
    stackOrder: [],
    layers: [],
    blindMint: false,
    revealTrigger: "manual",
    revealed: true,
    milestones: [],
    payments: defaultPayments({
      basePriceUsd: 0,
      giftMintEnabled: true,
      creatorWallet: payer,
      acceptPizza: false,
    }),
    fees: {
      ownerPercent: 97,
      holdersPercent: 1,
      buybackPercent: 1,
      platformPercent: 1,
      locked: true,
    },
    allowlist: [],
    waitlist: [],
    publicMintOpen: false,
    secondaryEnabled: false,
    holderPageUnlocked: false,
    irysPublished: imageUri.includes("gateway.irys.xyz"),
    createdAt: new Date().toISOString(),
    updatedAt: new Date().toISOString(),
    tokens: [token],
  };

  await saveCollection(collection);

  return NextResponse.json({
    collectionId: id,
    imageUri,
    metadataUri,
    storageMethod: "arweave",
    txBase64,
    assetAddress,
    requiresWalletSignature: !!txBase64,
  });
}

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
    collection.tokens[0].mintTxUrl = `https://explorer.solana.com/tx/${txSignature}${
      process.env.SOLANA_RPC_URL?.includes("devnet") ? "?cluster=devnet" : ""
    }`;
  }
  collection.updatedAt = new Date().toISOString();

  await saveCollection(collection);
  return NextResponse.json({ ok: true, collection });
}
