/**
 * Create a Metaplex Core Collection on-chain at marketplace go-live.
 *
 * @see https://www.metaplex.com/docs/smart-contracts/core/collections/create
 * @see https://www.metaplex.com/docs/smart-contracts/core/plugins/royalties
 */

import {
  generateSigner,
  keypairIdentity,
  publicKey as umiPublicKey,
} from "@metaplex-foundation/umi";
import { createCollection, ruleSet } from "@metaplex-foundation/mpl-core";
import { base64 } from "@metaplex-foundation/umi/serializers";
import { createMintUmi, fetchLatestBlockhash } from "./mint-umi";
import { getDirectRpcUrl, type SolanaNetwork } from "./solana-config";
import { getPlatformSecretKey } from "./platform-key";
import { buildCreatorsFromRoyaltySplit } from "./metadata-builders";
import type { Collection } from "./types";
import { uploadBlobText } from "./blob-storage";

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
      ),
    },
  };

  return uploadBlobText(
    `collections/${collection.id}/collection.json`,
    JSON.stringify(payload, null, 2),
  );
}

export type CreateCoreCollectionResult = {
  address: string;
  txSignature: string;
  metadataUri: string;
};

/** Deploy Core Collection with Royalties plugin (inherits to all assets). */
export async function createMarketplaceCoreCollection(
  collection: Collection,
  network: SolanaNetwork,
): Promise<CreateCoreCollectionResult | null> {
  const platformSecret = getPlatformSecretKey();
  if (!platformSecret) return null;

  const metadataUri = await ensureCollectionMetadataUri(collection);
  const rpcUrl = getDirectRpcUrl(network);
  const umi = createMintUmi(network);

  const authorityKeypair = umi.eddsa.createKeypairFromSecretKey(platformSecret);
  umi.use(keypairIdentity(authorityKeypair, false));

  const collectionSigner = generateSigner(umi);
  const blockhash = await fetchLatestBlockhash(rpcUrl);

  const royaltyCreators = buildCreatorsFromRoyaltySplit(
    collection.payments.creatorWallet,
    collection.royaltySplit,
  ).map((c) => ({
    address: umiPublicKey(c.address),
    percentage: c.share,
  }));

  const plugins =
    royaltyCreators.length > 0
      ? [
          {
            type: "Royalties" as const,
            basisPoints: collection.royaltyBps ?? 500,
            creators: royaltyCreators,
            ruleSet: ruleSet("None"),
          },
        ]
      : undefined;

  const tx = await createCollection(umi, {
    collection: collectionSigner,
    name: collection.name.slice(0, 32),
    uri: metadataUri,
    ...(plugins ? { plugins } : {}),
  })
    .useV0()
    .setBlockhash(blockhash)
    .buildAndSign(umi);

  const serialized = umi.transactions.serialize(tx);
  const txBase64 = base64.deserialize(serialized)[0];
  const txSignature = await sendTxBase64(rpcUrl, txBase64);

  return {
    address: collectionSigner.publicKey.toString(),
    txSignature,
    metadataUri,
  };
}
