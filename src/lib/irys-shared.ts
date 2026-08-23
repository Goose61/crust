/** Shared Irys constants used by both server and client code. */

export const IRYS_NODE_MAINNET = "https://uploader.irys.xyz";
export const IRYS_NODE_DEVNET = "https://devnet.irys.xyz";
export const IRYS_GATEWAY = "https://gateway.irys.xyz";

export function irysNodeFromRpc(rpcUrl: string): string {
  return rpcUrl.includes("devnet") ? IRYS_NODE_DEVNET : IRYS_NODE_MAINNET;
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
