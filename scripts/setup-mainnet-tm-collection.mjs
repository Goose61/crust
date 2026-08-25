#!/usr/bin/env node
/**
 * Mainnet one-shot: upload collection metadata to Arweave (Irys) + create a
 * Token Metadata Collection NFT for verified gift grouping in Phantom.
 *
 * Prerequisites:
 *   - ARWEAVE_SOLANA_KEY in .env.local (collection update authority)
 *   - ~0.02 SOL on that wallet on mainnet (Irys upload + collection rent)
 *
 * @see https://www.metaplex.com/docs/smart-contracts/token-metadata/collections
 *
 * Usage:
 *   node scripts/setup-mainnet-tm-collection.mjs
 *   node scripts/setup-mainnet-tm-collection.mjs --dry-run
 */

import fs from "node:fs";
import path from "node:path";
import {
  createBaseUmi,
  generateSigner,
  keypairIdentity,
  createSignerFromKeypair,
  percentAmount,
  transactionBuilder,
} from "@metaplex-foundation/umi";
import { dataViewSerializer } from "@metaplex-foundation/umi-serializer-data-view";
import { defaultProgramRepository } from "@metaplex-foundation/umi-program-repository";
import { web3JsEddsa } from "@metaplex-foundation/umi-eddsa-web3js";
import { web3JsTransactionFactory } from "@metaplex-foundation/umi-transaction-factory-web3js";
import {
  createV1,
  mintV1,
  mplTokenMetadata,
  TokenStandard,
  collectionDetails,
} from "@metaplex-foundation/mpl-token-metadata";
import { mplToolbox } from "@metaplex-foundation/mpl-toolbox";
import { base64 } from "@metaplex-foundation/umi/serializers";
import { Keypair } from "@solana/web3.js";

const ALPHA = "123456789ABCDEFGHJKLMNPQRSTUVWXYZabcdefghijkmnopqrstuvwxyz";
const MIN_BALANCE_LAMPORTS = 25_000_000; // ~0.025 SOL (Irys + TM collection rent)
const COLLECTION_NAME = "Dough Boi Gifts";
const COLLECTION_SYMBOL = "DOUGH";
const COLLECTION_DESCRIPTION =
  "1/1 gift NFTs from the Dough Boi marketplace. Minted on Solana via Metaplex Token Metadata.";

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
  if (json.error) {
    throw new Error(
      `${json.error.message}${json.error.data ? `: ${JSON.stringify(json.error.data)}` : ""}`,
    );
  }
  return json.result;
}

async function simulateTx(rpcUrl, txBase64) {
  const result = await rpcCall(rpcUrl, "simulateTransaction", [
    txBase64,
    { encoding: "base64", sigVerify: true, commitment: "confirmed" },
  ]);
  const err = result?.value?.err;
  if (err) {
    throw new Error(`Simulation failed: ${JSON.stringify(err)}`);
  }
  return result;
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

/** mintV1 needs getCluster() on context.rpc for associated-token PDAs. */
function attachMinimalFetchRpc(umi, rpcUrl) {
  umi.rpc = {
    getEndpoint: () => rpcUrl,
    getCluster: () => "mainnet-beta",
    async getAccount(pubkey) {
      const result = await rpcCall(rpcUrl, "getAccountInfo", [
        pubkey.toString(),
        { encoding: "base64", commitment: "confirmed" },
      ]);
      const value = result?.value;
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

loadEnvLocal();

const dryRun = process.argv.includes("--dry-run");
const skipUpload = process.argv.includes("--skip-upload");
const uriArg = process.argv.find((a) => a.startsWith("--uri="))?.slice("--uri=".length)?.trim();
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

console.log("=== Dough Boi — Mainnet Token Metadata Collection Setup ===\n");
console.log(`Platform wallet (update authority): ${pubkey}`);
console.log(`Mainnet RPC: ${rpc}\n`);

const balanceResult = await rpcCall(rpc, "getBalance", [pubkey]);
const balance = balanceResult.value;
console.log(`Mainnet balance: ${(balance / 1e9).toFixed(6)} SOL`);

if (balance < MIN_BALANCE_LAMPORTS) {
  console.error("\n❌ Insufficient mainnet SOL on the platform wallet.");
  console.error(`   Need at least ${(MIN_BALANCE_LAMPORTS / 1e9).toFixed(3)} SOL (have ${(balance / 1e9).toFixed(6)}).`);
  console.error(`   Send SOL to: ${pubkey}`);
  console.error("   Then re-run: npm run setup:mainnet-tm-collection -- --skip-upload");
  process.exit(1);
}

if (dryRun) {
  console.log("\n✓ Dry run OK — wallet funded, ready to create TM collection.");
  process.exit(0);
}

console.log("\n1/3 Uploading collection assets to Arweave (Irys mainnet)...");

let metadataUri =
  uriArg ||
  process.env.GIFT_COLLECTION_URI?.trim() ||
  "";

if (skipUpload) {
  if (!metadataUri) {
    console.error("\n❌ --skip-upload requires GIFT_COLLECTION_URI in .env.local or --uri=<arweave-url>");
    process.exit(1);
  }
  console.log(`   Skipping upload — reusing metadata: ${metadataUri}`);
} else {
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
      creators: [{ address: pubkey, share: 100 }],
    },
  };

  const metaReceipt = await uploader.upload(JSON.stringify(metadata), {
    tags: [{ name: "Content-Type", value: "application/json" }],
  });
  metadataUri = `https://gateway.irys.xyz/${metaReceipt.id}`;
  console.log(`   Metadata: ${metadataUri}`);
}

console.log("\n2/3 Creating Token Metadata Collection NFT on mainnet...");

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
const collectionMint = generateSigner(umi);
const blockhash = await fetchBlockhash(rpc);

const tx = await transactionBuilder()
  .add(
    createV1(umi, {
      mint: collectionMint,
      authority: collectionMint,
      name: COLLECTION_NAME,
      symbol: COLLECTION_SYMBOL,
      uri: metadataUri,
      sellerFeeBasisPoints: percentAmount(0),
      tokenStandard: TokenStandard.NonFungible,
      isCollection: true,
      collectionDetails: collectionDetails("V1", { size: 0 }),
      updateAuthority: platformSigner,
      creators: [
        { address: platformSigner.publicKey, verified: true, share: 100 },
      ],
    }),
  )
  .add(
    mintV1(umi, {
      mint: collectionMint.publicKey,
      authority: platformSigner,
      tokenOwner: platformSigner.publicKey,
      tokenStandard: TokenStandard.NonFungible,
      amount: 1,
      payer: platformSigner,
    }),
  )
  .useV0()
  .setBlockhash(blockhash)
  .buildAndSign(umi);

const serialized = umi.transactions.serialize(tx);
const txBase64 = base64.deserialize(serialized)[0];
await simulateTx(rpc, txBase64);
const sig = await sendTx(rpc, txBase64);

const collectionMintAddress = collectionMint.publicKey.toString();
console.log(`   Collection mint: ${collectionMintAddress}`);
console.log(`   Tx: ${sig}`);
console.log(`   Explorer: https://explorer.solana.com/address/${collectionMintAddress}`);

console.log("\n3/3 Updating .env.local...");
upsertEnvLocal("GIFT_TM_COLLECTION_MINT", collectionMintAddress);
upsertEnvLocal("GIFT_TM_COLLECTION_MINT_MAINNET", collectionMintAddress);
upsertEnvLocal("GIFT_COLLECTION_NAME", COLLECTION_NAME);
upsertEnvLocal("GIFT_COLLECTION_URI", metadataUri);

console.log("\n✅ Mainnet Token Metadata Collection ready!\n");
console.log("Add these to Vercel → Project → Settings → Environment Variables (Production):");
console.log(`  GIFT_TM_COLLECTION_MINT=${collectionMintAddress}`);
console.log(`  GIFT_TM_COLLECTION_MINT_MAINNET=${collectionMintAddress}`);
console.log(`  GIFT_COLLECTION_NAME=${COLLECTION_NAME}`);
