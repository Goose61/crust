import type { Collection } from "./types";
import { batchSize, mintedPercent } from "./collection-stats";

/** Reveal the next batch (~10% of supply) for milestone reveal_batch. */
export function applyRevealBatch(collection: Collection): Collection {
  const batch = batchSize(collection.supply);
  const batchIndex = collection.revealedBatchIndex ?? 0;
  const startId = batchIndex * batch + 1;
  const endId = Math.min(collection.supply, startId + batch - 1);
  const revealedIds = new Set(collection.revealedTokenIds ?? []);

  for (let id = startId; id <= endId; id++) {
    revealedIds.add(id);
  }

  return {
    ...collection,
    revealedBatchIndex: batchIndex + 1,
    revealedTokenIds: Array.from(revealedIds).sort((a, b) => a - b),
    revealed: revealedIds.size >= collection.supply,
  };
}

/** Apply automatic reveal triggers (percent, datetime, sold-out, staggered). */
export function applyRevealTriggers(collection: Collection): Collection {
  const next = { ...collection, tokens: collection.tokens.map((t) => ({ ...t })) };
  const pct = mintedPercent(next);
  const revealedIds = new Set(next.revealedTokenIds ?? []);

  if (next.revealTrigger === "at_percent" && pct >= (next.revealAtPercent ?? 50)) {
    next.revealed = true;
    for (let id = 1; id <= next.supply; id++) revealedIds.add(id);
  }

  if (next.revealTrigger === "at_sold_out" && next.mintedCount >= next.supply) {
    next.revealed = true;
    for (let id = 1; id <= next.supply; id++) revealedIds.add(id);
  }

  if (next.revealTrigger === "at_datetime" && next.revealAt) {
    const at = new Date(next.revealAt).getTime();
    if (Number.isFinite(at) && Date.now() >= at) {
      next.revealed = true;
      for (let id = 1; id <= next.supply; id++) revealedIds.add(id);
    }
  }

  if (next.revealTrigger === "staggered" && next.mintedCount > 0) {
    const batch = batchSize(next.supply);
    const revealCount = Math.min(next.supply, Math.ceil(next.mintedCount / batch) * batch);
    for (let id = 1; id <= revealCount; id++) {
      revealedIds.add(id);
    }
    if (next.mintedCount >= next.supply) next.revealed = true;
  }

  next.revealedTokenIds = Array.from(revealedIds).sort((a, b) => a - b);
  return next;
}

/** Whether a token's art/metadata should be visible (not blind placeholder). */
export function isTokenRevealed(collection: Collection, tokenId: number): boolean {
  if (!collection.blindMint) return true;
  if (collection.revealed) return true;
  return (collection.revealedTokenIds ?? []).includes(tokenId);
}

export function placeholderImageSrc(collection: Collection): string {
  return collection.placeholderUri ?? `/api/assets/${collection.id}/placeholder`;
}
