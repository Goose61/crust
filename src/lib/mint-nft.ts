/**
 * Server-side Metaplex Token Metadata NFT transaction builder.
 *
 * Gift mints use standard Token Metadata NFTs (not Metaplex Core) so Phantom and
 * other wallets index them in the Collectibles tab.
 *
 * @see https://www.metaplex.com/docs/smart-contracts/token-metadata/guides/javascript/create-an-nft
 * @see https://docs.phantom.com/best-practices/tokens/collectibles-nfts-and-semi-fungibles
 *
 * Phantom Lighthouse multi-signer order:
 *   1. Server builds UNSIGNED tx, stores mint keypair in pendingMint.
 *   2. prepare-sign: fresh blockhash + simulate (sigVerify: false).
 *   3. User signs via phantom.signTransaction (fee payer).
 *   4. Server co-signs (mint + update authority) and submits.
 *
 * If ARWEAVE_SOLANA_KEY is not set the builder returns null (demo mode).
 */

import {
  keypairIdentity,
  generateSigner,
  createNoopSigner,
  createSignerFromKeypair,
  publicKey as umiPublicKey,
  percentAmount,
  transactionBuilder,
  some,
} from "@metaplex-foundation/umi";
import {
  createV1,
  mintV1,
  verifyCollectionV1,
  verifyCreatorV1,
  findMetadataPda,
  TokenStandard,
} from "@metaplex-foundation/mpl-token-metadata";
import { base64 } from "@metaplex-foundation/umi/serializers";
import { Keypair, VersionedTransaction } from "@solana/web3.js";
import { getDirectRpcUrl, getSolanaNetwork, type SolanaNetwork } from "./solana-config";
import { createMintUmi, fetchLatestBlockhash } from "./mint-umi";
import { getGiftCollectionMint } from "./gift-collection";
import { getPlatformSecretKey } from "./platform-key";
import { GIFT_ON_CHAIN_SYMBOL } from "./gift-metadata";
import {
  formatInsufficientBalanceMessage,
  getMintStepMinLamports,
  lamportsToSol,
} from "./gift-fees";
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

function secretKeyFromB64(b64: string): Uint8Array {
  const bytes = Buffer.from(b64, "base64");
  if (bytes.length !== 64) {
    throw new Error(`Invalid pending mint secret key length: ${bytes.length}`);
  }
  return new Uint8Array(bytes);
}

function secretKeyToB64(secretKey: Uint8Array): string {
  return Buffer.from(secretKey).toString("base64");
}

async function buildUnsignedGiftTx(params: {
  name: string;
  metadataUri: string;
  recipient: string;
  payer: string;
  network: SolanaNetwork;
  mintSecretKey?: Uint8Array;
  tmCollectionMint?: string | null;
}): Promise<{ txBase64: string; assetAddress: string; mintSecretKey: Uint8Array }> {
  const platformSecret = getPlatformSecretKey();
  if (!platformSecret) throw new Error("Server mint key not configured.");

  const rpcUrl = getDirectRpcUrl(params.network);
  const umi = createMintUmi(params.network);

  const authorityKeypair = umi.eddsa.createKeypairFromSecretKey(platformSecret);
  const updateAuthority = createSignerFromKeypair(umi, authorityKeypair);
  umi.use(keypairIdentity(authorityKeypair, false));

  const mintSigner = params.mintSecretKey
    ? createSignerFromKeypair(
        umi,
        umi.eddsa.createKeypairFromSecretKey(params.mintSecretKey),
      )
    : generateSigner(umi);

  const payerNoop = createNoopSigner(umiPublicKey(params.payer));
  const blockhash = await fetchLatestBlockhash(rpcUrl);
  const tmCollectionMint = params.tmCollectionMint?.trim() || null;

  let builder = transactionBuilder().add(
    createV1(umi, {
      mint: mintSigner,
      authority: mintSigner,
      name: params.name,
      symbol: GIFT_ON_CHAIN_SYMBOL,
      uri: params.metadataUri,
      sellerFeeBasisPoints: percentAmount(0),
      tokenStandard: TokenStandard.NonFungible,
      updateAuthority,
      payer: payerNoop,
      ...(tmCollectionMint
        ? {
            collection: some({
              key: umiPublicKey(tmCollectionMint),
              verified: false,
            }),
          }
        : {}),
      creators: [
        {
          address: updateAuthority.publicKey,
          verified: false,
          share: 100,
        },
      ],
    }),
  );

  builder = builder.add(
    mintV1(umi, {
      mint: mintSigner.publicKey,
      // NonFungible mints require metadata update authority, not mint authority.
      authority: updateAuthority,
      tokenOwner: umiPublicKey(params.recipient),
      tokenStandard: TokenStandard.NonFungible,
      amount: 1,
      payer: payerNoop,
    }),
  );

  const metadata = findMetadataPda(umi, { mint: mintSigner.publicKey });

  if (tmCollectionMint) {
    builder = builder.add(
      verifyCollectionV1(umi, {
        authority: updateAuthority,
        metadata,
        collectionMint: umiPublicKey(tmCollectionMint),
      }),
    );
  }

  // Platform co-signs so Phantom sees a verified creator (Collectibles indexing).
  builder = builder.add(
    verifyCreatorV1(umi, {
      authority: updateAuthority,
      metadata,
    }),
  );

  const tx = await builder
    .useV0()
    .setFeePayer(payerNoop)
    .setBlockhash(blockhash)
    .build(umi);

  const serialized = umi.transactions.serialize(tx);
  const txBase64 = base64.deserialize(serialized)[0];
  const assetAddress = mintSigner.publicKey.toString();

  return { txBase64, assetAddress, mintSecretKey: mintSigner.secretKey };
}

/**
 * Simulate an unsigned tx before Phantom signing (Phantom docs: sigVerify false).
 * @see https://docs.phantom.com/solana/sending-a-transaction
 */
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

/**
 * Simulate an unsigned tx before Phantom signing (Phantom docs: sigVerify false).
 */
const TM_ERROR_NAMES: Record<number, string> = {
  0: "InstructionUnpackError",
  1: "InstructionPackError",
  2: "NotRentExempt",
  7: "UpdateAuthorityIncorrect",
  11: "NameTooLong",
  12: "SymbolTooLong",
  13: "UriTooLong",
  80: "CollectionNotFound",
  82: "CollectionMustBeAUniqueMasterEdition",
};

function describeSimulationError(err: unknown, logs?: string[] | null): string {
  const logText = logs?.join("\n") ?? "";
  const insufficient = logText.match(/insufficient lamports (\d+), need (\d+)/i);
  if (insufficient) {
    const have = Number(insufficient[1]) / 1e9;
    const need = Number(insufficient[2]) / 1e9;
    return (
      `Not enough SOL in your wallet for the mint step. ` +
      `You have ~${have.toFixed(4)} SOL but need ~${need.toFixed(4)} SOL for account rent ` +
      `(plus tx fees). Arweave storage is charged separately first — keep ~0.02 SOL remaining for the mint.`
    );
  }

  const raw = JSON.stringify(err);
  const custom = raw.match(/"Custom":(\d+)/);
  if (custom) {
    const code = Number(custom[1]);
    const name = TM_ERROR_NAMES[code];
    if (name) {
      return `Transaction would fail on-chain (${name} / Custom:${code}): ${raw}`;
    }
  }
  return `Transaction would fail on-chain: ${raw}`;
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
    const logs = result?.value?.logs ?? null;
    throw new Error(describeSimulationError(err, logs));
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
  const mintSecret = secretKeyFromB64(params.pendingMint.assetSecretKeyB64);
  const tmCollectionMint =
    params.pendingMint.tmCollectionMint ?? getGiftCollectionMint(network);

  const { txBase64, assetAddress } = await buildUnsignedGiftTx({
    name: params.pendingMint.name,
    metadataUri: params.pendingMint.metadataUri,
    recipient: params.pendingMint.recipient,
    payer: params.pendingMint.payer,
    network,
    mintSecretKey: mintSecret,
    tmCollectionMint,
  });

  if (assetAddress !== params.pendingMint.assetAddress) {
    throw new Error("Mint address mismatch when refreshing transaction.");
  }

  await assertPayerCanAffordMintStep({ payer: params.payer, network });
  await simulateUnsignedTransaction(txBase64, network);

  return { txBase64, assetAddress };
}

/**
 * Build an UNSIGNED Token Metadata create+mint transaction.
 * Phantom signs first; server co-signs afterward.
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
  const tmCollectionMint = getGiftCollectionMint(network);
  const { txBase64, assetAddress, mintSecretKey } = await buildUnsignedGiftTx({
    name: params.name,
    metadataUri: params.metadataUri,
    recipient: params.recipient,
    payer: params.payer,
    network,
    tmCollectionMint,
  });

  return {
    txBase64,
    assetAddress,
    pendingMint: {
      assetSecretKeyB64: secretKeyToB64(mintSecretKey),
      assetAddress,
      name: params.name,
      metadataUri: params.metadataUri,
      recipient: params.recipient,
      payer: params.payer,
      ...(tmCollectionMint ? { tmCollectionMint } : {}),
    },
  };
}

/**
 * Co-sign a Phantom-signed mint tx, then submit.
 * Mint keypair + update authority (platform) co-sign after the user.
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
  const rpcUrl = getDirectRpcUrl(network);

  const tx = VersionedTransaction.deserialize(
    Buffer.from(params.userSignedTxBase64, "base64"),
  );

  const mintSecret = secretKeyFromB64(params.pendingMint.assetSecretKeyB64);
  const mintKp = Keypair.fromSecretKey(mintSecret);
  const platformKp = Keypair.fromSecretKey(platformSecret);

  if (mintKp.publicKey.toBase58() !== params.pendingMint.assetAddress) {
    throw new Error("Pending mint key does not match stored mint address.");
  }

  // Phantom signed as fee payer first; server adds mint + update authority.
  tx.sign([platformKp, mintKp]);

  const txSignature = await serverRpcCall<string>(rpcUrl, "sendTransaction", [
    Buffer.from(tx.serialize()).toString("base64"),
    { encoding: "base64", skipPreflight: false, preflightCommitment: "confirmed" },
  ]);
  return txSignature;
}
