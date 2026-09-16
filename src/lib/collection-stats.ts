import type { Collection } from "./types";
import { isTokenSold, nftPrice } from "./collection-ui";

export function mintedPercent(collection: Collection) {
  if (!collection.supply) return 0;
  return Math.floor((collection.mintedCount / collection.supply) * 100);
}

export function batchSize(supply: number) {
  return Math.max(1, Math.ceil(supply / 10));
}

export type CollectionMarketStats = {
  volumeUsd: number;
  floorUsd: number;
  marketCapUsd: number;
  listedCount: number;
  available: number;
  sold: number;
};

export function collectionVolumeUsd(collection: Collection): number {
  return (collection.feeLedger?.entries ?? []).reduce(
    (sum, entry) => sum + (entry.saleUsd || 0),
    0,
  );
}

export function collectionFloorUsd(collection: Collection): number {
  const listed = collection.tokens
    .filter((t) => t.listing && t.listing.priceUsd > 0)
    .map((t) => t.listing!.priceUsd);
  if (listed.length > 0) return Math.min(...listed);

  const unsoldPrices = collection.tokens
    .filter((t) => !isTokenSold(t, collection))
    .map((t) => nftPrice(collection, t));
  if (unsoldPrices.length > 0) return Math.min(...unsoldPrices);

  return Math.max(0, collection.payments.basePriceUsd);
}

export function collectionListedCount(collection: Collection): number {
  return collection.tokens.filter((t) => Boolean(t.listing)).length;
}

export function collectionSoldCount(collection: Collection): number {
  return collection.tokens.filter((t) => isTokenSold(t, collection)).length;
}

export function collectionMarketStats(collection: Collection): CollectionMarketStats {
  const sold = collectionSoldCount(collection);
  const floorUsd = collectionFloorUsd(collection);
  return {
    volumeUsd: collectionVolumeUsd(collection),
    floorUsd,
    marketCapUsd: floorUsd * collection.supply,
    listedCount: collectionListedCount(collection),
    sold,
    available: Math.max(0, collection.supply - sold),
  };
}
