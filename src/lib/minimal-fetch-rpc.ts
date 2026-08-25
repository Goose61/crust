/**
 * Minimal fetch-based Umi RPC stub for Vercel serverless.
 *
 * Full umi-bundle-defaults pulls rpc-websockets → uuid (ESM-only) and crashes
 * with ERR_REQUIRE_ESM. Token Metadata tx building still needs getCluster() on
 * context.rpc for program resolution (e.g. findAssociatedTokenPda).
 */

import {
  lamports,
  publicKey as umiPublicKey,
  type Cluster,
  type MaybeRpcAccount,
  type PublicKey,
  type RpcInterface,
  type Umi,
} from "@metaplex-foundation/umi";
import type { SolanaNetwork } from "./solana-config";

function umiCluster(network: SolanaNetwork): Cluster {
  return network === "mainnet" ? "mainnet-beta" : "devnet";
}

function createMinimalFetchRpc(
  rpcUrl: string,
  network: SolanaNetwork,
): Pick<RpcInterface, "getEndpoint" | "getCluster" | "getAccount" | "getAccounts"> {
  async function rpcCall<T>(method: string, params: unknown[]): Promise<T> {
    const res = await fetch(rpcUrl, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ jsonrpc: "2.0", id: 1, method, params }),
      signal: AbortSignal.timeout(15_000),
    });
    if (!res.ok) throw new Error(`RPC HTTP ${res.status} (${method})`);
    const text = await res.text();
    if (!text.trim()) throw new Error(`RPC empty body (${method})`);
    const json = JSON.parse(text) as { result?: T; error?: { message: string } };
    if (json.error) throw new Error(json.error.message);
    return json.result as T;
  }

  const cluster = umiCluster(network);

  return {
    getEndpoint: () => rpcUrl,
    getCluster: () => cluster,
    async getAccount(pubkey: PublicKey, options): Promise<MaybeRpcAccount> {
      type AccountInfo = {
        lamports: number;
        owner: string;
        executable: boolean;
        rentEpoch?: number;
        data: [string, string];
      };
      const result = await rpcCall<{ value: AccountInfo | null }>("getAccountInfo", [
        pubkey.toString(),
        { encoding: "base64", commitment: options?.commitment ?? "confirmed" },
      ]);
      const value = result?.value;
      if (!value) {
        return { exists: false, publicKey: pubkey };
      }
      return {
        exists: true,
        publicKey: pubkey,
        lamports: lamports(value.lamports ?? 0),
        owner: umiPublicKey(value.owner),
        executable: value.executable ?? false,
        ...(value.rentEpoch != null ? { rentEpoch: BigInt(value.rentEpoch) } : {}),
        data: Buffer.from(value.data[0], "base64"),
      };
    },
    async getAccounts(pubkeys: PublicKey[], options): Promise<MaybeRpcAccount[]> {
      return Promise.all(pubkeys.map((pk) => this.getAccount(pk, options)));
    },
  };
}

/** Attach minimal RPC so mpl-token-metadata can resolve program IDs / PDAs. */
export function attachMinimalFetchRpc(
  umi: Umi,
  rpcUrl: string,
  network: SolanaNetwork,
): void {
  umi.rpc = createMinimalFetchRpc(rpcUrl, network) as RpcInterface;
}
