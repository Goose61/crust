/**
 * Server-side Metaplex Core NFT transaction builder.
 *
 * Gift mints use Metaplex Core (single create() into CORE_COLLECTION_ADDRESS)
 * for reliable Phantom Collectibles grouping.
 *
 * @see https://www.metaplex.com/docs/smart-contracts/core/collections
 * @see https://www.metaplex.com/docs/smart-contracts/core/create-asset
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
import { getDirectRpcUrl, getSolanaNetwork, type SolanaNetwork } from "./solana-config";
import { createMintUmi, fetchLatestBlockhash } from "./mint-umi";
import { fetchCoreCollection, getCoreCollectionAddress } from "./core-collection";
import { getPlatformSecretKey } from "./platform-key";
import {
  formatInsufficientBalanceMessage,
  getMintStepMinLamports,
  lamportsToSol,
} from "./gift-fees";
import type { PendingMint } from "./types";

export type BuildTxResult = {
  txBase64: string;
  assetAddress: string;
  pendingMint: PendingMint;
  coreCollectionAddress?: string;
};

export type PrepareSignResult = {
  txBase64: string;
  assetAddress: string;
};

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
      while (carry > 0) {
        bytes.push(carry & 0xff);
        carry >>= 8;
      }
    }
    bytes.reverse();
    return bytes.length === 32;
  } catch {
    return false;
  }
}

function secretKeyFromB64(b64: string): Uint8Array {
  const bytes = Buffer.from(b64, "base64");
  if (bytes.length !== 64) {
    throw new Error(`Invalid pending asset secret key length: ${bytes.length}`);
  }
  return new Uint8Array(bytes);
}

function secretKeyToB64(secretKey: Uint8Array): string {
  return Buffer.from(secretKey).toString("base64");
}

async function serverRpcCall<T>(
  rpcUrl: string,
  method: string,
  params: unknown[],
  timeoutMs = 30_000,
): Promise<T> {
  const res = await fetch(rpcUrl, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ jsonrpc: "2.0", id: 1, method, params }),
    signal: AbortSignal.timeout(timeoutMs),
  });
  const text = await res.text();
  if (!text.trim()) {
    throw new Error(`Solana RPC returned empty body (HTTP ${res.status}, ${method})`);
  }
  const json = JSON.parse(text) as { result?: T; error?: { message: string } };
  if (json.error) throw new Error(json.error.message);
  return json.result as T;
}

async function fetchWalletBalanceLamports(
  rpcUrl: string,
  wallet: string,
): Promise<bigint> {
  const result = await serverRpcCall<{ value: number }>(rpcUrl, "getBalance", [
    wallet,
    { commitment: "confirmed" },
  ]);
  return BigInt(result?.value ?? 0);
}

async function assertPayerCanAffordMintStep(params: {
  payer: string;
  network: SolanaNetwork;
}): Promise<void> {
  const rpcUrl = getDirectRpcUrl(params.network);
  const balanceLamports = await fetchWalletBalanceLamports(rpcUrl, params.payer);
  const requiredLamports = getMintStepMinLamports();
  if (balanceLamports >= requiredLamports) return;

  throw new Error(
    formatInsufficientBalanceMessage({
      balanceSol: lamportsToSol(balanceLamports),
      requiredSol: lamportsToSol(requiredLamports),
      mintOnly: true,
    }),
  );
}

async function buildUnsignedGiftTx(params: {
  name: string;
  metadataUri: string;
  recipient: string;
  payer: string;
  network: SolanaNetwork;
  assetSecretKey?: Uint8Array;
  coreCollectionAddress?: string | null;
  recentBlockhash?: string;
}): Promise<{
  txBase64: string;
  assetAddress: string;
  assetSecretKey: Uint8Array;
  coreCollectionAddress?: string;
}> {
  const platformSecret = getPlatformSecretKey();
  if (!platformSecret) throw new Error("Server mint key not configured.");

  const rpcUrl = getDirectRpcUrl(params.network);
  const umi = createMintUmi(params.network);

  const authorityKeypair = umi.eddsa.createKeypairFromSecretKey(platformSecret);
  const authoritySigner = createSignerFromKeypair(umi, authorityKeypair);
  umi.use(keypairIdentity(authorityKeypair, false));

  const assetSigner = params.assetSecretKey
    ? createSignerFromKeypair(
        umi,
        umi.eddsa.createKeypairFromSecretKey(params.assetSecretKey),
      )
    : generateSigner(umi);

  const payerNoop = createNoopSigner(umiPublicKey(params.payer));
  const blockhash = params.recentBlockhash ?? (await fetchLatestBlockhash(rpcUrl));

  const collectionAddress =
    params.coreCollectionAddress ?? getCoreCollectionAddress(params.network);

  let coreCollectionAddress: string | undefined;
  const createArgs: Parameters<typeof create>[1] = {
    asset: assetSigner,
    name: params.name,
    uri: params.metadataUri,
    owner: umiPublicKey(params.recipient),
    payer: payerNoop,
  };

  if (collectionAddress) {
    const collection = await fetchCoreCollection(umi, collectionAddress, params.network);
    createArgs.collection = collection;
    createArgs.authority = authoritySigner;
    coreCollectionAddress = collectionAddress;
  }

  const tx = await create(umi, createArgs)
    .useV0()
    .setFeePayer(payerNoop)
    .setBlockhash(blockhash)
    .build(umi);

  const serialized = umi.transactions.serialize(tx);
  const txBase64 = base64.deserialize(serialized)[0];
  const assetAddress = assetSigner.publicKey.toString();

  return { txBase64, assetAddress, assetSecretKey: assetSigner.secretKey, coreCollectionAddress };
}

function describeSimulationError(err: unknown, logs?: string[] | null): string {
  const logText = logs?.join("\n") ?? "";
  const insufficient = logText.match(/insufficient lamports (\d+), need (\d+)/i);
  if (insufficient) {
    const have = Number(insufficient[1]) / 1e9;
    const need = Number(insufficient[2]) / 1e9;
    return (
      `Not enough SOL in your wallet for the mint step. ` +
      `You have ~${have.toFixed(4)} SOL but need ~${need.toFixed(4)} SOL for account rent ` +
      `(plus tx fees). Arweave storage is charged separately first.`
    );
  }
  return `Transaction would fail on-chain: ${JSON.stringify(err)}`;
}

export async function simulateUnsignedTransaction(
  txBase64: string,
  network?: SolanaNetwork,
): Promise<void> {
  const net = network ?? getSolanaNetwork();
  const rpcUrl = getDirectRpcUrl(net);
  const result = await serverRpcCall<{
    value?: { err?: unknown; logs?: string[] | null };
  }>(
    rpcUrl,
    "simulateTransaction",
    [txBase64, { encoding: "base64", sigVerify: false, commitment: "confirmed" }],
    15_000,
  );
  const err = result?.value?.err;
  if (err) {
    throw new Error(describeSimulationError(err, result?.value?.logs ?? null));
  }
}

export async function prepareGiftTransactionForSigning(params: {
  pendingMint: PendingMint;
  payer: string;
  network?: SolanaNetwork;
}): Promise<PrepareSignResult> {
  if (params.payer !== params.pendingMint.payer) {
    throw new Error("Connected wallet does not match the mint payer.");
  }

  const network = params.network ?? getSolanaNetwork();
  if (!params.pendingMint.assetSecretKeyB64) {
    throw new Error("Pending mint is missing the asset key.");
  }
  const assetSecret = secretKeyFromB64(params.pendingMint.assetSecretKeyB64);

  const { txBase64, assetAddress } = await buildUnsignedGiftTx({
    name: params.pendingMint.name,
    metadataUri: params.pendingMint.metadataUri,
    recipient: params.pendingMint.recipient,
    payer: params.pendingMint.payer,
    network,
    assetSecretKey: assetSecret,
    coreCollectionAddress: params.pendingMint.coreCollectionAddress,
  });

  if (assetAddress !== params.pendingMint.assetAddress) {
    throw new Error("Asset address mismatch when refreshing transaction.");
  }

  await assertPayerCanAffordMintStep({ payer: params.payer, network });
  await simulateUnsignedTransaction(txBase64, network);

  return { txBase64, assetAddress };
}

export async function buildGiftTransaction(params: {
  name: string;
  metadataUri: string;
  recipient: string;
  payer: string;
  network?: SolanaNetwork;
  coreCollectionAddress?: string | null;
}): Promise<BuildTxResult | null> {
  if (!getPlatformSecretKey()) return null;

  const network = params.network ?? getSolanaNetwork();
  const { txBase64, assetAddress, assetSecretKey, coreCollectionAddress } =
    await buildUnsignedGiftTx({
      name: params.name,
      metadataUri: params.metadataUri,
      recipient: params.recipient,
      payer: params.payer,
      network,
      coreCollectionAddress: params.coreCollectionAddress,
    });

  return {
    txBase64,
    assetAddress,
    coreCollectionAddress,
    pendingMint: {
      assetSecretKeyB64: secretKeyToB64(assetSecretKey),
      assetAddress,
      name: params.name,
      metadataUri: params.metadataUri,
      recipient: params.recipient,
      payer: params.payer,
      ...(coreCollectionAddress ? { coreCollectionAddress } : {}),
    },
  };
}

export async function cosignAndSubmitGiftTransaction(params: {
  userSignedTxBase64: string;
  pendingMint: PendingMint;
  network?: SolanaNetwork;
}): Promise<string> {
  const platformSecret = getPlatformSecretKey();
  if (!platformSecret) {
    throw new Error("Server mint key not configured (ARWEAVE_SOLANA_KEY).");
  }
  if (!params.pendingMint.assetSecretKeyB64) {
    throw new Error("Pending mint is missing the asset key.");
  }

  const network = params.network ?? getSolanaNetwork();
  const rpcUrl = getDirectRpcUrl(network);

  const tx = VersionedTransaction.deserialize(
    Buffer.from(params.userSignedTxBase64, "base64"),
  );

  const assetSecret = secretKeyFromB64(params.pendingMint.assetSecretKeyB64);
  const assetKp = Keypair.fromSecretKey(assetSecret);
  const platformKp = Keypair.fromSecretKey(platformSecret);

  if (assetKp.publicKey.toBase58() !== params.pendingMint.assetAddress) {
    throw new Error("Pending mint asset key does not match stored address.");
  }

  const expected = await buildUnsignedGiftTx({
    name: params.pendingMint.name,
    metadataUri: params.pendingMint.metadataUri,
    recipient: params.pendingMint.recipient,
    payer: params.pendingMint.payer,
    network,
    assetSecretKey: assetSecret,
    coreCollectionAddress: params.pendingMint.coreCollectionAddress,
    recentBlockhash: tx.message.recentBlockhash,
  });

  const expectedTx = VersionedTransaction.deserialize(Buffer.from(expected.txBase64, "base64"));
  const userMessage = Buffer.from(tx.message.serialize());
  const expectedMessage = Buffer.from(expectedTx.message.serialize());
  if (!userMessage.equals(expectedMessage)) {
    throw new Error("Signed transaction does not match the pending mint.");
  }

  const cosigners = [assetKp];
  const usesCoreCollection =
    params.pendingMint.coreCollectionAddress ?? getCoreCollectionAddress(network);
  if (usesCoreCollection) {
    cosigners.unshift(platformKp);
  }
  tx.sign(cosigners);

  return serverRpcCall<string>(rpcUrl, "sendTransaction", [
    Buffer.from(tx.serialize()).toString("base64"),
    { encoding: "base64", skipPreflight: false, preflightCommitment: "confirmed" },
  ]);
}
