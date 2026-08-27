#!/usr/bin/env node
/**
 * One-time: merge standalone per-gift MongoDB records into the gift bundle collection.
 *
 * Usage: node scripts/migrate-gift-records-to-bundle.mjs [--dry-run]
 */

import fs from "node:fs";
import { MongoClient } from "mongodb";

const GIFT_BUNDLE_ID = process.env.GIFT_BUNDLE_COLLECTION_ID?.trim() || "dough-boi-gifts";
const GIFT_BUNDLE_SLUG = "dough-boi-gifts";

function loadEnvLocal() {
  const envPath = ".env.local";
  if (!fs.existsSync(envPath)) return;
  for (const line of fs.readFileSync(envPath, "utf8").split("\n")) {
    const m = line.match(/^([^#=]+)=(.*)$/);
    if (m) process.env[m[1].trim()] = m[2].trim().replace(/^["']|["']$/g, "");
  }
}

function isStandaloneGift(doc) {
  if (doc.kind === "gift_bundle") return false;
  return (
    doc.payments?.giftMintEnabled &&
    doc.supply === 1 &&
    doc.tokens?.[0]?.dna === "gift"
  );
}

function countMinted(tokens) {
  return (tokens ?? []).filter((t) => t.mintTxUrl || t.assetAddress).length;
}

loadEnvLocal();

const dryRun = process.argv.includes("--dry-run");
const uri = process.env.MONGODB_URI;
if (!uri) {
  console.error("MONGODB_URI missing from .env.local");
  process.exit(1);
}

const client = new MongoClient(uri);
await client.connect();
const col = client.db("crypgo").collection("collections");

const all = await col.find({}).toArray();
const standalone = all.filter(isStandaloneGift);
const existingBundle = all.find((d) => d.id === GIFT_BUNDLE_ID || d.kind === "gift_bundle");

console.log(`Found ${standalone.length} standalone gift record(s).`);
console.log(`Existing bundle: ${existingBundle?.id ?? "none"}`);

const now = new Date().toISOString();
let bundle = existingBundle ?? {
  id: GIFT_BUNDLE_ID,
  slug: GIFT_BUNDLE_SLUG,
  name: "Dough Boi",
  symbol: "$PIZZA",
  description: "1/1 $PIZZA collectibles from Dough Boi. Minted on Solana.",
  nameTemplate: "{name}",
  chain: "solana",
  kind: "gift_bundle",
  status: "live",
  supply: 0,
  mintedCount: 0,
  artPath: "path-a",
  stackOrder: [],
  layers: [],
  blindMint: false,
  revealTrigger: "manual",
  revealed: true,
  milestones: [],
  payments: {
    basePriceUsd: 0,
    acceptSol: true,
    acceptUsdc: true,
    acceptPizza: false,
    acceptSlicePay: true,
    pizzaDiscountPercent: 0,
    giftMintEnabled: true,
    creatorWallet: "",
  },
  fees: {
    ownerPercent: 97,
    holdersPercent: 1,
    buybackPercent: 1,
    platformPercent: 1,
    locked: true,
  },
  allowlist: [],
  waitlist: [],
  publicMintOpen: false,
  secondaryEnabled: false,
  holderPageUnlocked: false,
  irysPublished: true,
  createdAt: now,
  updatedAt: now,
  tokens: [],
};

const tokens = [...(bundle.tokens ?? [])];
let nextId = tokens.length + 1;

for (const doc of standalone) {
  const src = doc.tokens?.[0];
  if (!src) continue;
  tokens.push({
    ...src,
    tokenId: nextId++,
  });
  console.log(`  + token #${nextId - 1} from ${doc.id} (${doc.name})`);
}

bundle.tokens = tokens;
bundle.mintedCount = countMinted(tokens);
bundle.supply = Math.max(tokens.length, bundle.mintedCount);
bundle.status = "live";
bundle.kind = "gift_bundle";
bundle.updatedAt = now;
delete bundle.pendingMint;

if (dryRun) {
  console.log(`Dry run — would merge ${standalone.length} records into bundle (${tokens.length} tokens total).`);
  await client.close();
  process.exit(0);
}

await col.replaceOne({ id: bundle.id }, bundle, { upsert: true });

for (const doc of standalone) {
  await col.updateOne(
    { id: doc.id },
    {
      $set: {
        status: "archived",
        parentCollectionId: bundle.id,
        updatedAt: now,
      },
    },
  );
}

console.log(`Done. Bundle ${bundle.id} now has ${tokens.length} token(s), ${bundle.mintedCount} minted.`);
console.log(`Archived ${standalone.length} standalone gift record(s).`);

await client.close();
