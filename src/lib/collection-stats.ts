import type { Collection } from "./types";

export function mintedPercent(collection: Collection) {
  if (!collection.supply) return 0;
  return Math.floor((collection.mintedCount / collection.supply) * 100);
}

export function batchSize(supply: number) {
  return Math.max(1, Math.ceil(supply / 10));
}
