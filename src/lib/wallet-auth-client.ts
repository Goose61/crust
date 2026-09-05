"use client";

import { authMessageBytes } from "./wallet-auth";
import { getActiveWallet } from "./wallet-session";

function bytesToBase64(bytes: Uint8Array): string {
  let binary = "";
  for (const b of bytes) binary += String.fromCharCode(b);
  return btoa(binary);
}

/** Sign an auth challenge and return headers for authenticated API calls. */
export async function buildAuthHeaders(wallet: string): Promise<Record<string, string>> {
  const active = getActiveWallet();
  if (!active?.publicKey || active.publicKey.toBase58() !== wallet) {
    throw new Error("Connect the creator wallet first");
  }
  const timestamp = Date.now();
  const { signature } = await active.signMessage(authMessageBytes(timestamp), "utf8");
  return {
    "X-Wallet": wallet,
    "X-Signature": bytesToBase64(signature),
    "X-Timestamp": String(timestamp),
  };
}
