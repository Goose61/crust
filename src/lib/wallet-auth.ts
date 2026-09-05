import { PublicKey } from "@solana/web3.js";
import nacl from "tweetnacl";

const AUTH_PREFIX = "Dough Boi Auth: ";
const MAX_AGE_MS = 5 * 60 * 1000;

export function authMessage(timestamp: number): string {
  return `${AUTH_PREFIX}${timestamp}`;
}

export function authMessageBytes(timestamp: number): Uint8Array {
  return new TextEncoder().encode(authMessage(timestamp));
}

export function verifyWalletSignature(
  wallet: string,
  signatureB64: string,
  timestamp: number,
): boolean {
  if (!wallet || !signatureB64 || !Number.isFinite(timestamp)) return false;
  if (Math.abs(Date.now() - timestamp) > MAX_AGE_MS) return false;

  try {
    const pubkey = new PublicKey(wallet);
    const sig = Buffer.from(signatureB64, "base64");
    if (sig.length !== 64) return false;
    return nacl.sign.detached.verify(
      authMessageBytes(timestamp),
      sig,
      pubkey.toBytes(),
    );
  } catch {
    return false;
  }
}

export type AuthHeaders = {
  wallet: string;
  signature: string;
  timestamp: number;
};

export function readAuthHeaders(req: Request): AuthHeaders | null {
  const wallet = req.headers.get("x-wallet")?.trim() ?? "";
  const signature = req.headers.get("x-signature")?.trim() ?? "";
  const tsRaw = req.headers.get("x-timestamp")?.trim() ?? "";
  const timestamp = Number(tsRaw);
  if (!wallet || !signature || !Number.isFinite(timestamp)) return null;
  if (!verifyWalletSignature(wallet, signature, timestamp)) return null;
  return { wallet, signature, timestamp };
}

export function requireWalletAuth(req: Request): AuthHeaders {
  const auth = readAuthHeaders(req);
  if (!auth) throw new Error("Wallet signature required");
  return auth;
}

/** Creator ops require a valid wallet signature matching the collection creator. */
export function assertCreatorAuth(
  auth: AuthHeaders | null,
  creatorWallet: string,
): void {
  if (!auth) throw new Error("Wallet signature required");
  if (!creatorWallet) {
    throw new Error("Creator wallet not set");
  }
  if (auth.wallet !== creatorWallet) {
    throw new Error("Only the creator wallet can perform this action");
  }
}
