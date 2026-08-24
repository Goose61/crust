#!/usr/bin/env node
/**
 * Mainnet one-shot: upload collection metadata to Arweave (Irys) + create Metaplex Core Collection.
 *
 * Prerequisites:
 *   - ARWEAVE_SOLANA_KEY in .env.local (collection update authority)
 *   - ~0.02 SOL on that wallet on mainnet (Irys upload + collection rent)
 *
 * @see https://www.metaplex.com/docs/smart-contracts/core/collections
 * @see https://docs.irys.xyz/build/d/quickstart
 *
 * Usage:
 *   node scripts/setup-mainnet-core-collection.mjs
 *   node scripts/setup-mainnet-core-collection.mjs --dry-run
 */

import fs from "node:fs";
import path from "node:path";
import { createBaseUmi, generateSigner, keypairIdentity } from "@metaplex-foundation/umi";
import { dataViewSerializer } from "@metaplex-foundation/umi-serializer-data-view";
import { defaultProgramRepository } from "@metaplex-foundation/umi-program-repository";
import { web3JsEddsa } from "@metaplex-foundation/umi-eddsa-web3js";
import { web3JsTransactionFactory } from "@metaplex-foundation/umi-transaction-factory-web3js";
import { createCollection, mplCore } from "@metaplex-foundation/mpl-core";
import { base64 } from "@metaplex-foundation/umi/serializers";
import { Keypair } from "@solana/web3.js";

const ALPHA = "123456789ABCDEFGHJKLMNPQRSTUVWXYZabcdefghijkmnopqrstuvwxyz";
const MIN_BALANCE_LAMPORTS = 15_000_000; // ~0.015 SOL buffer
const COLLECTION_NAME = "Dough Boi Gifts";
const COLLECTION_DESCRIPTION =
  "1/1 gift NFTs from the Dough Boi marketplace. Minted on Solana via Metaplex Core.";

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
  const envPath = path.join(process.cwd(), ".env.local");
  if (!fs.existsSync(envPath)) return;
  for (const line of fs.readFileSync(envPath, "utf8").split("\n")) {
    const m = line.match(/^([^#=]+)=(.*)$/);
    if (m) process.env[m[1].trim()] = m[2].trim().replace(/^["']|["']$/g, "");
  }
}

function upsertEnvLocal(key, value) {
  const envPath = path.join(process.cwd(), ".env.local");
  let lines = fs.existsSync(envPath) ? fs.readFileSync(envPath, "utf8").split("\n") : [];
  const prefix = `${key}=`;
  let found = false;
  lines = lines.map((line) => {
    if (line.startsWith(prefix)) {
      found = true;
      return `${key}=${value}`;
    }
    return line;
  });
  if (!found) lines.push(`${key}=${value}`);
  fs.writeFileSync(envPath, lines.filter((l, i, a) => !(i === a.length - 1 && l === "")).join("\n") + "\n");
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

async function fetchBlockhash(rpcUrl) {
  const result = await rpcCall(rpcUrl, "getLatestBlockhash", [{ commitment: "confirmed" }]);
  return result.value;
}

async function sendTx(rpcUrl, txBase64) {
  return rpcCall(rpcUrl, "sendTransaction", [
    txBase64,
    { encoding: "base64", skipPreflight: false, preflightCommitment: "confirmed" },
  ]);
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
const keypair = Keypair.fromSecretKey(secret);
const pubkey = keypair.publicKey.toBase58();

console.log("=== Dough Boi — Mainnet Core Collection Setup ===\n");
console.log(`Platform wallet (update authority): ${pubkey}`);
console.log(`Mainnet RPC: ${rpc}\n`);

const balanceResult = await rpcCall(rpc, "getBalance", [pubkey]);
const balance = balanceResult.value;
console.log(`Mainnet balance: ${(balance / 1e9).toFixed(6)} SOL`);

if (balance < MIN_BALANCE_LAMPORTS) {
  console.error("\n❌ Insufficient mainnet SOL on the platform wallet.");
  console.error(`   Send at least 0.02 SOL to: ${pubkey}`);
  console.error("   Then re-run: node scripts/setup-mainnet-core-collection.mjs");
  process.exit(1);
}

if (dryRun) {
  console.log("\n✓ Dry run OK — wallet funded, ready to create collection.");
  process.exit(0);
}

// --- Upload collection image + metadata to Arweave via Irys (mainnet) ---
console.log("\n1/3 Uploading collection assets to Arweave (Irys mainnet)...");

const logoPath = path.join(process.cwd(), "public/images/logo/logo.svg");
if (!fs.existsSync(logoPath)) {
  console.error(`Logo not found: ${logoPath}`);
  process.exit(1);
}
const logoBuf = fs.readFileSync(logoPath);

const { Uploader } = await import("@irys/upload");
const solanaMod = await import("@irys/upload-solana");
const Solana = solanaMod.Solana ?? solanaMod.default;
const uploader = await Uploader(Solana).withWallet(rawKey.trim()).mainnet();

const imageReceipt = await uploader.upload(logoBuf, {
  tags: [{ name: "Content-Type", value: "image/svg+xml" }],
});
const imageUri = `https://gateway.irys.xyz/${imageReceipt.id}`;
console.log(`   Image: ${imageUri}`);

const metadata = {
  name: COLLECTION_NAME,
  description: COLLECTION_DESCRIPTION,
  image: imageUri,
  external_url: "https://crust.vercel.app/gift",
  seller_fee_basis_points: 0,
  properties: {
    category: "image",
    files: [{ uri: imageUri, type: "image/svg+xml" }],
  },
};

const metaReceipt = await uploader.upload(JSON.stringify(metadata), {
  tags: [{ name: "Content-Type", value: "application/json" }],
});
const metadataUri = `https://gateway.irys.xyz/${metaReceipt.id}`;
console.log(`   Metadata: ${metadataUri}`);

// --- Create Metaplex Core Collection ---
console.log("\n2/3 Creating Metaplex Core Collection on mainnet...");

const umi = createBaseUmi();
umi.use(dataViewSerializer());
umi.use(defaultProgramRepository());
umi.use(web3JsEddsa());
umi.use(web3JsTransactionFactory());
umi.use(mplCore());
umi.use(keypairIdentity(umi.eddsa.createKeypairFromSecretKey(secret)));

const collectionSigner = generateSigner(umi);
const blockhash = await fetchBlockhash(rpc);

const tx = await createCollection(umi, {
  collection: collectionSigner,
  name: COLLECTION_NAME,
  uri: metadataUri,
})
  .useV0()
  .setBlockhash(blockhash)
  .buildAndSign(umi);

const serialized = umi.transactions.serialize(tx);
const txBase64 = base64.deserialize(serialized)[0];
const sig = await sendTx(rpc, txBase64);

const collectionAddress = collectionSigner.publicKey.toString();
console.log(`   Collection: ${collectionAddress}`);
console.log(`   Tx: ${sig}`);
console.log(`   Explorer: https://explorer.solana.com/address/${collectionAddress}`);

// --- Update .env.local ---
console.log("\n3/3 Updating .env.local...");
upsertEnvLocal("CORE_COLLECTION_ADDRESS", collectionAddress);
upsertEnvLocal("CORE_COLLECTION_ADDRESS_MAINNET", collectionAddress);
upsertEnvLocal("CORE_COLLECTION_URI", metadataUri);
upsertEnvLocal("CORE_COLLECTION_NAME", COLLECTION_NAME);

console.log("\n✅ Mainnet Core Collection ready!\n");
console.log("Add these to Vercel → Project → Settings → Environment Variables (Production):");
console.log(`  CORE_COLLECTION_ADDRESS=${collectionAddress}`);
console.log(`  CORE_COLLECTION_ADDRESS_MAINNET=${collectionAddress}`);
console.log("\nThen redeploy. Gift mints will appear under this verified collection in Phantom.");
