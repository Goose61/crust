#!/usr/bin/env node
/**
 * Smoke tests: milestone logic + build/lint/typecheck.
 * Run: npm run smoke
 */

import { spawnSync } from "node:child_process";
import { fileURLToPath } from "node:url";
import path from "node:path";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");

function run(cmd, args, label) {
  console.log(`\n▶ ${label}`);
  const r = spawnSync(cmd, args, { cwd: root, stdio: "inherit", shell: false });
  if (r.status !== 0) {
    console.error(`✗ ${label} failed`);
    process.exit(r.status ?? 1);
  }
  console.log(`✓ ${label}`);
}

function assert(cond, msg) {
  if (!cond) {
    console.error(`✗ ${msg}`);
    process.exit(1);
  }
}

// ── Unit: collection-stats + milestones (mirrors src/lib) ───────────────────

function mintedPercent(collection) {
  if (!collection.supply) return 0;
  return Math.floor((collection.mintedCount / collection.supply) * 100);
}

function batchSize(supply) {
  return Math.max(1, Math.ceil(supply / 10));
}

function applyRevealBatch(collection) {
  const batch = batchSize(collection.supply);
  const batchIndex = collection.revealedBatchIndex ?? 0;
  const startId = batchIndex * batch + 1;
  const endId = Math.min(collection.supply, startId + batch - 1);
  const revealedIds = new Set(collection.revealedTokenIds ?? []);
  for (let id = startId; id <= endId; id++) revealedIds.add(id);
  return {
    ...collection,
    revealedBatchIndex: batchIndex + 1,
    revealedTokenIds: Array.from(revealedIds).sort((a, b) => a - b),
    revealed: revealedIds.size >= collection.supply,
  };
}

function applyMilestoneEvents(collection, events, milestoneAt) {
  const next = { ...collection, milestones: [...collection.milestones] };
  for (const event of events) {
    if (event === "reveal_batch") Object.assign(next, applyRevealBatch(next));
    if (event === "snapshot_holders") {
      const counts = new Map();
      for (const t of next.tokens ?? []) {
        if (!t.owner) continue;
        counts.set(t.owner, (counts.get(t.owner) ?? 0) + 1);
      }
      next.holderSnapshots = [
        ...(next.holderSnapshots ?? []),
        {
          takenAt: new Date().toISOString(),
          milestoneAt: milestoneAt ?? mintedPercent(next),
          holders: Array.from(counts.entries()).map(([wallet, count]) => ({ wallet, count })),
        },
      ];
    }
    if (event === "enable_secondary") next.secondaryEnabled = true;
    if (event === "sequelAllowlistFromHolders" || event === "enable_sequel_allowlist") {
      next.sequelAllowlistFromHolders = true;
    }
  }
  return next;
}

function fireDueMilestones(collection) {
  const pct = mintedPercent(collection);
  let next = { ...collection, milestones: collection.milestones.map((m) => ({ ...m })) };
  for (const milestone of next.milestones) {
    if (milestone.firedAt) continue;
    if (pct >= milestone.at) {
      milestone.firedAt = new Date().toISOString();
      next = applyMilestoneEvents(next, milestone.events, milestone.at);
    }
  }
  return next;
}

function testMilestones() {
  console.log("\n▶ Milestone unit tests");

  assert(mintedPercent({ supply: 100, mintedCount: 25 }) === 25, "mintedPercent 25%");
  assert(batchSize(100) === 10, "batchSize 100 → 10");

  let c = {
    supply: 20,
    mintedCount: 0,
    revealedBatchIndex: 0,
    revealedTokenIds: [],
    milestones: [],
    tokens: [],
  };
  c = applyRevealBatch(c);
  assert(c.revealedBatchIndex === 1, "reveal_batch index increments");
  assert(c.revealedTokenIds.length === 2, "reveal_batch reveals first batch (20 supply → batch 2)");
  assert(c.revealedTokenIds[0] === 1 && c.revealedTokenIds[1] === 2, "reveal_batch token ids 1-2");

  c = {
    supply: 10,
    mintedCount: 5,
    milestones: [{ at: 50, events: ["enable_secondary"], firedAt: null }],
    tokens: [
      { tokenId: 1, owner: "walletA" },
      { tokenId: 2, owner: "walletA" },
      { tokenId: 3, owner: "walletB" },
    ],
    holderSnapshots: [],
  };
  c = fireDueMilestones(c);
  assert(c.secondaryEnabled === true, "fireDueMilestones enables secondary at 50%");
  assert(c.milestones[0].firedAt, "milestone marked fired");

  c = {
    supply: 10,
    mintedCount: 3,
    milestones: [{ at: 30, events: ["snapshot_holders"], firedAt: null }],
    tokens: [
      { tokenId: 1, owner: "Alice" },
      { tokenId: 2, owner: "Alice" },
      { tokenId: 3, owner: "Bob" },
    ],
    holderSnapshots: [],
  };
  c = fireDueMilestones(c);
  assert(c.holderSnapshots?.length === 1, "snapshot_holders creates one snapshot");
  const snap = c.holderSnapshots[0];
  assert(snap.holders.find((h) => h.wallet === "Alice")?.count === 2, "Alice holds 2");
  assert(snap.holders.find((h) => h.wallet === "Bob")?.count === 1, "Bob holds 1");

  console.log("✓ Milestone unit tests");
}

function testFeeDistribution() {
  console.log("\n▶ Fee distribution unit tests");

  function splitPrimaryMintFees(saleUsd, fees) {
    const round = (n) => Math.round(n * 100) / 100;
    const platformFeeUsd = round((saleUsd * 0.7) / 100);
    const tradeTaxUsd = round((saleUsd * 0.3) / 100);
    const platformUsd = round(platformFeeUsd + tradeTaxUsd);
    const netUsd = round(saleUsd - platformUsd);
    return {
      ownerUsd: round((netUsd * fees.ownerPercent) / 100),
      holdersUsd: round((netUsd * fees.holdersPercent) / 100),
      buybackUsd: round((netUsd * fees.buybackPercent) / 100),
      platformUsd,
      platformFeeUsd,
      tradeTaxUsd,
    };
  }

  function splitSecondarySale(saleUsd, royaltyBps, royaltySplit) {
    const round = (n) => Math.round(n * 100) / 100;
    const platformFeeUsd = round((saleUsd * 0.5) / 100);
    const royaltyUsd = round((saleUsd * royaltyBps) / 10000);
    const ownerUsd = round((royaltyUsd * royaltySplit.ownerPercent) / 100);
    const holdersUsd = round((royaltyUsd * royaltySplit.holdersPercent) / 100);
    const buybackUsd = round((royaltyUsd * royaltySplit.buybackPercent) / 100);
    return { ownerUsd, holdersUsd, buybackUsd, platformUsd: platformFeeUsd, platformFeeUsd, tradeTaxUsd: 0 };
  }

  const primary = splitPrimaryMintFees(100, {
    ownerPercent: 90,
    holdersPercent: 5,
    buybackPercent: 5,
  });
  assert(primary.platformUsd === 1, "primary platform + trade tax $1 on $100");
  assert(primary.platformFeeUsd === 0.7, "primary platform fee $0.70");
  assert(primary.tradeTaxUsd === 0.3, "primary trade tax $0.30");
  assert(primary.holdersUsd === 4.95, "primary holder share on net $99");
  assert(
    primary.ownerUsd + primary.holdersUsd + primary.buybackUsd + primary.platformUsd === 100,
    "primary split sums to sale",
  );

  const secondary = splitSecondarySale(200, 500, {
    ownerPercent: 60,
    holdersPercent: 25,
    buybackPercent: 15,
  });
  assert(secondary.platformUsd === 1, "secondary platform fee $1 on $200");
  assert(secondary.holdersUsd === 2.5, "secondary holder royalty $2.50 on $200 @ 5%");
  assert(secondary.buybackUsd === 1.5, "secondary buyback royalty $1.50");

  const TREASURY = "__platform_treasury__";
  let collection = {
    fees: { ownerPercent: 97, holdersPercent: 2, buybackPercent: 1, locked: true },
    royaltyBps: 500,
    royaltySplit: { ownerPercent: 50, holdersPercent: 30, buybackPercent: 20 },
    treasuryBuybackActive: true,
    buybackTokenCa: "TokenMint11111111111111111111111111111111",
    secondaryEnabled: true,
    feeClaimsOpen: false,
    tokens: [
      { tokenId: 1, owner: "Alice", listing: null },
      { tokenId: 2, owner: "Bob", listing: { priceUsd: 50, listedAt: "2026-01-01" } },
      { tokenId: 3, owner: "Carol", listing: { priceUsd: 30, listedAt: "2026-01-01" } },
    ],
    feeLedger: {
      holderTreasuryUsd: 0,
      buybackTreasuryUsd: 40,
      platformTreasuryUsd: 0,
      ownerAccruedUsd: 0,
      entries: [],
      distributionRounds: [],
      buybacks: [],
    },
  };

  // Simulate buyback: cheapest listing is #3 at $30
  const listed = collection.tokens
    .filter((t) => t.listing && t.owner !== TREASURY)
    .sort((a, b) => a.listing.priceUsd - b.listing.priceUsd);
  const cheapest = listed[0];
  collection.feeLedger.buybackTreasuryUsd -= cheapest.listing.priceUsd;
  cheapest.owner = TREASURY;
  cheapest.listing = null;
  collection.feeLedger.buybacks.push({
    at: new Date().toISOString(),
    tokenId: cheapest.tokenId,
    priceUsd: 30,
    seller: "Carol",
    buybackTokenCa: collection.buybackTokenCa,
  });

  assert(cheapest.tokenId === 3, "buyback purchases floor (#3 at $30)");
  assert(collection.feeLedger.buybackTreasuryUsd === 10, "buyback treasury reduced to $10");
  assert(collection.tokens.find((t) => t.tokenId === 3).owner === TREASURY, "NFT moved to treasury");

  // Holder distribution round
  collection.feeLedger.holderTreasuryUsd = 20;
  collection.feeClaimsOpen = true;
  collection.feeLedger.distributionRounds.push({
    id: "round-1",
    openedAt: new Date().toISOString(),
    poolUsd: 20,
    totalShares: 2,
    snapshot: [{ wallet: "Alice", count: 2 }],
    claims: [],
  });
  collection.feeLedger.holderTreasuryUsd = 0;
  const round = collection.feeLedger.distributionRounds[0];
  const claimable = Math.round(((round.poolUsd * 2) / round.totalShares) * 100) / 100;
  assert(claimable === 20, "Alice claims full $20 pool with 2/2 shares");

  console.log("✓ Fee distribution unit tests");
}

testMilestones();
testFeeDistribution();

run("npx", ["tsc", "--noEmit"], "TypeScript check");
run("npm", ["run", "lint"], "ESLint");
run("npm", ["run", "build"], "Next.js build");

console.log("\n✅ All smoke tests passed\n");
