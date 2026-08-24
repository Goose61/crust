/**
 * Metaplex Core Collection helpers for verified gift mints.
 *
 * Gifts minted into an on-chain Core Collection are grouped under one brand in
 * wallets/explorers (Phantom Certified Collections pattern for Token Metadata;
 * Core uses native collection membership at create time).
 *
 * @see https://www.metaplex.com/docs/smart-contracts/core/collections
 * @see https://www.metaplex.com/docs/smart-contracts/core/create-asset
 * @see https://docs.phantom.com/best-practices/tokens/collectibles-nfts-and-semi-fungibles
 * @see https://www.metaplex.com/docs/smart-contracts/core/plugins/update-delegate
 */

import {
  lamports,
  publicKey as umiPublicKey,
  type Context,
  type MaybeRpcAccount,
  type PublicKey,
  type RpcInterface,
  type Umi,
} from "@metaplex-foundation/umi";
import { fetchCollection, type CollectionV1 } from "@metaplex-foundation/mpl-core";
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
 * Minimal fetch-based RPC for `fetchCollection` only (avoids umi-bundle-defaults ESM issues on Vercel).
 * @see https://www.metaplex.com/docs/smart-contracts/core/fetch
 */
export function attachMinimalFetchRpc(umi: Umi, rpcUrl: string): void {
  const stub = createMinimalFetchRpc(rpcUrl);
  umi.rpc = stub as RpcInterface;
}

function createMinimalFetchRpc(
  rpcUrl: string,
): Pick<RpcInterface, "getEndpoint" | "getCluster" | "getAccount" | "getAccounts"> {
  async function rpcCall<T>(method: string, params: unknown[]): Promise<T> {
    const res = await fetch(rpcUrl, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ jsonrpc: "2.0", id: 1, method, params }),
      signal: AbortSignal.timeout(15_000),
    });
    if (!res.ok) throw new Error(`RPC HTTP ${res.status} (${method})`);
    const json = (await res.json()) as { result?: T; error?: { message: string } };
    if (json.error) throw new Error(json.error.message);
    return json.result as T;
  }

  return {
    getEndpoint: () => rpcUrl,
    getCluster: () => "devnet",
    async getAccount(pubkey: PublicKey, options): Promise<MaybeRpcAccount> {
      type AccountInfo = {
        lamports: number;
        owner: string;
        executable: boolean;
        rentEpoch: number;
        data: [string, string];
      } | null;
      const value = await rpcCall<AccountInfo>("getAccountInfo", [
        pubkey.toString(),
        { encoding: "base64", commitment: options?.commitment ?? "confirmed" },
      ]);
      if (!value) {
        return { exists: false, publicKey: pubkey };
      }
      return {
        exists: true,
        publicKey: pubkey,
        lamports: lamports(value.lamports),
        owner: umiPublicKey(value.owner),
        executable: value.executable,
        rentEpoch: BigInt(value.rentEpoch),
        data: Buffer.from(value.data[0], "base64"),
      };
    },
    async getAccounts(pubkeys: PublicKey[], options): Promise<MaybeRpcAccount[]> {
      return Promise.all(pubkeys.map((pk) => this.getAccount(pk, options)));
    },
  };
}

/** Fetch and cache a Core Collection account for mint-into-collection txs. */
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
  attachMinimalFetchRpc(umi as Umi, rpcUrl);
  const collection = await fetchCollection(umi, address);
  collectionCache.set(key, collection);
  return collection;
}

export function clearCoreCollectionCache(): void {
  collectionCache.clear();
}
