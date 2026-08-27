#!/usr/bin/env node
/**
 * Update Token Metadata collection NFT (parent) — Phantom uses its on-chain name
 * as the primary Collectibles group label and may spam-score the whole collection.
 *
 * Usage: node scripts/update-tm-collection-metadata.mjs [--dry-run]
 */

import fs from "node:fs";
import {
  createBaseUmi,
  keypairIdentity,
  createSignerFromKeypair,
  transactionBuilder,
  some,
  none,
} from "@metaplex-foundation/umi";
import { dataViewSerializer } from "@metaplex-foundation/umi-serializer-data-view";
import { defaultProgramRepository } from "@metaplex-foundation/umi-program-repository";
import { web3JsEddsa } from "@metaplex-foundation/umi-eddsa-web3js";
import { web3JsTransactionFactory } from "@metaplex-foundation/umi-transaction-factory-web3js";
import {
  mplTokenMetadata,
  updateV1,
  fetchMetadataFromSeeds,
  collectionToggle,
  collectionDetailsToggle,
  usesToggle,
  ruleSetToggle,
} from "@metaplex-foundation/mpl-token-metadata";
import { mplToolbox } from "@metaplex-foundation/mpl-toolbox";
import { base64 } from "@metaplex-foundation/umi/serializers";

const ALPHA = "123456789ABCDEFGHJKLMNPQRSTUVWXYZabcdefghijkmnopqrstuvwxyz";
const COLLECTION_MINT =
  process.env.GIFT_TM_COLLECTION_MINT_MAINNET?.trim() ||
  process.env.GIFT_TM_COLLECTION_MINT?.trim() ||
  "EvqCrB2A3c7oaJTu24oVCTx9mCML6A6sr3aXZvPrZfwo";
const ON_CHAIN_NAME = "Dough Boi";
const ON_CHAIN_SYMBOL = "DOUGH";
const EXTERNAL_URL = "https://www.thecrust.io";

function b58decode(s) {
  const bytes = [];
  for (const c of s.trim()) {
    let carry = ALPHA.indexOf(c);
    if (carry < 0) throw new Error("Invalid base58 in ARWEAVE_SOLANA_KEY");
    for (let j = 0; j < bytes.length; j++) {
      carry += bytes[j] * 58;
      bytes[j] = carry & 255;
      carry >>= 8;
    }
    while (carry > 0) {
      bytes.push(carry & 255);
      carry >>= 8;
    }
  }
  for (const c of s) {
    if (c !== "1") break;
    bytes.unshift(0);
  }
  return Uint8Array.from(bytes.reverse());
}

function loadEnvLocal() {
  const envPath = ".env.local";
  if (!fs.existsSync(envPath)) return;
  for (const line of fs.readFileSync(envPath, "utf8").split("\n")) {
    const m = line.match(/^([^#=]+)=(.*)$/);
    if (m) process.env[m[1].trim()] = m[2].trim().replace(/^["']|["']$/g, "");
  }
}

function attachMinimalFetchRpc(umi, rpcUrl) {
  umi.rpc = {
    getEndpoint: () => rpcUrl,
    getCluster: () => "mainnet-beta",
    async getAccount(pubkey) {
      const res = await fetch(rpcUrl, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          jsonrpc: "2.0",
          id: 1,
          method: "getAccountInfo",
          params: [pubkey.toString(), { encoding: "base64", commitment: "confirmed" }],
        }),
      });
      const json = await res.json();
      const value = json.result?.value;
      if (!value) return { exists: false, publicKey: pubkey };
      return {
        exists: true,
        publicKey: pubkey,
        lamports: { basisPoints: BigInt(value.lamports ?? 0), identifier: "SOL", decimals: 9 },
        owner: value.owner,
        executable: value.executable ?? false,
        data: Buffer.from(value.data[0], "base64"),
      };
    },
    async getAccounts(pubkeys, options) {
      return Promise.all(pubkeys.map((pk) => this.getAccount(pk, options)));
    },
  };
}

async function rpcCall(rpcUrl, method, params) {
  const res = await fetch(rpcUrl, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ jsonrpc: "2.0", id: 1, method, params }),
  });
  const json = await res.json();
  if (json.error) throw new Error(json.error.message);
  return json.result;
}

function trimNull(s) {
  return s.replace(/\0/g, "").trim();
}

loadEnvLocal();

const dryRun = process.argv.includes("--dry-run");
const rawKey = process.env.ARWEAVE_SOLANA_KEY;
if (!rawKey) {
  console.error("ARWEAVE_SOLANA_KEY missing from .env.local");
  process.exit(1);
}

const rpc =
  process.env.SOLANA_RPC_URL_MAINNET?.trim() ||
  "https://api.mainnet-beta.solana.com";

const secret = rawKey.trim().startsWith("[")
  ? new Uint8Array(JSON.parse(rawKey))
  : b58decode(rawKey);

const umi = createBaseUmi();
umi.use(dataViewSerializer());
umi.use(defaultProgramRepository());
umi.use(web3JsEddsa());
umi.use(web3JsTransactionFactory());
umi.use(mplTokenMetadata());
umi.use(mplToolbox());
attachMinimalFetchRpc(umi, rpc);
umi.use(keypairIdentity(umi.eddsa.createKeypairFromSecretKey(secret)));

const platformSigner = createSignerFromKeypair(
  umi,
  umi.eddsa.createKeypairFromSecretKey(secret),
);

const onChain = await fetchMetadataFromSeeds(umi, { mint: COLLECTION_MINT });
const oldUri = trimNull(onChain.uri);
const oldRes = await fetch(oldUri);
if (!oldRes.ok) throw new Error(`Failed to fetch ${oldUri}`);
const oldJson = await oldRes.json();

const newJson = {
  name: ON_CHAIN_NAME,
  description: "1/1 $PIZZA collectibles from Dough Boi. Minted on Solana.",
  image: oldJson.image,
  external_url: EXTERNAL_URL,
  seller_fee_basis_points: 0,
  properties: {
    category: "image",
    files: oldJson.properties?.files ?? [{ uri: oldJson.image, type: "image/svg+xml" }],
    creators: oldJson.properties?.creators ?? [
      { address: platformSigner.publicKey, share: 100 },
    ],
  },
};

console.log("Collection mint:", COLLECTION_MINT);
console.log("On-chain name:", trimNull(onChain.name), "→", ON_CHAIN_NAME);
console.log("Old URI:", oldUri);
console.log("Old off-chain name:", oldJson.name, "→", newJson.name);

if (dryRun) {
  console.log("Dry run — would upload and update on-chain.");
  process.exit(0);
}

const { Uploader } = await import("@irys/upload");
const solanaMod = await import("@irys/upload-solana");
const Solana = solanaMod.Solana ?? solanaMod.default;
const uploader = await Uploader(Solana).withWallet(rawKey.trim()).mainnet();
const receipt = await uploader.upload(JSON.stringify(newJson, null, 2), {
  tags: [{ name: "Content-Type", value: "application/json" }],
});
const newUri = `https://gateway.irys.xyz/${receipt.id}`;
console.log("New URI:", newUri);

const creators =
  onChain.creators.__option === "Some"
    ? onChain.creators.value.map((c) => ({
        address: c.address,
        verified: c.verified,
        share: c.share,
      }))
    : [];

const blockhash = (await rpcCall(rpc, "getLatestBlockhash", [{ commitment: "confirmed" }])).value;
const tx = await transactionBuilder()
  .add(
    updateV1(umi, {
      mint: COLLECTION_MINT,
      authority: platformSigner,
      data: some({
        name: ON_CHAIN_NAME,
        symbol: ON_CHAIN_SYMBOL,
        uri: newUri,
        sellerFeeBasisPoints: onChain.sellerFeeBasisPoints,
        creators: creators.length ? some(creators) : none(),
      }),
      collection: collectionToggle("None"),
      collectionDetails: collectionDetailsToggle("None"),
      uses: usesToggle("None"),
      ruleSet: ruleSetToggle("None"),
    }),
  )
  .setBlockhash(blockhash)
  .buildAndSign(umi);

const txBase64 = base64.deserialize(umi.transactions.serialize(tx))[0];
const sig = await rpcCall(rpc, "sendTransaction", [
  txBase64,
  { encoding: "base64", skipPreflight: false, preflightCommitment: "confirmed" },
]);

console.log("Updated collection NFT metadata.");
console.log(`Tx: ${sig}`);
console.log(`Explorer: https://explorer.solana.com/tx/${sig}`);
