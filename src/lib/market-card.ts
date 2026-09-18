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
};

export function toMarketCard(collection: Collection): MarketCard {
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
      Boolean(collection.secondaryEnabled) &&
      collection.tokens.some((t) => Boolean(t.listing)),
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
  const live = collections.filter(isMarketLiveCard).map(toMarketCard);
  const secondary = live.filter((card) => card.hasListings);
  const giftBundle = live.find((card) => card.kind === "gift_bundle");
  return { live, secondary, giftBundle };
}
