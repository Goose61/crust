/**
 * Token Metadata collection mint for verified gift NFT grouping in Phantom.
 *
 * Distinct from legacy Metaplex Core collections (`core-collection.ts`).
 * When set, gift mints call createV1 with an unverified collection reference
 * and verifyCollectionV1 in the same transaction.
 *
 * @see https://www.metaplex.com/docs/smart-contracts/token-metadata/collections
 */

import { getSolanaNetwork, type SolanaNetwork } from "./solana-config";

/** On-chain Token Metadata Collection NFT mint (parent collection). */
export function getGiftCollectionMint(network?: SolanaNetwork): string | null {
  const net = network ?? getSolanaNetwork();
  const specific = process.env[`GIFT_TM_COLLECTION_MINT_${net.toUpperCase()}`]?.trim();
  if (specific) return specific;
  return process.env.GIFT_TM_COLLECTION_MINT?.trim() || null;
}

export function getGiftCollectionName(): string {
  const fromEnv =
    process.env.GIFT_COLLECTION_NAME?.trim() ||
    process.env.CORE_COLLECTION_NAME?.trim();
  if (fromEnv) {
    // Normalize legacy env values that trigger Phantom spam heuristics.
    return fromEnv.replace(/\s+gifts?$/i, "").trim() || "Dough Boi";
  }
  return "Dough Boi";
}
