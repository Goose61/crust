#!/usr/bin/env node
/**
 * Re-upload sanitized off-chain metadata + point on-chain URI at the new Arweave JSON.
 *
 * Usage:
 *   node scripts/update-gift-metadata.mjs <mint> [<mint2> ...]
 *   node scripts/update-gift-metadata.mjs --dry-run <mint>
 *
 * Requires ARWEAVE_SOLANA_KEY (platform update authority) in .env.local.
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
const PLATFORM_CREATOR = "7XMYnfFKXY9XyHhLfjFeYb88qWea4N9W5gwFF91TGJ3y";
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

/** Strip Phantom spam heuristics while preserving user content. */
export function sanitizeGiftOffChainMetadata(meta) {
  const next = structuredClone(meta);

  next.external_url = EXTERNAL_URL;

  if (Array.isArray(next.attributes)) {
    next.attributes = next.attributes.map((attr) => {
      const trait = attr.trait_type?.trim();
      if (trait === "Gifted by") {
        return { trait_type: "From", value: attr.value };
      }
      if (trait === "Type" && String(attr.value).toLowerCase() === "gift") {
        return { trait_type: "Type", value: "Dough Boi" };
      }
      return attr;
    });
  }

  if (next.collection && typeof next.collection === "object") {
    if (String(next.collection.name).toLowerCase().includes("gift")) {
      next.collection.name = "Dough Boi";
    }
    next.collection.family = next.collection.family || "Dough Boi";
  }

  return next;
}

async function uploadJson(uploader, json) {
  const receipt = await uploader.upload(JSON.stringify(json, null, 2), {
    tags: [{ name: "Content-Type", value: "application/json" }],
  });
  return `https://gateway.irys.xyz/${receipt.id}`;
}

async function updateMint({ umi, rpc, uploader, platformSigner, mint, dryRun }) {
  const onChain = await fetchMetadataFromSeeds(umi, { mint });
  const name = trimNull(onChain.name);
  const symbol = trimNull(onChain.symbol);
  const oldUri = trimNull(onChain.uri);

  if (onChain.updateAuthority !== platformSigner.publicKey) {
    throw new Error(
      `Update authority mismatch for ${mint}: expected ${platformSigner.publicKey}, got ${onChain.updateAuthority}`,
    );
  }
  if (!onChain.isMutable) {
    throw new Error(`Metadata for ${mint} is immutable — cannot update URI`);
  }

  const res = await fetch(oldUri);
  if (!res.ok) throw new Error(`Failed to fetch ${oldUri}: HTTP ${res.status}`);
  const oldJson = await res.json();
  const newJson = sanitizeGiftOffChainMetadata(oldJson);

  console.log(`\n=== ${mint} (${name}) ===`);
  console.log("Old URI:", oldUri);
  console.log("Sanitized changes:");
  console.log("  external_url:", oldJson.external_url, "→", newJson.external_url);
  console.log(
    "  attributes:",
    JSON.stringify(oldJson.attributes?.map((a) => a.trait_type)),
    "→",
    JSON.stringify(newJson.attributes?.map((a) => a.trait_type)),
  );
  console.log(
    "  collection.name:",
    oldJson.collection?.name,
    "→",
    newJson.collection?.name,
  );

  if (dryRun) {
    console.log("Dry run — no upload or on-chain update.");
    return null;
  }

  const newUri = await uploadJson(uploader, newJson);
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
        mint,
        authority: platformSigner,
        data: some({
          name,
          symbol,
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

  console.log(`Updated on-chain URI for ${mint}`);
  console.log(`Tx: ${sig}`);
  console.log(`Explorer: https://explorer.solana.com/tx/${sig}`);
  return { mint, newUri, sig };
}

loadEnvLocal();

const dryRun = process.argv.includes("--dry-run");
const mints = process.argv
  .slice(2)
  .filter((a) => !a.startsWith("--"))
  .map((m) => m.trim())
  .filter(Boolean);

if (!mints.length) {
  console.error("Usage: node scripts/update-gift-metadata.mjs [--dry-run] <mint> [<mint2> ...]");
  process.exit(1);
}

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

let uploader = null;
if (!dryRun) {
  const { Uploader } = await import("@irys/upload");
  const solanaMod = await import("@irys/upload-solana");
  const Solana = solanaMod.Solana ?? solanaMod.default;
  uploader = await Uploader(Solana).withWallet(rawKey.trim()).mainnet();
}

const results = [];
for (const mint of mints) {
  results.push(await updateMint({ umi, rpc, uploader, platformSigner, mint, dryRun }));
  if (!dryRun && mints.length > 1) await new Promise((r) => setTimeout(r, 3000));
}

if (!dryRun) {
  console.log("\nDone. Ask the owner to refresh Phantom Collectibles (pull to refresh).");
  console.log("If still hidden, open Collectibles → Hidden and mark Not spam.");
}
