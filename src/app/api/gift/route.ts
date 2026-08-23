import { NextRequest, NextResponse } from "next/server";
import path from "path";
import { newId, saveCollection, slugify } from "@/lib/store";
import { uploadBlob, uploadBlobText } from "@/lib/blob-storage";
import { blobImagePath, blobMetadataPath } from "@/lib/paths";
import { rateLimit } from "@/lib/rate-limit";
import { defaultPayments, type Collection, type GeneratedToken } from "@/lib/types";
import { mintGiftNft, isValidSolanaAddress } from "@/lib/mint-nft";

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
  // PNG
  if (buf[0] === 0x89 && buf[1] === 0x50 && buf[2] === 0x4e && buf[3] === 0x47)
    return { ok: true, ext: ".png" };
  // JPEG
  if (buf[0] === 0xff && buf[1] === 0xd8 && buf[2] === 0xff)
    return { ok: true, ext: ".jpeg" };
  // WebP — RIFF....WEBP
  if (
    buf[0] === 0x52 && buf[1] === 0x49 && buf[2] === 0x46 && buf[3] === 0x46 &&
    buf[8] === 0x57 && buf[9] === 0x45 && buf[10] === 0x42 && buf[11] === 0x50
  )
    return { ok: true, ext: ".webp" };
  return { ok: false, ext: "" };
}

export async function POST(req: NextRequest) {
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

  const recipient = String(form.get("recipient") || "").trim();
  if (!recipient)
    return NextResponse.json({ error: "Recipient wallet is required" }, { status: 400 });
  if (!isValidSolanaAddress(recipient))
    return NextResponse.json({ error: "Recipient is not a valid Solana address" }, { status: 400 });

  const payer = String(form.get("payer") || "").trim();
  const note = String(form.get("note") || "").trim();

  // ── Storage ──────────────────────────────────────────────────────────────
  const id = newId();
  // Use the magic-detected extension, not the filename (prevents ext spoofing)
  const safeExt = magic.ext;
  const contentType = MIME_MAP[safeExt] ?? "image/png";

  const imageUri = await uploadBlob(blobImagePath(id, 1), buf, contentType);

  const nftName = `${name} #1`;
  const metaJson = JSON.stringify(
    {
      name: nftName,
      description: note || `A gifted 1/1 NFT.`,
      image: imageUri,
      attributes: [
        ...(note ? [{ trait_type: "Note", value: note }] : []),
        { trait_type: "Type", value: "Gift" },
        { trait_type: "Edition", value: "1/1" },
      ],
      properties: {
        files: [{ uri: imageUri, type: contentType }],
        category: "image",
      },
    },
    null,
    2,
  );
  const metadataUri = await uploadBlobText(blobMetadataPath(id, 1), metaJson);

  // ── On-chain mint (if platform key is configured) ──────────────────────
  let mintResult: Awaited<ReturnType<typeof mintGiftNft>> = null;
  let mintError: string | null = null;
  try {
    mintResult = await mintGiftNft({ name: nftName, metadataUri, recipient });
  } catch (err) {
    console.error("[gift] on-chain mint failed:", err);
    mintError = err instanceof Error ? err.message : String(err);
  }

  // ── Persist collection record ──────────────────────────────────────────
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
    ...(mintResult ? {
      assetAddress: mintResult.assetAddress,
      mintTxUrl: mintResult.explorerUrl,
    } : {}),
  };

  const collection: Collection = {
    id,
    slug: slugify(name),
    name,
    symbol: name.slice(0, 6).toUpperCase().replace(/\s/g, ""),
    description: note || `1/1 gift from ${payer || "a creator"} to ${recipient}.`,
    nameTemplate: "{name} #{id}",
    chain: "solana",
    status: "sold_out",
    supply: 1,
    mintedCount: 1,
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
    irysPublished: !!mintResult,
    createdAt: new Date().toISOString(),
    updatedAt: new Date().toISOString(),
    tokens: [token],
  };

  await saveCollection(collection);

  return NextResponse.json({
    collection,
    recipient,
    onChain: !!mintResult,
    ...(mintResult ? {
      assetAddress: mintResult.assetAddress,
      explorerUrl: mintResult.explorerUrl,
      network: mintResult.network,
    } : {}),
    ...(mintError ? { mintWarning: `On-chain mint skipped: ${mintError}` } : {}),
  });
}
