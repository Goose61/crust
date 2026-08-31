import type {
  Collection,
  FeeLedgerEntry,
  FeeSplit,
  RoyaltySplit,
} from "./types";
import {
  PRIMARY_PLATFORM_FEE_PERCENT,
  PRIMARY_TRADE_TAX_PERCENT,
  SECONDARY_PLATFORM_FEE_PERCENT,
} from "./platform-fees";

/** Marker owner for NFTs held by the buyback treasury after a floor buy. */
export const TREASURY_OWNER_MARKER = "__platform_treasury__";

export type SaleFeeBreakdown = {
  saleUsd: number;
  kind: "primary_mint" | "secondary_sale";
  ownerUsd: number;
  holdersUsd: number;
  buybackUsd: number;
  platformUsd: number;
  platformFeeUsd: number;
  tradeTaxUsd: number;
};

export type HolderClaimPreview = {
  wallet: string;
  heldCount: number;
  claimableUsd: number;
  alreadyClaimedUsd: number;
};

function roundUsd(n: number) {
  return Math.round(n * 100) / 100;
}

function roundUsdShare(poolUsd: number, shares: number, totalShares: number) {
  if (totalShares <= 0) return 0;
  return roundUsd((poolUsd * shares) / totalShares);
}

/** Creator split (owner / holders / buyback) on net after fixed platform + trade tax. */
export function splitPrimaryMintFees(
  saleUsd: number,
  fees: FeeSplit,
): Omit<SaleFeeBreakdown, "saleUsd" | "kind"> {
  const platformFeeUsd = roundUsd((saleUsd * PRIMARY_PLATFORM_FEE_PERCENT) / 100);
  const tradeTaxUsd = roundUsd((saleUsd * PRIMARY_TRADE_TAX_PERCENT) / 100);
  const platformUsd = roundUsd(platformFeeUsd + tradeTaxUsd);
  const netUsd = roundUsd(Math.max(0, saleUsd - platformUsd));

  const ownerUsd = roundUsd((netUsd * fees.ownerPercent) / 100);
  const holdersUsd = roundUsd((netUsd * fees.holdersPercent) / 100);
  const buybackUsd = roundUsd((netUsd * fees.buybackPercent) / 100);

  return { ownerUsd, holdersUsd, buybackUsd, platformUsd, platformFeeUsd, tradeTaxUsd };
}

/** Creator royalty portions of secondary sale price (excludes marketplace platform fee). */
export function splitSecondaryRoyalties(
  saleUsd: number,
  royaltyBps: number,
  royaltySplit?: RoyaltySplit,
): Pick<SaleFeeBreakdown, "ownerUsd" | "holdersUsd" | "buybackUsd"> {
  const royaltyUsd = roundUsd((saleUsd * royaltyBps) / 10_000);
  if (!royaltySplit || royaltyUsd <= 0) {
    return { ownerUsd: royaltyUsd, holdersUsd: 0, buybackUsd: 0 };
  }
  const ownerUsd = roundUsd((royaltyUsd * royaltySplit.ownerPercent) / 100);
  const holdersUsd = roundUsd((royaltyUsd * royaltySplit.holdersPercent) / 100);
  const buybackUsd = roundUsd((royaltyUsd * royaltySplit.buybackPercent) / 100);
  return { ownerUsd, holdersUsd, buybackUsd };
}

/** Full secondary sale breakdown: fixed platform fee + creator royalties. */
export function splitSecondarySale(
  saleUsd: number,
  royaltyBps: number,
  royaltySplit?: RoyaltySplit,
): Omit<SaleFeeBreakdown, "saleUsd" | "kind"> {
  const platformFeeUsd = roundUsd((saleUsd * SECONDARY_PLATFORM_FEE_PERCENT) / 100);
  const royaltyParts = splitSecondaryRoyalties(saleUsd, royaltyBps, royaltySplit);
  return {
    ...royaltyParts,
    platformUsd: platformFeeUsd,
    platformFeeUsd,
    tradeTaxUsd: 0,
  };
}

function ensureLedger(collection: Collection) {
  if (!collection.feeLedger) {
    collection.feeLedger = {
      holderTreasuryUsd: 0,
      buybackTreasuryUsd: 0,
      platformTreasuryUsd: 0,
      ownerAccruedUsd: 0,
      entries: [],
      distributionRounds: [],
      buybacks: [],
    };
  }
  return collection.feeLedger;
}

export function accrueSaleFees(
  collection: Collection,
  params: {
    saleUsd: number;
    kind: "primary_mint" | "secondary_sale";
    tokenId?: number;
    payer?: string;
    seller?: string;
  },
): { collection: Collection; breakdown: SaleFeeBreakdown } {
  const ledger = ensureLedger(collection);
  const breakdownParts =
    params.kind === "primary_mint"
      ? splitPrimaryMintFees(params.saleUsd, collection.fees)
      : splitSecondarySale(
          params.saleUsd,
          collection.royaltyBps ?? 500,
          collection.royaltySplit,
        );

  const breakdown: SaleFeeBreakdown = {
    saleUsd: params.saleUsd,
    kind: params.kind,
    ...breakdownParts,
  };

  ledger.holderTreasuryUsd = roundUsd(ledger.holderTreasuryUsd + breakdown.holdersUsd);
  ledger.buybackTreasuryUsd = roundUsd(ledger.buybackTreasuryUsd + breakdown.buybackUsd);
  ledger.platformTreasuryUsd = roundUsd(ledger.platformTreasuryUsd + breakdown.platformUsd);
  ledger.ownerAccruedUsd = roundUsd(ledger.ownerAccruedUsd + breakdown.ownerUsd);

  const entry: FeeLedgerEntry = {
    at: new Date().toISOString(),
    kind: params.kind,
    saleUsd: params.saleUsd,
    tokenId: params.tokenId,
    payer: params.payer,
    seller: params.seller,
    ownerUsd: breakdown.ownerUsd,
    holdersUsd: breakdown.holdersUsd,
    buybackUsd: breakdown.buybackUsd,
    platformUsd: breakdown.platformUsd,
    platformFeeUsd: breakdown.platformFeeUsd,
    tradeTaxUsd: breakdown.tradeTaxUsd,
  };
  ledger.entries.push(entry);

  return { collection, breakdown };
}

export function holderCounts(collection: Collection): Map<string, number> {
  const counts = new Map<string, number>();
  for (const t of collection.tokens) {
    if (!t.owner || t.owner === TREASURY_OWNER_MARKER) continue;
    counts.set(t.owner, (counts.get(t.owner) ?? 0) + 1);
  }
  return counts;
}

/** Open a holder distribution round when fee_distribution milestone fires. */
export function openFeeDistributionRound(collection: Collection, milestoneAt?: number): Collection {
  const ledger = ensureLedger(collection);
  const poolUsd = ledger.holderTreasuryUsd;
  if (poolUsd <= 0) return collection;

  const snapshot = Array.from(holderCounts(collection).entries()).map(([wallet, count]) => ({
    wallet,
    count,
  }));
  const totalShares = snapshot.reduce((s, h) => s + h.count, 0);
  if (totalShares === 0) return collection;

  ledger.distributionRounds.push({
    id: `round-${ledger.distributionRounds.length + 1}`,
    openedAt: new Date().toISOString(),
    milestoneAt,
    poolUsd,
    totalShares,
    snapshot,
    claims: [],
  });
  ledger.holderTreasuryUsd = 0;
  return collection;
}

export function getOpenDistributionRound(collection: Collection) {
  const rounds = collection.feeLedger?.distributionRounds ?? [];
  return rounds.length > 0 ? rounds[rounds.length - 1] : null;
}

export function previewHolderClaim(collection: Collection, wallet: string): HolderClaimPreview | null {
  const round = getOpenDistributionRound(collection);
  if (!round || !collection.feeClaimsOpen) return null;

  const snap = round.snapshot.find((h) => h.wallet === wallet);
  if (!snap) {
    return { wallet, heldCount: 0, claimableUsd: 0, alreadyClaimedUsd: 0 };
  }

  const totalEntitled = roundUsdShare(round.poolUsd, snap.count, round.totalShares);
  const alreadyClaimedUsd = roundUsd(
    round.claims.filter((c) => c.wallet === wallet).reduce((s, c) => s + c.amountUsd, 0),
  );
  const claimableUsd = roundUsd(Math.max(0, totalEntitled - alreadyClaimedUsd));

  return {
    wallet,
    heldCount: snap.count,
    claimableUsd,
    alreadyClaimedUsd,
  };
}

export function claimHolderFees(collection: Collection, wallet: string): {
  collection: Collection;
  claimedUsd: number;
} {
  if (!collection.feeClaimsOpen) {
    throw new Error("Fee claims are not open for this collection");
  }
  const preview = previewHolderClaim(collection, wallet);
  if (!preview || preview.claimableUsd <= 0) {
    throw new Error("Nothing to claim for this wallet");
  }

  const round = getOpenDistributionRound(collection)!;
  round.claims.push({
    wallet,
    amountUsd: preview.claimableUsd,
    claimedAt: new Date().toISOString(),
  });

  return { collection, claimedUsd: preview.claimableUsd };
}

export type BuybackResult = {
  collection: Collection;
  purchased: boolean;
  tokenId?: number;
  priceUsd?: number;
  reason?: string;
};

/** Use buyback treasury to purchase the cheapest secondary listing (floor support). */
export function executeTreasuryBuyback(collection: Collection): BuybackResult {
  const ledger = ensureLedger(collection);
  if (!collection.treasuryBuybackActive) {
    return { collection, purchased: false, reason: "Treasury buyback not active" };
  }
  if (ledger.buybackTreasuryUsd <= 0) {
    return { collection, purchased: false, reason: "Buyback treasury empty" };
  }

  const listed = collection.tokens
    .filter((t) => t.listing && t.owner && t.owner !== TREASURY_OWNER_MARKER)
    .sort((a, b) => (a.listing!.priceUsd - b.listing!.priceUsd));

  const cheapest = listed[0];
  if (!cheapest?.listing) {
    return { collection, purchased: false, reason: "No listings on secondary market" };
  }

  const priceUsd = cheapest.listing.priceUsd;
  if (ledger.buybackTreasuryUsd < priceUsd) {
    return {
      collection,
      purchased: false,
      reason: `Buyback treasury ($${ledger.buybackTreasuryUsd}) below floor ($${priceUsd})`,
    };
  }

  ledger.buybackTreasuryUsd = roundUsd(ledger.buybackTreasuryUsd - priceUsd);
  const seller = cheapest.owner!;
  cheapest.owner = TREASURY_OWNER_MARKER;
  cheapest.listing = null;

  ledger.buybacks.push({
    at: new Date().toISOString(),
    tokenId: cheapest.tokenId,
    priceUsd,
    seller,
    buybackTokenCa: collection.buybackTokenCa,
  });

  return {
    collection,
    purchased: true,
    tokenId: cheapest.tokenId,
    priceUsd,
  };
}
