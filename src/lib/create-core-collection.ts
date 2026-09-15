/**
 * Create a Metaplex Core Collection on-chain at marketplace go-live.
 * Creator pays Solana fees; platform co-signs as update authority.
 *
 * @see https://www.metaplex.com/docs/smart-contracts/core/collections/create
 */

import {
  generateSigner,
  keypairIdentity,
  createNoopSigner,
  createSignerFromKeypair,
  publicKey as umiPublicKey,
} from "@metaplex-foundation/umi";
import { createCollection, ruleSet } from "@metaplex-foundation/mpl-core";
import { base64 } from "@metaplex-foundation/umi/serializers";
import { Keypair, PublicKey, VersionedTransaction } from "@solana/web3.js";
import { createMintUmi, fetchLatestBlockhash } from "./mint-umi";
import { getDirectRpcUrl, type SolanaNetwork } from "./solana-config";
import { getPlatformSecretKey } from "./platform-key";
import { buildCreatorsFromRoyaltySplit } from "./metadata-builders";
import { isValidSolanaAddress, simulateSignedTransaction, simulateUnsignedTransaction } from "./mint-nft";
import type { Collection, PendingCoreCollection } from "./types";
import { uploadBlobText } from "./blob-storage";
import { isServerArweaveUploadAvailable, uploadToArweaveServer } from "./irys-server";

function secretKeyFromB64(b64: string): Uint8Array {
  const bytes = Buffer.from(b64, "base64");
  if (bytes.length !== 64) {
    throw new Error(`Invalid collection secret key length: ${bytes.length}`);
  }
  return new Uint8Array(bytes);
}

function secretKeyToB64(secretKey: Uint8Array): string {
  return Buffer.from(secretKey).toString("base64");
}

async function sendTxBase64(rpcUrl: string, txBase64: string): Promise<string> {
  const res = await fetch(rpcUrl, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({
      jsonrpc: "2.0",
      id: 1,
      method: "sendTransaction",
      params: [
        txBase64,
        { encoding: "base64", skipPreflight: false, preflightCommitment: "confirmed" },
      ],
    }),
    signal: AbortSignal.timeout(60_000),
  });
  const json = (await res.json()) as { result?: string; error?: { message: string } };
  if (json.error) throw new Error(json.error.message);
  if (!json.result) throw new Error("sendTransaction returned no signature");
  return json.result;
}

/** Upload collection-level metadata JSON; returns public URI. */
export async function ensureCollectionMetadataUri(collection: Collection): Promise<string> {
  const image =
    collection.logoUrl?.startsWith("http")
      ? collection.logoUrl
      : collection.tokens[0]?.imageUri?.startsWith("http")
        ? collection.tokens[0].imageUri
        : `/api/assets/${collection.id}/placeholder`;

  const payload = {
    name: collection.name,
    symbol: collection.symbol,
    description: collection.description,
    image,
    seller_fee_basis_points: collection.royaltyBps ?? 500,
    external_url: collection.socials?.website ?? undefined,
    properties: {
      category: "image",
      creators: buildCreatorsFromRoyaltySplit(
        collection.payments.creatorWallet,
        collection.royaltySplit,
        collection.royaltyCreators,
      ),
    },
  };

  const json = JSON.stringify(payload, null, 2);

  if (isServerArweaveUploadAvailable()) {
    return uploadToArweaveServer(Buffer.from(json, "utf8"), "application/json", {
      skipFund: true,
      paidBy: collection.payments.creatorWallet || undefined,
    });
  }

  return uploadBlobText(`collections/${collection.id}/collection.json`, json);
}

async function buildUnsignedCoreCollectionTx(params: {
  collection: Collection;
  network: SolanaNetwork;
  metadataUri: string;
  payer: string;
  collectionSecretKey?: Uint8Array;
}): Promise<{
  txBase64: string;
  collectionAddress: string;
  collectionSecretKey: Uint8Array;
}> {
  const platformSecret = getPlatformSecretKey();
  if (!platformSecret) {
    throw new Error("On-chain collection creation is not configured on this deployment.");
  }

  const rpcUrl = getDirectRpcUrl(params.network);
  const umi = createMintUmi(params.network);
  const authorityKeypair = umi.eddsa.createKeypairFromSecretKey(platformSecret);
  const authoritySigner = createSignerFromKeypair(umi, authorityKeypair);
  umi.use(keypairIdentity(authorityKeypair, false));

  const collectionSigner = params.collectionSecretKey
    ? createSignerFromKeypair(umi, umi.eddsa.createKeypairFromSecretKey(params.collectionSecretKey))
    : generateSigner(umi);

  const payer = createNoopSigner(umiPublicKey(params.payer));
  const blockhash = await fetchLatestBlockhash(rpcUrl);

  const royaltyCreators = buildCreatorsFromRoyaltySplit(
    params.collection.payments.creatorWallet,
    params.collection.royaltySplit,
    params.collection.royaltyCreators,
  ).map((c) => ({
    address: umiPublicKey(c.address),
    percentage: c.share,
  }));

  const plugins =
    royaltyCreators.length > 0
      ? [
          {
            type: "Royalties" as const,
            basisPoints: params.collection.royaltyBps ?? 500,
            creators: royaltyCreators,
            ruleSet: ruleSet("None"),
          },
        ]
      : undefined;

  const tx = await createCollection(umi, {
    collection: collectionSigner,
    updateAuthority: authoritySigner.publicKey,
    payer,
    name: params.collection.name.slice(0, 32),
    uri: params.metadataUri,
    ...(plugins ? { plugins } : {}),
  })
    .useV0()
    .setFeePayer(payer)
    .setBlockhash(blockhash)
    .build(umi);

  const serialized = umi.transactions.serialize(tx);
  const txBase64 = base64.deserialize(serialized)[0];

  return {
    txBase64,
    collectionAddress: collectionSigner.publicKey.toString(),
    collectionSecretKey: collectionSigner.secretKey,
  };
}

function signatureIsPresent(sig: Uint8Array | null | undefined): boolean {
  return Boolean(sig && sig.length > 0 && !sig.every((b) => b === 0));
}

function assertUserSignedCoreCollectionTx(
  tx: VersionedTransaction,
  pending: PendingCoreCollection,
): void {
  const keys = tx.message.staticAccountKeys;
  if (keys.length === 0) {
    throw new Error("Signed transaction has no accounts.");
  }

  if (keys[0].toBase58() !== pending.payer) {
    throw new Error("Transaction fee payer does not match your connected wallet.");
  }

  const collectionPk = new PublicKey(pending.collectionAddress);
  if (!keys.some((k) => k.equals(collectionPk))) {
    throw new Error("Transaction does not include the expected Core collection address.");
  }

  if (!signatureIsPresent(tx.signatures[0])) {
    throw new Error("Transaction is missing your wallet signature.");
  }
}

export async function prepareCoreCollectionTransaction(params: {
  collection: Collection;
  payer: string;
  network: SolanaNetwork;
}): Promise<{
  txBase64: string;
  collectionAddress: string;
  metadataUri: string;
  pendingCoreCollection: PendingCoreCollection;
}> {
  if (!isValidSolanaAddress(params.payer)) {
    throw new Error("Valid creator wallet required.");
  }

  let pending = params.collection.pendingCoreCollection;
  if (
    !pending ||
    pending.payer !== params.payer ||
    !pending.collectionSecretKeyB64
  ) {
    const metadataUri = await ensureCollectionMetadataUri(params.collection);
    const built = await buildUnsignedCoreCollectionTx({
      collection: params.collection,
      network: params.network,
      metadataUri,
      payer: params.payer,
    });
    pending = {
      collectionSecretKeyB64: secretKeyToB64(built.collectionSecretKey),
      collectionAddress: built.collectionAddress,
      metadataUri,
      payer: params.payer,
    };
  }

  if (!pending.collectionSecretKeyB64) {
    throw new Error("Pending Core collection key missing — prepare again.");
  }

  const built = await buildUnsignedCoreCollectionTx({
    collection: params.collection,
    network: params.network,
    metadataUri: pending.metadataUri,
    payer: params.payer,
    collectionSecretKey: secretKeyFromB64(pending.collectionSecretKeyB64),
  });

  if (built.collectionAddress !== pending.collectionAddress) {
    throw new Error("Core collection address mismatch when refreshing transaction.");
  }

  await simulateUnsignedTransaction(built.txBase64, params.network);

  return {
    txBase64: built.txBase64,
    collectionAddress: pending.collectionAddress,
    metadataUri: pending.metadataUri,
    pendingCoreCollection: {
      ...pending,
      preparedTxBase64: built.txBase64,
    },
  };
}

export async function cosignAndSubmitCoreCollectionTransaction(params: {
  userSignedTxBase64: string;
  pending: PendingCoreCollection;
  network: SolanaNetwork;
}): Promise<string> {
  if (!params.pending.collectionSecretKeyB64) {
    throw new Error("Missing pending Core collection key — prepare the transaction again.");
  }

  const rpcUrl = getDirectRpcUrl(params.network);
  const tx = VersionedTransaction.deserialize(
    Buffer.from(params.userSignedTxBase64, "base64"),
  );

  assertUserSignedCoreCollectionTx(tx, params.pending);

  const collectionKp = Keypair.fromSecretKey(
    secretKeyFromB64(params.pending.collectionSecretKeyB64),
  );

  if (collectionKp.publicKey.toBase58() !== params.pending.collectionAddress) {
    throw new Error("Pending collection key does not match stored address.");
  }

  // Only the new collection account signs — updateAuthority is a pubkey, not a signer.
  tx.sign([collectionKp]);

  await simulateSignedTransaction(tx, params.network);

  const txBase64 = Buffer.from(tx.serialize()).toString("base64");
  return sendTxBase64(rpcUrl, txBase64);
}
