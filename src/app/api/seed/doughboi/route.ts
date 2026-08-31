/**
 * POST /api/seed/doughboi
 * Seeds a 25-item devnet test collection from the local 600 NFT assets.
 * Only available when NODE_ENV !== "production".
 */
import { NextResponse } from "next/server";
import { mkdir, copyFile, writeFile } from "fs/promises";
import path from "path";
import { newId, saveCollection, slugify } from "@/lib/store";
import { collectionImagesDir, collectionMetadataDir } from "@/lib/paths";
import { defaultPayments, type Collection, type GeneratedToken } from "@/lib/types";
import { assignRarityRanks } from "@/lib/compositor";

export const runtime = "nodejs";

const SRC_IMAGES = "/var/home/Goose61/Desktop/NFT/600 nfts/images";
const SRC_META   = "/var/home/Goose61/Desktop/NFT/600 nfts/metadata";
const SAMPLE_IDS = [4, 17, 33, 56, 72, 91, 108, 130, 145, 162,
                    178, 203, 219, 234, 251, 267, 289, 305, 322, 337,
                    354, 378, 401, 423, 447];

export async function POST() {
  if (process.env.NODE_ENV === "production") {
    return NextResponse.json({ error: "Seed disabled in production" }, { status: 403 });
  }

  const id = newId();
  const imagesDir = collectionImagesDir(id);
  const metaDir   = collectionMetadataDir(id);
  await mkdir(imagesDir, { recursive: true });
  await mkdir(metaDir,   { recursive: true });

  const tokens: GeneratedToken[] = [];

  for (let idx = 0; idx < SAMPLE_IDS.length; idx++) {
    const srcId  = SAMPLE_IDS[idx];
    const tokenId = idx + 1;

    // copy image
    const srcImg  = path.join(SRC_IMAGES, `${srcId}.jpeg`);
    const destImg = path.join(imagesDir, `${tokenId}.jpeg`);
    await copyFile(srcImg, destImg);

    // read source metadata
    let attributes: GeneratedToken["attributes"] = [];
    try {
      const raw = await import("fs/promises").then((fs) => fs.readFile(path.join(SRC_META, `${srcId}.json`), "utf8"));
      const meta = JSON.parse(raw);
      attributes = (meta.attributes ?? []).filter(
        (a: { trait_type?: string; value?: unknown }) =>
          a.trait_type && a.trait_type !== "Rarity Rank",
      );
    } catch {
      /* skip missing meta */
    }

    tokens.push({
      tokenId,
      dna: attributes.map((a) => String(a.value)).join("|"),
      attributes,
      imageRelPath: `images/${tokenId}.jpeg`,
      metadataRelPath: `metadata/${tokenId}.json`,
    });
  }

  const ranked = assignRarityRanks(tokens);
  const name = "Dough Boi Devnet Test";

  for (const token of ranked) {
    await writeFile(
      path.join(metaDir, `${token.tokenId}.json`),
      JSON.stringify(
        {
          name: `${name} #${token.tokenId}`,
          description: "25-piece devnet test collection from the Dough Boi universe.",
          image: token.imageRelPath,
          attributes: token.attributes,
        },
        null,
        2,
      ),
    );
  }

  const collection: Collection = {
    id,
    slug: slugify(name),
    name,
    symbol: "DOUGH",
    description: "25-piece devnet test collection. Proof that the launch, mint, and market stack works end-to-end.",
    nameTemplate: "Dough Boi #{id}",
    chain: "solana",
    status: "live",
    supply: 25,
    mintedCount: 0,
    artPath: "path-a",
    stackOrder: [],
    layers: [],
    blindMint: false,
    revealTrigger: "manual",
    revealed: true,
    milestones: [
      { at: 50, events: ["unlock_holder_page", "enable_gift_mint"] },
      { at: 100, events: ["enable_secondary", "snapshot_holders"] },
    ],
    payments: defaultPayments({ basePriceUsd: 0.1, giftMintEnabled: true }),
    fees: { ownerPercent: 98, holdersPercent: 1, buybackPercent: 1, locked: true },
    allowlist: [],
    waitlist: [],
    publicMintOpen: true,
    secondaryEnabled: false,
    holderPageUnlocked: false,
    irysPublished: false,
    socials: {
      twitter: "https://x.com/",
      website: "https://thecrust.io",
      telegram: "https://t.me/",
    },
    createdAt: new Date().toISOString(),
    updatedAt: new Date().toISOString(),
    tokens: ranked,
  };

  await saveCollection(collection);
  return NextResponse.json({ collection, count: ranked.length });
}
