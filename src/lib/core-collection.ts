/**
 * Metaplex Core Collection helpers for gift mints.
 *
 * @see https://www.metaplex.com/docs/smart-contracts/core/collections
 */

import {
  type Context,
  type Umi,
} from "@metaplex-foundation/umi";
import { fetchCollection, type CollectionV1 } from "@metaplex-foundation/mpl-core";
import { attachMinimalFetchRpc } from "./minimal-fetch-rpc";
import { getDirectRpcUrl, getSolanaNetwork, type SolanaNetwork } from "./solana-config";

const collectionCache = new Map<string, CollectionV1>();

/** Env: on-chain Core Collection address for gift mints (set after one-time setup). */
export function getCoreCollectionAddress(network?: SolanaNetwork): string | null {
  const net = network ?? getSolanaNetwork();
  const specific = process.env[`CORE_COLLECTION_ADDRESS_${net.toUpperCase()}`]?.trim();
  if (specific) return specific;
  return process.env.CORE_COLLECTION_ADDRESS?.trim() || null;
}

function cacheKey(network: SolanaNetwork, address: string): string {
  return `${network}:${address}`;
}

/**
 * Fetch and cache a Core Collection account for mint-into-collection txs.
 */
export async function fetchCoreCollection(
  umi: Context,
  address: string,
  network?: SolanaNetwork,
): Promise<CollectionV1> {
  const net = network ?? getSolanaNetwork();
  const key = cacheKey(net, address);
  const cached = collectionCache.get(key);
  if (cached) return cached;

  const rpcUrl = getDirectRpcUrl(net);
  attachMinimalFetchRpc(umi as Umi, rpcUrl, net);
  let collection: CollectionV1;
  try {
    collection = await fetchCollection(umi, address);
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    throw new Error(
      `Could not load Core Collection ${address} on ${net}: ${msg}. ` +
        "Check CORE_COLLECTION_ADDRESS matches the cluster you are minting on.",
    );
  }
  collectionCache.set(key, collection);
  return collection;
}

export function clearCoreCollectionCache(): void {
  collectionCache.clear();
}
