/** Shared Irys constants used by both server and client code. */

export const IRYS_NODE_MAINNET = "https://uploader.irys.xyz";
export const IRYS_NODE_DEVNET = "https://devnet.irys.xyz";
export const IRYS_GATEWAY = "https://gateway.irys.xyz";

export function irysNodeFromRpc(rpcUrl: string): string {
  return rpcUrl.includes("devnet") ? IRYS_NODE_DEVNET : IRYS_NODE_MAINNET;
}

/**
 * Irys REST responses may be plain text ("12345") or JSON
 * ({ "balance": "…" }, { "amount": "…" }, etc.).
 */
export function parseIrysAmountResponse(body: string, label = "amount"): bigint {
  const trimmed = body.trim();
  if (!trimmed) return 0n;
  if (trimmed.startsWith("{")) {
    let parsed: Record<string, string | number | undefined>;
    try {
      parsed = JSON.parse(trimmed) as Record<string, string | number | undefined>;
    } catch {
      throw new SyntaxError(`Cannot parse Irys ${label} JSON: ${trimmed.slice(0, 120)}`);
    }
    const value =
      parsed.balance ?? parsed.amount ?? parsed.price ?? parsed.lamports ?? parsed.value;
    if (value == null) return 0n;
    return BigInt(String(value));
  }
  try {
    return BigInt(trimmed);
  } catch {
    throw new SyntaxError(`Cannot parse Irys ${label}: ${trimmed.slice(0, 120)}`);
  }
}

/** @deprecated Use parseIrysAmountResponse */
export function parseIrysBalanceResponse(body: string): bigint {
  return parseIrysAmountResponse(body, "balance");
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
  return parseIrysAmountResponse(await res.text(), "balance");
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
    if (!res.ok) return 0n;
    return parseIrysAmountResponse(await res.text(), "price");
  } catch {
    return 0n;
  }
}
