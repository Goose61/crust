/**
 * POST /api/gift
 *
 * Accepts an image + gift details, uploads image and metadata to Arweave via
 * Irys (platform pays storage), builds a Metaplex Core `create` transaction
 * partially signed by the asset keypair, and returns the base64 transaction
 * for the minter's browser wallet to sign and submit.
 *
 * The minter pays all Solana chain fees (~0.0044 SOL) when they approve
 * the transaction in Phantom. The recipient pays nothing.
 */

import { NextRequest, NextResponse } from "next/server";
import path from "path";
import { newId, saveCollection, slugify } from "@/lib/store";
import { uploadBlob, uploadBlobText } from "@/lib/blob-storage";
import { uploadToIrys } from "@/lib/irys";
import { blobImagePath, blobMetadataPath } from "@/lib/paths";
import { rateLimit } from "@/lib/rate-limit";
import { defaultPayments, type Collection, type GeneratedToken } from "@/lib/types";
import { buildGiftTransaction, isValidSolanaAddress } from "@/lib/mint-nft";

export const runtime = "nodejs";

const MAX_GIFT_BYTES = 50 * 1024 * 1024; // 50 MB

const MIME_MAP: Record<string, string> = {
  ".png": "image/png",
  ".jpeg": "image/jpeg",
  ".jpg": "image/jpeg",
  ".webp": "image/webp",
};

function imageMagic(buf: Buffer): { ok: boolean; ext: string } {
  if (buf.length < 12) return { ok: false, ext: "" };
  if (buf[0] === 0x89 && buf[1] === 0x50 && buf[2] === 0x4e && buf[3] === 0x47)
    return { ok: true, ext: ".png" };
  if (buf[0] === 0xff && buf[1] === 0xd8 && buf[2] === 0xff)
    return { ok: true, ext: ".jpeg" };
  // WebP: RIFF....WEBP
  if (
    buf[0] === 0x52 && buf[1] === 0x49 && buf[2] === 0x46 && buf[3] === 0x46 &&
    buf[8] === 0x57 && buf[9] === 0x45 && buf[10] === 0x42 && buf[11] === 0x50
  )
    return { ok: true, ext: ".webp" };
  return { ok: false, ext: "" };
}

export async function POST(req: NextRequest) {
  // Rate-limit: 20 gifts per IP per hour
  const ip = req.headers.get("x-forwarded-for")?.split(",")[0] ?? "unknown";
  const rl = await rateLimit(`gift:${ip}`, 20, 60 * 60 * 1000);
  if (!rl.allowed)
    return NextResponse.json({ error: "Too many requests" }, { status: 429 });

  const form = await req.formData();
  const file = form.get("file");
  if (!(file instanceof File))
    return NextResponse.json({ error: "An image is required" }, { status: 400 });
  if (file.size > MAX_GIFT_BYTES)
    return NextResponse.json({ error: "Image too large (max 50 MB)" }, { status: 413 });

  const buf = Buffer.from(await file.arrayBuffer());
  const magic = imageMagic(buf);
  if (!magic.ok)
    return NextResponse.json({ error: "Use a PNG, JPEG, or WebP image" }, { status: 400 });

  const name = String(form.get("name") || "Gift NFT").trim() || "Gift NFT";
  if (name.length > 32)
    return NextResponse.json({ error: "Name must be 32 characters or fewer" }, { status: 400 });

  const recipient = String(form.get("recipient") || "").trim();
  if (!recipient)
    return NextResponse.json({ error: "Recipient wallet is required" }, { status: 400 });
  if (!isValidSolanaAddress(recipient))
    return NextResponse.json({ error: "Recipient is not a valid Solana address" }, { status: 400 });

  const payer = String(form.get("payer") || "").trim();
  if (!payer || !isValidSolanaAddress(payer))
    return NextResponse.json({ error: "Connect your wallet before sending" }, { status: 400 });

  const note = String(form.get("note") || "").slice(0, 200);

  // ── 1. Upload image (Irys if key configured, Blob fallback) ──────────────
  const id = newId();
  const safeExt = magic.ext;
  const contentType = MIME_MAP[safeExt] ?? "image/png";

  let imageUri: string;
  let storageMethod: "arweave" | "blob" | "staging";

  const arweaveImage = await uploadToIrys(buf, contentType);
  if (arweaveImage) {
    imageUri = arweaveImage;
    storageMethod = "arweave";
  } else {
    imageUri = await uploadBlob(blobImagePath(id, 1), buf, contentType);
    storageMethod = process.env.BLOB_READ_WRITE_TOKEN ? "blob" : "staging";
  }

  // ── 2. Build and upload metadata ────────────────────────────────────────
  const nftName = `${name} #1`;
  const metaJson = JSON.stringify(
    {
      name: nftName,
      description: note || `A 1/1 gift NFT.`,
      image: imageUri,
      attributes: [
        ...(note ? [{ trait_type: "Note", value: note }] : []),
        { trait_type: "Type", value: "Gift" },
        { trait_type: "Edition", value: "1/1" },
      ],
      properties: {
        files: [{ uri: imageUri, type: contentType }],
        category: "image",
        creators: [{ address: payer, share: 100 }],
      },
    },
    null,
    2,
  );

  let metadataUri: string;
  const arweaveMetadata = await uploadToIrys(
    Buffer.from(metaJson, "utf8"),
    "application/json",
  );
  if (arweaveMetadata) {
    metadataUri = arweaveMetadata;
  } else {
    metadataUri = await uploadBlobText(blobMetadataPath(id, 1), metaJson);
  }

  // ── 3. Build Metaplex Core tx (platform authority, user is fee payer) ────
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

  // ── 4. Persist collection record ────────────────────────────────────────
  // The mint is NOT confirmed yet — the user still needs to sign.
  // We record the collection optimistically; it can be cleaned up if the
  // user never signs.
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
    // Mark as "draft" until the user confirms the on-chain tx
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
    irysPublished: storageMethod === "arweave",
    createdAt: new Date().toISOString(),
    updatedAt: new Date().toISOString(),
    tokens: [token],
  };

  await saveCollection(collection);

  return NextResponse.json({
    collectionId: id,
    imageUri,
    metadataUri,
    storageMethod,
    // If txBase64 is null, on-chain minting is not configured (demo mode)
    txBase64,
    assetAddress,
    requiresWalletSignature: !!txBase64,
  });
}

/**
 * PATCH /api/gift  — called by the client after the wallet signs and the
 * transaction is confirmed on-chain.
 *
 * Updates the collection status from "draft" → "sold_out" and stores the
 * on-chain transaction signature for display.
 */
export async function PATCH(req: NextRequest) {
  const body = await req.json() as {
    collectionId?: string;
    txSignature?: string;
  };

  const { collectionId, txSignature } = body;
  if (!collectionId || !txSignature)
    return NextResponse.json({ error: "collectionId and txSignature required" }, { status: 400 });

  const { getCollection, saveCollection: save } = await import("@/lib/store");
  const collection = await getCollection(collectionId);
  if (!collection)
    return NextResponse.json({ error: "Collection not found" }, { status: 404 });

  // Mark confirmed
  collection.status = "sold_out";
  collection.mintedCount = 1;
  if (collection.tokens[0]) {
    collection.tokens[0].mintTxUrl = `https://explorer.solana.com/tx/${txSignature}${
      process.env.SOLANA_RPC_URL?.includes("devnet") ? "?cluster=devnet" : ""
    }`;
  }
  collection.updatedAt = new Date().toISOString();

  await save(collection);
  return NextResponse.json({ ok: true, collection });
}
