#!/usr/bin/env node
/**
 * One-time setup: create a Metaplex Core Collection for verified gift mints.
 *
 * @see https://www.metaplex.com/docs/smart-contracts/core/collections
 * @see https://www.metaplex.com/docs/smart-contracts/core/sdk/javascript
 *
 * Usage:
 *   node scripts/create-core-collection.mjs --name "Dough Boi Gifts" --uri "https://arweave.net/..."
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

const ALPHA = "123456789ABCDEFGHJKLMNPQRSTUVWXYZabcdefghijkmnopqrstuvwxyz";

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

function arg(name, fallback) {
  const idx = process.argv.indexOf(name);
  if (idx >= 0 && process.argv[idx + 1]) return process.argv[idx + 1];
  return fallback;
}

async function fetchBlockhash(rpcUrl) {
  const res = await fetch(rpcUrl, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({
      jsonrpc: "2.0",
      id: 1,
      method: "getLatestBlockhash",
      params: [{ commitment: "confirmed" }],
    }),
  });
  const json = await res.json();
  if (json.error) throw new Error(json.error.message);
  return json.result.value;
}

async function sendTx(rpcUrl, txBase64) {
  const res = await fetch(rpcUrl, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({
      jsonrpc: "2.0",
      id: 1,
      method: "sendTransaction",
      params: [txBase64, { encoding: "base64", skipPreflight: false, preflightCommitment: "confirmed" }],
    }),
  });
  const json = await res.json();
  if (json.error) throw new Error(json.error.message);
  return json.result;
}

loadEnvLocal();

const name = arg("--name", process.env.CORE_COLLECTION_NAME ?? "Dough Boi Gifts");
const uri = arg("--uri", process.env.CORE_COLLECTION_URI ?? "");
const network = (process.env.SOLANA_NETWORK ?? "devnet").toLowerCase();

if (!uri.startsWith("http")) {
  console.error("Provide --uri or CORE_COLLECTION_URI (HTTPS Arweave/IPFS metadata JSON).");
  process.exit(1);
}

const rawKey = process.env.ARWEAVE_SOLANA_KEY;
if (!rawKey) {
  console.error("ARWEAVE_SOLANA_KEY is required in .env.local");
  process.exit(1);
}

const rpc =
  network === "mainnet"
    ? (process.env.SOLANA_RPC_URL_MAINNET ?? "https://api.mainnet-beta.solana.com")
    : (process.env.SOLANA_RPC_URL_DEVNET ?? "https://api.devnet.solana.com");

const secret = rawKey.trim().startsWith("[")
  ? new Uint8Array(JSON.parse(rawKey))
  : b58decode(rawKey);

const umi = createBaseUmi();
umi.use(dataViewSerializer());
umi.use(defaultProgramRepository());
umi.use(web3JsEddsa());
umi.use(web3JsTransactionFactory());
umi.use(mplCore());
umi.use(keypairIdentity(umi.eddsa.createKeypairFromSecretKey(secret)));

const collectionSigner = generateSigner(umi);
const blockhash = await fetchBlockhash(rpc);

console.log(`Creating Core Collection on ${network}...`);
console.log(`  Name: ${name}`);
console.log(`  URI:  ${uri}`);

const tx = await createCollection(umi, {
  collection: collectionSigner,
  name,
  uri,
})
  .useV0()
  .setBlockhash(blockhash)
  .buildAndSign(umi);

const serialized = umi.transactions.serialize(tx);
const txBase64 = base64.deserialize(serialized)[0];
const sig = await sendTx(rpc, txBase64);

const address = collectionSigner.publicKey.toString();
console.log("\n✅ Core Collection created");
console.log(`  Address:    ${address}`);
console.log(`  Signature:  ${sig}`);
console.log(`  Explorer:   https://explorer.solana.com/address/${address}?cluster=${network}`);
console.log("\nAdd to .env.local and Vercel:");
console.log(`  CORE_COLLECTION_ADDRESS=${address}`);
console.log(`  CORE_COLLECTION_ADDRESS_${network.toUpperCase()}=${address}`);
