import { getCollection, saveCollection } from "./store";
import { defaultPayments, type Collection } from "./types";
import {
  GIFT_BUNDLE_SLUG,
  getGiftBundleId,
  syncGiftBundleCounts,
} from "./gift-bundle";
import {
  GIFT_COLLECTION_DISPLAY_NAME,
  GIFT_DESCRIPTION,
  GIFT_SYMBOL,
} from "./gift-metadata";

/** Server-only: fetch or create the parent gift bundle collection in MongoDB. */
export async function getOrCreateGiftBundle(): Promise<Collection> {
  const id = getGiftBundleId();
  const existing = await getCollection(id);
  if (existing) return existing;

  const now = new Date().toISOString();
  const bundle: Collection = {
    id,
    slug: GIFT_BUNDLE_SLUG,
    name: GIFT_COLLECTION_DISPLAY_NAME,
    symbol: GIFT_SYMBOL,
    description: GIFT_DESCRIPTION,
    nameTemplate: "{name}",
    chain: "solana",
    kind: "gift_bundle",
    status: "live",
    supply: 0,
    mintedCount: 0,
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
    irysPublished: true,
    createdAt: now,
    updatedAt: now,
    tokens: [],
  };

  syncGiftBundleCounts(bundle);
  await saveCollection(bundle);
  return bundle;
}
