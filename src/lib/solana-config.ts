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
  // Server runtime: prefer SOLANA_NETWORK. Browser: prefer NEXT_PUBLIC_*.
  const raw =
    typeof window === "undefined"
      ? (e.SOLANA_NETWORK ?? e.NEXT_PUBLIC_SOLANA_NETWORK ?? "devnet")
      : (e.NEXT_PUBLIC_SOLANA_NETWORK ?? e.SOLANA_NETWORK ?? "devnet");
  return raw === "mainnet" ? "mainnet" : "devnet";
}

/** Parse an explicit network string from a client request body. */
export function parseNetwork(value: unknown): SolanaNetwork {
  return value === "mainnet" ? "mainnet" : "devnet";
}

/** RPC endpoint for the active cluster (or an explicit override). */
export function getRpcUrl(network?: SolanaNetwork, from?: EnvLike): string {
  const e = from ?? env();
  const net = network ?? getSolanaNetwork(e);

  // On the client side, route Solana RPC calls through our own serverless proxy
  // instead of hitting the public endpoint directly.  Browser-originated requests
  // to api.devnet.solana.com and api.mainnet-beta.solana.com are rate-limited with
  // JSON-RPC 403 when the request comes from a browser or Phantom's in-app browser.
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

/** Direct cluster RPC URL — server-side only. Browser code must use getRpcUrl() (proxy). */
export function getDirectRpcUrl(network?: SolanaNetwork, from?: EnvLike): string {
  const e = from ?? env();
  const net = network ?? getSolanaNetwork(e);
  if (net === "devnet") {
    return (
      e.NEXT_PUBLIC_SOLANA_RPC_URL_DEVNET ??
      e.SOLANA_RPC_URL_DEVNET ??
      SOLANA_RPC_DEVNET
    );
  }
  return (
    e.NEXT_PUBLIC_SOLANA_RPC_URL_MAINNET ??
    e.SOLANA_RPC_URL_MAINNET ??
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

let clientNetworkCache: SolanaNetwork | null = null;
let clientNetworkPromise: Promise<SolanaNetwork> | null = null;

/**
 * Cluster the live server is configured for — fetched at runtime from /api/network.
 * Prefer this over getSolanaNetwork() in browser code so Vercel env changes apply
 * without rebuilding (NEXT_PUBLIC_* is inlined at build time).
 */
export async function getClientNetwork(): Promise<SolanaNetwork> {
  if (typeof window === "undefined") return getSolanaNetwork();
  if (clientNetworkCache) return clientNetworkCache;
  if (!clientNetworkPromise) {
    clientNetworkPromise = (async () => {
      try {
        const res = await fetch("/api/network", { cache: "no-store" });
        if (res.ok) {
          const data = (await res.json()) as { network?: string };
          clientNetworkCache = data.network === "mainnet" ? "mainnet" : "devnet";
          return clientNetworkCache;
        }
      } catch {
        /* fall through to build-time default */
      }
      clientNetworkCache = getSolanaNetwork();
      return clientNetworkCache;
    })();
  }
  return clientNetworkPromise;
}

export function clearClientNetworkCache(): void {
  clientNetworkCache = null;
  clientNetworkPromise = null;
}
