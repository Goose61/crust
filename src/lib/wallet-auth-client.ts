"use client";

import { authMessageBytes } from "./wallet-auth";
import { getActiveWallet } from "./wallet-session";

/** Must stay in sync with server MAX_AGE_MS in wallet-auth.ts */
export const AUTH_TTL_MS = 2 * 60 * 60 * 1000;
const AUTH_CACHE_BUFFER_MS = 30_000;

function bytesToBase64(bytes: Uint8Array): string {
  let binary = "";
  for (const b of bytes) binary += String.fromCharCode(b);
  return btoa(binary);
}

type CachedAuth = {
  headers: Record<string, string>;
  expiresAt: number;
};

const authCache = new Map<string, CachedAuth>();

export function clearAuthCache(wallet?: string): void {
  if (wallet) authCache.delete(wallet);
  else authCache.clear();
}

export type AuthHeaderOptions = {
  /** Skip cache and request a fresh wallet signature. */
  force?: boolean;
};

/** Sign an auth challenge and return headers for authenticated API calls (cached ~5 min). */
export async function buildAuthHeaders(
  wallet: string,
  options?: AuthHeaderOptions,
): Promise<Record<string, string>> {
  const cached = authCache.get(wallet);
  if (!options?.force && cached && cached.expiresAt > Date.now()) {
    return cached.headers;
  }

  const active = getActiveWallet();
  if (!active?.publicKey || active.publicKey.toBase58() !== wallet) {
    throw new Error("Connect the creator wallet first");
  }
  const timestamp = Date.now();
  const { signature } = await active.signMessage(authMessageBytes(timestamp), "utf8");
  const headers = {
    "X-Wallet": wallet,
    "X-Signature": bytesToBase64(signature),
    "X-Timestamp": String(timestamp),
  };
  authCache.set(wallet, {
    headers,
    expiresAt: timestamp + AUTH_TTL_MS - AUTH_CACHE_BUFFER_MS,
  });
  return headers;
}

/** Human-readable auth message shown in wallet UIs (for our notice copy). */
export const WALLET_AUTH_MESSAGE_PREFIX = "Dough Boi Auth:";
