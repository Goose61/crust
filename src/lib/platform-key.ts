/**
 * Platform wallet (ARWEAVE_SOLANA_KEY) helpers — update authority for gift mints.
 */

import { Keypair } from "@solana/web3.js";

function parseSecretKey(raw: string): Uint8Array {
  const trimmed = raw.trim();
  if (trimmed.startsWith("[")) {
    const arr = JSON.parse(trimmed) as number[];
    if (!Array.isArray(arr) || arr.length !== 64) {
      throw new Error(`ARWEAVE_SOLANA_KEY JSON array must be 64 bytes; got ${arr?.length ?? 0}.`);
    }
    return new Uint8Array(arr);
  }
  return decodeBase58(trimmed);
}

function decodeBase58(b58: string): Uint8Array {
  const ALPHA = "123456789ABCDEFGHJKLMNPQRSTUVWXYZabcdefghijkmnopqrstuvwxyz";
  const bytes: number[] = [0];
  for (const char of b58) {
    const idx = ALPHA.indexOf(char);
    if (idx < 0) throw new Error(`Invalid base58 character: "${char}"`);
    let carry = idx;
    for (let i = 0; i < bytes.length; i++) {
      carry += bytes[i] * 58;
      bytes[i] = carry & 0xff;
      carry >>= 8;
    }
    while (carry > 0) {
      bytes.push(carry & 0xff);
      carry >>= 8;
    }
  }
  for (let i = 0; b58[i] === "1"; i++) bytes.push(0);
  return new Uint8Array(bytes.reverse());
}

export function getPlatformSecretKey(): Uint8Array | null {
  const rawKey = process.env.ARWEAVE_SOLANA_KEY;
  if (!rawKey) return null;
  return parseSecretKey(rawKey);
}

/** Base58 public key of the platform update authority (safe to expose to clients). */
export function getPlatformPublicKey(): string | null {
  const secret = getPlatformSecretKey();
  if (!secret) return null;
  return Keypair.fromSecretKey(secret).publicKey.toBase58();
}
