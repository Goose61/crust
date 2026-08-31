"use client";

import { authMessageBytes } from "./wallet-auth";

type PhantomSignMessage = {
  signMessage: (message: Uint8Array, display?: string) => Promise<{ signature: Uint8Array }>;
  publicKey?: { toBase58: () => string };
};

function bytesToBase64(bytes: Uint8Array): string {
  let binary = "";
  for (const b of bytes) binary += String.fromCharCode(b);
  return btoa(binary);
}

function getPhantom(): PhantomSignMessage | null {
  if (typeof window === "undefined") return null;
  const p = (window as unknown as { phantom?: { solana?: PhantomSignMessage } }).phantom?.solana;
  return p?.signMessage ? p : null;
}

/** Sign an auth challenge and return headers for authenticated API calls. */
export async function buildAuthHeaders(wallet: string): Promise<Record<string, string>> {
  const phantom = getPhantom();
  if (!phantom?.publicKey || phantom.publicKey.toBase58() !== wallet) {
    throw new Error("Connect the creator wallet in Phantom first");
  }
  const timestamp = Date.now();
  const { signature } = await phantom.signMessage(authMessageBytes(timestamp), "utf8");
  return {
    "X-Wallet": wallet,
    "X-Signature": bytesToBase64(signature),
    "X-Timestamp": String(timestamp),
  };
}
