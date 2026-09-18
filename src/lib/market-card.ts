import type { ChainKey, Collection, CollectionKind } from "./types";
import { coverImageSrc } from "./collection-ui";
import { collectionMarketStats, type CollectionMarketStats } from "./collection-stats";
import { isStandaloneGiftRecord } from "./gift-bundle";

/** Collection fields the Market grid needs — never the full token array. */
export type MarketCard = {
  id: string;
  slug: string;
  name: string;
  description: string;
  chain: ChainKey;
  kind?: CollectionKind;
  mintedCount: number;
  supply: number;
  coverSrc: string;
  stats: CollectionMarketStats;
  hasListings: boolean;
  featuredUntil?: string | null;
};

export function toMarketCard(collection: Collection): MarketCard {
  const tokens = collection.tokens ?? [];
  return {
    id: collection.id,
    slug: collection.slug,
    name: collection.name,
    description: collection.description,
    chain: collection.chain,
    kind: collection.kind,
    mintedCount: collection.mintedCount,
    supply: collection.supply,
    coverSrc: coverImageSrc(collection),
    stats: collectionMarketStats(collection),
    hasListings:
      Boolean(collection.secondaryEnabled) && tokens.some((t) => Boolean(t.listing)),
    featuredUntil: collection.featuredUntil ?? null,
  };
}

export function isMarketLiveCard(collection: Collection): boolean {
  if (collection.status !== "live" && collection.status !== "sold_out") return false;
  if (isStandaloneGiftRecord(collection)) return false;
  return true;
}

export function partitionMarketCards(collections: Collection[]): {
  live: MarketCard[];
  secondary: MarketCard[];
  giftBundle?: MarketCard;
} {
  const live: MarketCard[] = [];
  for (const collection of collections) {
    try {
      if (!isMarketLiveCard(collection)) continue;
      live.push(toMarketCard(collection));
    } catch (err) {
      console.error("[market-card] skipped collection", collection.id, err);
    }
  }
  const secondary = live.filter((card) => card.hasListings);
  const now = Date.now();
  live.sort((a, b) => {
    const aFeat = a.featuredUntil && new Date(a.featuredUntil).getTime() > now ? 1 : 0;
    const bFeat = b.featuredUntil && new Date(b.featuredUntil).getTime() > now ? 1 : 0;
    return bFeat - aFeat;
  });
  const giftBundle = live.find((card) => card.kind === "gift_bundle");
  return { live, secondary, giftBundle };
}
