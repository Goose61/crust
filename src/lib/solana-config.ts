/**
 * Solana cluster configuration.
 *
 * Set NEXT_PUBLIC_SOLANA_NETWORK (client) and SOLANA_NETWORK (server) to
 * `devnet` or `mainnet`. RPC URLs for each cluster are configured separately
 * so switching networks is a one-line change in .env.local.
 */

export type SolanaNetwork = "devnet" | "mainnet";

export const SOLANA_RPC_DEVNET = "https://api.devnet.solana.com";
export const SOLANA_RPC_MAINNET = "https://api.mainnet.solana.com";

type EnvLike = Record<string, string | undefined>;

function env(): EnvLike {
  return typeof process !== "undefined" ? process.env : {};
}

/** Active cluster — defaults to devnet when unset (safer for testing). */
export function getSolanaNetwork(from?: EnvLike): SolanaNetwork {
  const e = from ?? env();
  const raw = e.NEXT_PUBLIC_SOLANA_NETWORK ?? e.SOLANA_NETWORK ?? "devnet";
  return raw === "mainnet" ? "mainnet" : "devnet";
}

/** RPC endpoint for the active cluster (or an explicit override). */
export function getRpcUrl(network?: SolanaNetwork, from?: EnvLike): string {
  const e = from ?? env();
  const net = network ?? getSolanaNetwork(e);

  // On the client side, route Solana RPC calls through our own serverless proxy
  // instead of hitting the public endpoint directly.  Browser-originated requests
  // to api.devnet.solana.com are rate-limited with JSON-RPC 403 by Triton when
  // the request comes from Phantom's in-app browser or similar environments.
  // Server-to-server calls made by the proxy are not subject to those limits.
  // `from` being set means an explicit env override was requested (server only).
  if (typeof window !== "undefined" && !from) {
    return `${window.location.origin}/api/solana-proxy?n=${net}`;
  }

  if (net === "devnet") {
    return (
      e.SOLANA_RPC_URL_DEVNET ??
      e.NEXT_PUBLIC_SOLANA_RPC_URL_DEVNET ??
      SOLANA_RPC_DEVNET
    );
  }

  return (
    e.SOLANA_RPC_URL_MAINNET ??
    e.NEXT_PUBLIC_SOLANA_RPC_URL_MAINNET ??
    SOLANA_RPC_MAINNET
  );
}

export function isDevnetNetwork(network?: SolanaNetwork): boolean {
  return (network ?? getSolanaNetwork()) === "devnet";
}

/** Solana Explorer `?cluster=` query suffix for the active network. */
export function explorerClusterQuery(network?: SolanaNetwork): string {
  return isDevnetNetwork(network) ? "?cluster=devnet" : "";
}
