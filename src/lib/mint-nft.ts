/**
 * Server-side Metaplex Core NFT transaction builder.
 *
 * Phantom Lighthouse requires the wallet to sign FIRST, then additional
 * signers partialSign afterward. Flow:
 *   1. Server builds an UNSIGNED tx and stores the asset keypair in pendingMint.
 *   2. Immediately before Phantom: refresh blockhash + simulate (sigVerify: false).
 *   3. User signs in Phantom via signTransaction (fee payer).
 *   4. Server co-signs with platform + asset keypairs and submits.
 *
 * If ARWEAVE_SOLANA_KEY is not set the builder returns null (demo mode).
 */

import {
  keypairIdentity,
  generateSigner,
  createNoopSigner,
  createSignerFromKeypair,
  publicKey as umiPublicKey,
} from "@metaplex-foundation/umi";
import { create } from "@metaplex-foundation/mpl-core";
import { base64 } from "@metaplex-foundation/umi/serializers";
import { Keypair, VersionedTransaction } from "@solana/web3.js";
import { getRpcUrl, getSolanaNetwork, type SolanaNetwork } from "./solana-config";
import { createMintUmi, fetchLatestBlockhash } from "./mint-umi";
import type { PendingMint } from "./types";

export type BuildTxResult = {
  /** Base64-encoded UNSIGNED versioned transaction for Phantom to sign first */
  txBase64: string;
  assetAddress: string;
  pendingMint: PendingMint;
};

export type PrepareSignResult = {
  txBase64: string;
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

function getPlatformSecretKey(): Uint8Array | null {
  const rawKey = process.env.ARWEAVE_SOLANA_KEY;
  if (!rawKey) return null;
  return parseSecretKey(rawKey);
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

function secretKeyToB64(secretKey: Uint8Array): string {
  return Buffer.from(secretKey).toString("base64");
}

function secretKeyFromB64(b64: string): Uint8Array {
  const bytes = Buffer.from(b64, "base64");
  if (bytes.length !== 64) {
    throw new Error(`Invalid pending asset secret key length: ${bytes.length}`);
  }
  return new Uint8Array(bytes);
}

async function buildUnsignedGiftTx(params: {
  name: string;
  metadataUri: string;
  recipient: string;
  payer: string;
  network: SolanaNetwork;
  assetSecretKey?: Uint8Array;
}): Promise<{ txBase64: string; assetAddress: string; assetSecretKey: Uint8Array }> {
  const platformSecret = getPlatformSecretKey();
  if (!platformSecret) throw new Error("Server mint key not configured.");

  const rpcUrl = getRpcUrl(params.network);
  const umi = createMintUmi();

  const authorityKeypair = umi.eddsa.createKeypairFromSecretKey(platformSecret);
  umi.use(keypairIdentity(authorityKeypair, false));

  const assetSigner = params.assetSecretKey
    ? createSignerFromKeypair(
        umi,
        umi.eddsa.createKeypairFromSecretKey(params.assetSecretKey),
      )
    : generateSigner(umi);

  const payerNoop = createNoopSigner(umiPublicKey(params.payer));
  const blockhash = await fetchLatestBlockhash(rpcUrl);

  const tx = await create(umi, {
    asset: assetSigner,
    name: params.name,
    uri: params.metadataUri,
    owner: umiPublicKey(params.recipient),
    payer: payerNoop,
  })
    .useV0()
    .setFeePayer(payerNoop)
    .setBlockhash(blockhash)
    .build(umi);

  const serialized = umi.transactions.serialize(tx);
  const txBase64 = base64.deserialize(serialized)[0];
  const assetAddress = assetSigner.publicKey.toString();

  return { txBase64, assetAddress, assetSecretKey: assetSigner.secretKey };
}

/**
 * Simulate an unsigned tx before Phantom signing (Phantom docs: sigVerify false).
 * Catches program errors early and reduces simulation warnings in the wallet.
 */
export async function simulateUnsignedTransaction(
  txBase64: string,
  network?: SolanaNetwork,
): Promise<void> {
  const rpcUrl = getRpcUrl(network ?? getSolanaNetwork());
  const res = await fetch(rpcUrl, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({
      jsonrpc: "2.0",
      id: 1,
      method: "simulateTransaction",
      params: [
        txBase64,
        { encoding: "base64", sigVerify: false, commitment: "confirmed" },
      ],
    }),
    signal: AbortSignal.timeout(15_000),
  });

  const json = (await res.json()) as {
    result?: { value?: { err?: unknown } };
    error?: { message?: string };
  };
  if (json.error) throw new Error(`Simulation RPC error: ${json.error.message}`);
  const err = json.result?.value?.err;
  if (err) {
    throw new Error(`Transaction would fail on-chain: ${JSON.stringify(err)}`);
  }
}

/**
 * Rebuild unsigned tx with a fresh blockhash + simulate before Phantom popup.
 */
export async function prepareGiftTransactionForSigning(params: {
  pendingMint: PendingMint;
  payer: string;
  network?: SolanaNetwork;
}): Promise<PrepareSignResult> {
  if (params.payer !== params.pendingMint.payer) {
    throw new Error("Connected wallet does not match the mint payer.");
  }

  const network = params.network ?? getSolanaNetwork();
  const assetSecret = secretKeyFromB64(params.pendingMint.assetSecretKeyB64);

  const { txBase64, assetAddress } = await buildUnsignedGiftTx({
    name: params.pendingMint.name,
    metadataUri: params.pendingMint.metadataUri,
    recipient: params.pendingMint.recipient,
    payer: params.pendingMint.payer,
    network,
    assetSecretKey: assetSecret,
  });

  if (assetAddress !== params.pendingMint.assetAddress) {
    throw new Error("Asset address mismatch when refreshing transaction.");
  }

  await simulateUnsignedTransaction(txBase64, network);

  return { txBase64, assetAddress };
}

/**
 * Build an UNSIGNED Metaplex Core create transaction.
 * Phantom signs first; platform + asset keys co-sign afterward.
 */
export async function buildGiftTransaction(params: {
  name: string;
  metadataUri: string;
  recipient: string;
  payer: string;
  network?: SolanaNetwork;
}): Promise<BuildTxResult | null> {
  if (!getPlatformSecretKey()) return null;

  const network = params.network ?? getSolanaNetwork();
  const { txBase64, assetAddress, assetSecretKey } = await buildUnsignedGiftTx({
    name: params.name,
    metadataUri: params.metadataUri,
    recipient: params.recipient,
    payer: params.payer,
    network,
  });

  return {
    txBase64,
    assetAddress,
    pendingMint: {
      assetSecretKeyB64: secretKeyToB64(assetSecretKey),
      assetAddress,
      name: params.name,
      metadataUri: params.metadataUri,
      recipient: params.recipient,
      payer: params.payer,
    },
  };
}

/**
 * Co-sign a Phantom-signed mint tx with platform + asset keys, then submit.
 * Called after the user signs first via phantom.signTransaction().
 */
export async function cosignAndSubmitGiftTransaction(params: {
  userSignedTxBase64: string;
  pendingMint: PendingMint;
  network?: SolanaNetwork;
}): Promise<string> {
  const platformSecret = getPlatformSecretKey();
  if (!platformSecret) {
    throw new Error("Server mint key not configured (ARWEAVE_SOLANA_KEY).");
  }

  const network = params.network ?? getSolanaNetwork();
  const rpcUrl = getRpcUrl(network);

  const tx = VersionedTransaction.deserialize(
    Buffer.from(params.userSignedTxBase64, "base64"),
  );

  const assetSecret = secretKeyFromB64(params.pendingMint.assetSecretKeyB64);
  const assetKp = Keypair.fromSecretKey(assetSecret);

  if (assetKp.publicKey.toBase58() !== params.pendingMint.assetAddress) {
    throw new Error("Pending mint asset key does not match stored address.");
  }

  // Phantom signed as fee payer first; only the asset keypair co-signs afterward.
  // Platform key (update authority) is not a required signer on Core createV2.
  tx.sign([assetKp]);

  const res = await fetch(rpcUrl, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({
      jsonrpc: "2.0",
      id: 1,
      method: "sendTransaction",
      params: [
        Buffer.from(tx.serialize()).toString("base64"),
        { encoding: "base64", skipPreflight: false, preflightCommitment: "confirmed" },
      ],
    }),
    signal: AbortSignal.timeout(30_000),
  });

  const json = (await res.json()) as { result?: string; error?: { message: string } };
  if (json.error) throw new Error(json.error.message);
  if (!json.result) throw new Error("RPC returned no transaction signature");
  return json.result;
}
