#!/usr/bin/env node
/**
 * One-shot: verify the platform creator on an existing Token Metadata gift NFT.
 *
 * Usage:
 *   node scripts/verify-gift-creator.mjs <mint-address>
 *   node scripts/verify-gift-creator.mjs 7KYhPtmZ7yZnat2T4JPgiUfmFhEnugrqLYqz3cJ8o74A
 *
 * Requires ARWEAVE_SOLANA_KEY in .env.local (metadata update authority / creator).
 */

import fs from "node:fs";
import {
  createBaseUmi,
  keypairIdentity,
  createSignerFromKeypair,
  transactionBuilder,
} from "@metaplex-foundation/umi";
import { dataViewSerializer } from "@metaplex-foundation/umi-serializer-data-view";
import { defaultProgramRepository } from "@metaplex-foundation/umi-program-repository";
import { web3JsEddsa } from "@metaplex-foundation/umi-eddsa-web3js";
import { web3JsTransactionFactory } from "@metaplex-foundation/umi-transaction-factory-web3js";
import {
  mplTokenMetadata,
  verifyCreatorV1,
  findMetadataPda,
} from "@metaplex-foundation/mpl-token-metadata";
import { mplToolbox } from "@metaplex-foundation/mpl-toolbox";
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

loadEnvLocal();

const mint = process.argv[2]?.trim();
if (!mint) {
  console.error("Usage: node scripts/verify-gift-creator.mjs <mint-address>");
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

const metadata = findMetadataPda(umi, { mint });
const blockhash = (await rpcCall(rpc, "getLatestBlockhash", [{ commitment: "confirmed" }])).value;

const tx = await transactionBuilder()
  .add(
    verifyCreatorV1(umi, {
      authority: platformSigner,
      metadata,
    }),
  )
  .setBlockhash(blockhash)
  .buildAndSign(umi);

const txBase64 = base64.deserialize(umi.transactions.serialize(tx))[0];
const sig = await rpcCall(rpc, "sendTransaction", [
  txBase64,
  { encoding: "base64", skipPreflight: false, preflightCommitment: "confirmed" },
]);

console.log(`Verified creator on mint ${mint}`);
console.log(`Tx: ${sig}`);
console.log(`Explorer: https://explorer.solana.com/tx/${sig}`);
