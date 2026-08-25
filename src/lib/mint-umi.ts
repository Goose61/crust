/**
 * Minimal Umi setup for server-side mint tx building.
 *
 * Avoids @metaplex-foundation/umi-bundle-defaults and umi-rpc-web3js, which
 * pull in @solana/web3.js Connection → rpc-websockets → uuid (ESM-only) and
 * crash Vercel serverless with ERR_REQUIRE_ESM.
 *
 * Blockhash is fetched via plain HTTP; Token Metadata needs a stub RPC for
 * getCluster() during PDA / program resolution.
 */

import { createBaseUmi, type Umi } from "@metaplex-foundation/umi";
import { dataViewSerializer } from "@metaplex-foundation/umi-serializer-data-view";
import { defaultProgramRepository } from "@metaplex-foundation/umi-program-repository";
import { web3JsEddsa } from "@metaplex-foundation/umi-eddsa-web3js";
import { web3JsTransactionFactory } from "@metaplex-foundation/umi-transaction-factory-web3js";
import { mplTokenMetadata } from "@metaplex-foundation/mpl-token-metadata";
import { mplToolbox } from "@metaplex-foundation/mpl-toolbox";
import { attachMinimalFetchRpc } from "./minimal-fetch-rpc";
import { getDirectRpcUrl, type SolanaNetwork } from "./solana-config";

export function createMintUmi(network: SolanaNetwork): Umi {
  const umi = createBaseUmi();
  umi.use(dataViewSerializer());
  umi.use(defaultProgramRepository());
  umi.use(web3JsEddsa());
  umi.use(web3JsTransactionFactory());
  umi.use(mplTokenMetadata());
  umi.use(mplToolbox());
  attachMinimalFetchRpc(umi, getDirectRpcUrl(network), network);
  return umi;
}

export async function fetchLatestBlockhash(rpcUrl: string) {
  const res = await fetch(rpcUrl, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({
      jsonrpc: "2.0",
      id: 1,
      method: "getLatestBlockhash",
      params: [{ commitment: "confirmed" }],
    }),
    signal: AbortSignal.timeout(15_000),
  });

  if (!res.ok) {
    throw new Error(`RPC HTTP ${res.status} fetching blockhash`);
  }

  const json = (await res.json()) as {
    result?: { value: { blockhash: string; lastValidBlockHeight: number } };
    error?: { message: string };
  };

  if (json.error) throw new Error(json.error.message);
  if (!json.result?.value) throw new Error("RPC returned no blockhash");

  return json.result.value;
}
