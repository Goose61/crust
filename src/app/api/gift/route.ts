import { NextRequest, NextResponse } from "next/server";
import path from "path";
import { newId, saveCollection, slugify } from "@/lib/store";
import { uploadBlob, uploadBlobText } from "@/lib/blob-storage";
import { blobImagePath, blobMetadataPath } from "@/lib/paths";
import { rateLimit } from "@/lib/rate-limit";
import { defaultPayments, type Collection, type GeneratedToken } from "@/lib/types";

export const runtime = "nodejs";

const MAX_GIFT_BYTES = 50 * 1024 * 1024; // 50 MB

function isAllowedImageMagic(buf: Buffer): boolean {
  if (buf.length < 4) return false;
  if (buf[0] === 0x89 && buf[1] === 0x50 && buf[2] === 0x4e && buf[3] === 0x47) return true;
  if (buf[0] === 0xff && buf[1] === 0xd8 && buf[2] === 0xff) return true;
  if (buf[0] === 0x52 && buf[1] === 0x49 && buf[2] === 0x46 && buf[3] === 0x46) return true;
  return false;
}

export async function POST(req: NextRequest) {
  const ip = req.headers.get("x-forwarded-for")?.split(",")[0] ?? "unknown";
  const rl = await rateLimit(`gift:${ip}`, 20, 60 * 60 * 1000);
  if (!rl.allowed) {
    return NextResponse.json({ error: "Too many requests" }, { status: 429 });
  }

  const form = await req.formData();
  const file = form.get("file");
  if (!(file instanceof File)) {
    return NextResponse.json({ error: "An image is required" }, { status: 400 });
  }
  if (file.size > MAX_GIFT_BYTES) {
    return NextResponse.json({ error: "Image too large (max 50 MB)" }, { status: 413 });
  }

  const buf = Buffer.from(await file.arrayBuffer());
  if (!isAllowedImageMagic(buf)) {
    return NextResponse.json({ error: "Use a PNG, JPG, or WebP image" }, { status: 400 });
  }

  const name = String(form.get("name") || "Gift NFT").trim() || "Gift NFT";
  const recipient = String(form.get("recipient") || "").trim();
  const payer = String(form.get("payer") || "").trim();
  const note = String(form.get("note") || "").trim();
  if (!recipient) {
    return NextResponse.json({ error: "Recipient wallet is required" }, { status: 400 });
  }

  const id = newId();
  const ext = (path.extname(file.name) || ".png").toLowerCase();
  const safeExt = ext === ".jpg" ? ".jpeg" : ext;
  const contentType = safeExt === ".png" ? "image/png" : "image/jpeg";

  const imageUri = await uploadBlob(blobImagePath(id, 1), buf, contentType);

  const metaJson = JSON.stringify(
    {
      name: `${name} #1`,
      description: note || `A gifted 1/1 NFT.`,
      image: imageUri,
      attributes: note ? [{ trait_type: "Note", value: note }] : [],
    },
    null,
    2,
  );
  const metadataUri = await uploadBlobText(blobMetadataPath(id, 1), metaJson);

  const token: GeneratedToken = {
    tokenId: 1,
    dna: "gift",
    attributes: note ? [{ trait_type: "Note", value: note }] : [],
    imageRelPath: `images/1${safeExt}`,
    metadataRelPath: "metadata/1.json",
    imageUri,
    metadataUri,
    owner: recipient,
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
    irysPublished: false,
    createdAt: new Date().toISOString(),
    updatedAt: new Date().toISOString(),
    tokens: [token],
  };

  await saveCollection(collection);
  return NextResponse.json({ collection, recipient });
}
