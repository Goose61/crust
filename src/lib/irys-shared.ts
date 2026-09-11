/** Shared Irys constants used by both server and client code. */

export const IRYS_NODE_MAINNET = "https://uploader.irys.xyz";
export const IRYS_NODE_DEVNET = "https://devnet.irys.xyz";
export const IRYS_GATEWAY = "https://gateway.irys.xyz";

export function irysNodeFromRpc(rpcUrl: string): string {
  return rpcUrl.includes("devnet") ? IRYS_NODE_DEVNET : IRYS_NODE_MAINNET;
}

/** Irys balance GET responses are plain text or JSON `{ "balance": "…" }`. */
export function parseIrysBalanceResponse(body: string): bigint {
  const trimmed = body.trim();
  if (!trimmed) return 0n;
  if (trimmed.startsWith("{")) {
    try {
      const parsed = JSON.parse(trimmed) as { balance?: string | number };
      if (parsed.balance == null) return 0n;
      return BigInt(String(parsed.balance));
    } catch {
      return 0n;
    }
  }
  return BigInt(trimmed);
}

export async function fetchIrysAccountBalanceLamports(
  address: string,
  devnet = false,
): Promise<bigint> {
  const node = devnet ? IRYS_NODE_DEVNET : IRYS_NODE_MAINNET;
  const res = await fetch(`${node}/account/balance/solana?address=${address}`, {
    signal: AbortSignal.timeout(4_000),
  });
  if (!res.ok) {
    throw new Error(`Could not read Irys balance (${res.status})`);
  }
  return parseIrysBalanceResponse(await res.text());
}

/** Fetch upload price in lamports from the Irys REST API. */
export async function fetchIrysPriceLamports(
  bytes: number,
  devnet = false,
): Promise<bigint> {
  const node = devnet ? IRYS_NODE_DEVNET : IRYS_NODE_MAINNET;
  try {
    const res = await fetch(`${node}/price/solana/${bytes}`, {
      signal: AbortSignal.timeout(4_000),
    });
    if (!res.ok) return BigInt(0);
    return BigInt((await res.text()).trim());
  } catch {
    return BigInt(0);
  }
}
