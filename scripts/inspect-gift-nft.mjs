#!/usr/bin/env node
/**
 * Inspect on-chain + off-chain metadata for a Token Metadata gift NFT.
 *
 * Usage: node scripts/inspect-gift-nft.mjs <mint> [<mint2> ...]
 */

import fs from "node:fs";
import { createBaseUmi } from "@metaplex-foundation/umi";
import { dataViewSerializer } from "@metaplex-foundation/umi-serializer-data-view";
import { defaultProgramRepository } from "@metaplex-foundation/umi-program-repository";
import { web3JsEddsa } from "@metaplex-foundation/umi-eddsa-web3js";
import { web3JsTransactionFactory } from "@metaplex-foundation/umi-transaction-factory-web3js";
import {
  mplTokenMetadata,
  fetchMetadataFromSeeds,
} from "@metaplex-foundation/mpl-token-metadata";
import { mplToolbox } from "@metaplex-foundation/mpl-toolbox";

const SPAM_KEYWORDS = [
  "gift",
  "free",
  "airdrop",
  "limited",
  "claim",
  "winner",
  "congratulations",
];

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

function trimNull(s) {
  return s.replace(/\0/g, "").trim();
}

function findSpamHits(obj, path = "") {
  const hits = [];
  const walk = (value, p) => {
    if (typeof value === "string") {
      const lower = value.toLowerCase();
      for (const kw of SPAM_KEYWORDS) {
        if (lower.includes(kw)) hits.push({ path: p, keyword: kw, value });
      }
    } else if (Array.isArray(value)) {
      value.forEach((v, i) => walk(v, `${p}[${i}]`));
    } else if (value && typeof value === "object") {
      for (const [k, v] of Object.entries(value)) walk(v, p ? `${p}.${k}` : k);
    }
  };
  walk(obj, path);
  return hits;
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

async function inspectMint(umi, rpc, mint) {
  const meta = await fetchMetadataFromSeeds(umi, { mint });
  const name = trimNull(meta.name);
  const symbol = trimNull(meta.symbol);
  const uri = trimNull(meta.uri);

  let offChain = null;
  let offChainError = null;
  let imageStatus = null;
  if (uri.startsWith("http")) {
    try {
      const res = await fetch(uri);
      if (!res.ok) throw new Error(`HTTP ${res.status}`);
      offChain = await res.json();
      if (offChain?.image) {
        const img = await fetch(offChain.image, { method: "HEAD" });
        imageStatus = img.ok ? "ok" : `HTTP ${img.status}`;
      }
    } catch (e) {
      offChainError = e.message;
    }
  }

  const creators = meta.creators.__option === "Some" ? meta.creators.value : [];
  const collection =
    meta.collection.__option === "Some"
      ? {
          key: meta.collection.value.key,
          verified: meta.collection.value.verified,
        }
      : null;

  const spamHits = offChain ? findSpamHits(offChain) : [];

  return {
    mint,
    onChain: {
      name,
      symbol,
      uri,
      updateAuthority: meta.updateAuthority,
      isMutable: meta.isMutable,
      tokenStandard:
        meta.tokenStandard.__option === "Some" ? meta.tokenStandard.value : null,
      sellerFeeBasisPoints: meta.sellerFeeBasisPoints,
      creators: creators.map((c) => ({
        address: c.address,
        verified: c.verified,
        share: c.share,
      })),
      collection,
    },
    offChain: offChainError ? { error: offChainError } : offChain,
    imageStatus,
    phantomRisk: {
      spamKeywordHits: spamHits,
      likelyHiddenReasons: [
        ...(spamHits.length ? ["Off-chain metadata contains Phantom spam keywords"] : []),
        ...(name.toLowerCase().includes("gift") ? ['On-chain name contains "Gift"'] : []),
        ...(!collection?.verified ? ["Collection not verified on-chain"] : []),
        ...(creators.some((c) => !c.verified) ? ["Unverified creator on-chain"] : []),
        ...(!meta.isMutable ? ["Metadata is immutable — URI cannot be updated"] : []),
      ],
    },
  };
}

loadEnvLocal();

const mints = process.argv.slice(2).map((m) => m.trim()).filter(Boolean);
if (!mints.length) {
  console.error("Usage: node scripts/inspect-gift-nft.mjs <mint> [<mint2> ...]");
  process.exit(1);
}

const rpc =
  process.env.SOLANA_RPC_URL_MAINNET?.trim() ||
  "https://api.mainnet-beta.solana.com";

const umi = createBaseUmi();
umi.use(dataViewSerializer());
umi.use(defaultProgramRepository());
umi.use(web3JsEddsa());
umi.use(web3JsTransactionFactory());
umi.use(mplTokenMetadata());
umi.use(mplToolbox());
attachMinimalFetchRpc(umi, rpc);

const reports = [];
for (const mint of mints) {
  reports.push(await inspectMint(umi, rpc, mint));
}

console.log(JSON.stringify(reports, null, 2));
