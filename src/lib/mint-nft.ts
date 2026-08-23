/**
 * Server-side Metaplex Core NFT transaction builder.
 *
 * Builds a Core `create` transaction, partially signs it with the asset
 * keypair (server-side), and returns the serialized base64 string for the
 * minter's browser wallet to sign and submit.
 *
 * The user pays all Solana network fees (rent + protocol + tx fee).
 * The platform key is only used as the mint authority / update authority —
 * it does NOT pay chain fees.
 *
 * If ARWEAVE_SOLANA_KEY is not set the function returns null (demo mode).
 */

import {
  keypairIdentity,
  generateSigner,
  createNoopSigner,
  publicKey as umiPublicKey,
} from "@metaplex-foundation/umi";
import { create } from "@metaplex-foundation/mpl-core";
import { base64 } from "@metaplex-foundation/umi/serializers";
import { getRpcUrl, getSolanaNetwork, type SolanaNetwork } from "./solana-config";
import { createMintUmi, fetchLatestBlockhash } from "./mint-umi";

export type BuildTxResult = {
  /** Base64-encoded, partially-signed versioned transaction */
  txBase64: string;
  /** On-chain address that will be assigned to this NFT asset */
  assetAddress: string;
};

/** Lightweight Solana address validator — no network call required. */
export function isValidSolanaAddress(addr: string): boolean {
  if (!addr || addr.length < 32 || addr.length > 44) return false;
  if (!/^[1-9A-HJ-NP-Za-km-z]+$/.test(addr)) return false;
  try {
    const ALPHA = "123456789ABCDEFGHJKLMNPQRSTUVWXYZabcdefghijkmnopqrstuvwxyz";
    const bytes: number[] = [0];
    for (const char of addr) {
      const idx = ALPHA.indexOf(char);
      if (idx < 0) return false;
      let carry = idx;
      for (let i = 0; i < bytes.length; i++) {
        carry += bytes[i] * 58;
        bytes[i] = carry & 0xff;
        carry >>= 8;
      }
      while (carry > 0) { bytes.push(carry & 0xff); carry >>= 8; }
    }
    bytes.reverse();
    return bytes.length === 32;
  } catch {
    return false;
  }
}

/** Decode platform secret key — supports base58 string or JSON byte array. */
function parseSecretKey(raw: string): Uint8Array {
  const trimmed = raw.trim();
  if (trimmed.startsWith("[")) {
    const arr = JSON.parse(trimmed) as number[];
    if (!Array.isArray(arr) || arr.length !== 64) {
      throw new Error(`ARWEAVE_SOLANA_KEY JSON array must be 64 bytes; got ${arr?.length ?? 0}.`);
    }
    return new Uint8Array(arr);
  }
  const decoded = decodeBase58(trimmed);
  if (decoded.length !== 64) {
    throw new Error(
      `ARWEAVE_SOLANA_KEY decoded to ${decoded.length} bytes; expected 64.`,
    );
  }
  return decoded;
}

/** Decode a base58 string to a Uint8Array (no external dependency). */
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
    while (carry > 0) { bytes.push(carry & 0xff); carry >>= 8; }
  }
  for (let i = 0; b58[i] === "1"; i++) bytes.push(0);
  return new Uint8Array(bytes.reverse());
}

/**
 * Build a Metaplex Core NFT creation transaction.
 *
 * Architecture (per official Metaplex docs on partial signing):
 *   1. Platform keypair (ARWEAVE_SOLANA_KEY) acts as update authority.
 *   2. Asset keypair is generated server-side and partially signs here.
 *   3. User's pubkey is set as fee payer via a NoopSigner — the server
 *      does NOT sign on their behalf.
 *   4. Serialised base64 tx is returned; the browser wallet signs as
 *      fee payer and submits.
 */
export async function buildGiftTransaction(params: {
  name: string;
  metadataUri: string;
  recipient: string;
  payer: string;
  /** Cluster the user's Phantom wallet is on — must match for simulation/submit. */
  network?: SolanaNetwork;
}): Promise<BuildTxResult | null> {
  const rawKey = process.env.ARWEAVE_SOLANA_KEY;
  if (!rawKey) return null; // demo / staging mode

  const network = params.network ?? getSolanaNetwork();
  const rpcUrl = getRpcUrl(network);
  const umi = createMintUmi();

  const secretBytes = parseSecretKey(rawKey);
  const authorityKeypair = umi.eddsa.createKeypairFromSecretKey(secretBytes);
  // Identity = platform update authority; do NOT set umi.payer to platform key.
  umi.use(keypairIdentity(authorityKeypair, false));

  const assetSigner = generateSigner(umi);
  const payerNoop = createNoopSigner(umiPublicKey(params.payer));
  const blockhash = await fetchLatestBlockhash(rpcUrl);

  const tx = await create(umi, {
    asset: assetSigner,
    name: params.name,
    uri: params.metadataUri,
    owner: umiPublicKey(params.recipient),
    payer: payerNoop, // pays rent for new asset account
  })
    .useV0()
    .setFeePayer(payerNoop) // user's wallet pays tx fees (was wrongly platform key)
    .setBlockhash(blockhash)
    .buildAndSign(umi);

  const serialized = umi.transactions.serialize(tx);
  const txBase64 = base64.deserialize(serialized)[0];

  return {
    txBase64,
    assetAddress: assetSigner.publicKey.toString(),
  };
}
