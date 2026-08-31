import { getRpcUrl, type SolanaNetwork } from "./solana-config";

type RpcResult<T> = { result?: T; error?: { message: string } };

async function rpcCall<T>(network: SolanaNetwork, method: string, params: unknown[]): Promise<T> {
  const res = await fetch(getRpcUrl(network, process.env), {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ jsonrpc: "2.0", id: 1, method, params }),
    signal: AbortSignal.timeout(20_000),
  });
  if (!res.ok) throw new Error(`RPC HTTP ${res.status}`);
  const json = (await res.json()) as RpcResult<T>;
  if (json.error) throw new Error(json.error.message);
  return json.result as T;
}

/** Returns true only if the tx landed successfully on the given cluster. */
export async function verifyMintTransaction(
  txSignature: string,
  network: SolanaNetwork,
): Promise<{ ok: true } | { ok: false; reason: string }> {
  try {
    const tx = await rpcCall<{
      meta?: { err?: unknown };
      slot?: number;
    } | null>(network, "getTransaction", [
      txSignature,
      { encoding: "json", maxSupportedTransactionVersion: 0, commitment: "confirmed" },
    ]);

    if (!tx) {
      return { ok: false, reason: "Transaction not found on chain — it may have failed or been sent to the wrong network." };
    }
    if (tx.meta?.err) {
      return { ok: false, reason: `Transaction failed on-chain: ${JSON.stringify(tx.meta.err)}` };
    }
    return { ok: true };
  } catch (err) {
    return {
      ok: false,
      reason: err instanceof Error ? err.message : "Could not verify transaction",
    };
  }
}

/** Check whether a Metaplex Core asset account exists. */
export async function verifyAssetExists(
  assetAddress: string,
  network: SolanaNetwork,
): Promise<boolean> {
  try {
    const info = await rpcCall<{ value: unknown | null }>(network, "getAccountInfo", [
      assetAddress,
      { encoding: "base64" },
    ]);
    return info?.value != null;
  } catch {
    return false;
  }
}

export function txSignatureFromMintUrl(mintTxUrl?: string): string | null {
  if (!mintTxUrl) return null;
  const m = mintTxUrl.match(/\/tx\/([^/?]+)/);
  return m?.[1] ?? null;
}

/** Clear stale DB state when a prior mint attempt never landed on-chain. */
export async function resetStaleMintState(collectionId: string, tokenId?: number) {
  const { updateCollection } = await import("./store");
  const { isGiftBundle } = await import("./gift-bundle");

  await updateCollection(collectionId, (c) => {
    const resolvedTokenId = tokenId ?? c.pendingMint?.tokenId;
    const token =
      resolvedTokenId != null
        ? c.tokens.find((t) => t.tokenId === resolvedTokenId)
        : c.tokens[0];

    delete c.pendingMint;
    if (token) {
      delete token.mintTxUrl;
      delete token.assetAddress;
    }

    if (isGiftBundle(c) || c.supply <= 1) {
      c.status = "draft";
      c.mintedCount = 0;
      if (c.tokens[0]) {
        delete c.tokens[0].mintTxUrl;
        delete c.tokens[0].assetAddress;
      }
      return c;
    }

    c.mintedCount = c.tokens.filter((t) => t.owner).length;
    if (c.mintedCount < c.supply && c.status === "sold_out") {
      c.status = "live";
    }
    return c;
  });
}
