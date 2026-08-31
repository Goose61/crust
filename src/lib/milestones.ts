import type { Collection, MilestoneEventId } from "./types";
import { applyRevealBatch } from "./reveal";
import { mintedPercent } from "./collection-stats";
import { executeTreasuryBuyback, openFeeDistributionRound } from "./fee-distribution";

export { mintedPercent } from "./collection-stats";

function holderCounts(collection: Collection): Map<string, number> {
  const counts = new Map<string, number>();
  for (const t of collection.tokens) {
    if (!t.owner) continue;
    counts.set(t.owner, (counts.get(t.owner) ?? 0) + 1);
  }
  return counts;
}

export function applyMilestoneEvents(
  collection: Collection,
  events: MilestoneEventId[],
  milestoneAt?: number,
): Collection {
  const next = {
    ...collection,
    tokens: collection.tokens.map((t) => ({ ...t })),
    milestones: collection.milestones.map((m) => ({ ...m })),
  };

  for (const event of events) {
    switch (event) {
      case "enable_gift_mint":
        next.payments = { ...next.payments, giftMintEnabled: true };
        break;
      case "enable_bundle_mint":
        next.payments = { ...next.payments, bundleMintEnabled: true };
        break;
      case "enable_secondary":
        next.secondaryEnabled = true;
        break;
      case "unlock_holder_page":
        next.holderPageUnlocked = true;
        break;
      case "unlock_trait_browser":
        next.traitBrowserEnabled = true;
        break;
      case "open_public_mint":
        next.publicMintOpen = true;
        break;
      case "close_primary_mint":
        next.status = next.mintedCount >= next.supply ? "sold_out" : "archived";
        break;
      case "featured_homepage":
        next.featuredUntil = new Date(Date.now() + 7 * 86400000).toISOString();
        break;
      case "creator_banner":
        next.banner = `${next.name} just hit a milestone.`;
        break;
      case "reveal_all":
        next.revealed = true;
        next.revealedTokenIds = next.tokens.map((t) => t.tokenId);
        break;
      case "reveal_batch":
        Object.assign(next, applyRevealBatch(next));
        break;
      case "mint_price_increase": {
        const step = Math.max(1, Math.round(next.payments.basePriceUsd * 0.1));
        next.payments = {
          ...next.payments,
          basePriceUsd: next.payments.basePriceUsd + step,
        };
        break;
      }
      case "referral_bonus_boost":
        next.referralBonusBoostUntil = new Date(Date.now() + 14 * 86400000).toISOString();
        break;
      case "fee_distribution":
        next.feeClaimsOpen = true;
        Object.assign(next, openFeeDistributionRound(next, milestoneAt));
        break;
      case "snapshot_holders": {
        const counts = holderCounts(next);
        const holders = Array.from(counts.entries()).map(([wallet, count]) => ({
          wallet,
          count,
        }));
        next.holderSnapshots = [
          ...(next.holderSnapshots ?? []),
          {
            takenAt: new Date().toISOString(),
            milestoneAt: milestoneAt ?? mintedPercent(next),
            holders,
          },
        ];
        break;
      }
      case "enable_sequel_allowlist":
        next.sequelAllowlistFromHolders = true;
        break;
      case "treasury_buyback":
        next.treasuryBuybackActive = true;
        Object.assign(next, executeTreasuryBuyback(next).collection);
        break;
      case "discord_role_sync":
        next.discordRoleSyncEnabled = true;
        break;
      case "airdrop_spl":
        next.airdropSplPending = true;
        break;
      default:
        break;
    }
  }
  return next;
}

export function fireDueMilestones(collection: Collection): Collection {
  const pct = mintedPercent(collection);
  let next = { ...collection, milestones: collection.milestones.map((m) => ({ ...m })) };
  for (const milestone of next.milestones) {
    if (milestone.firedAt) continue;
    if (pct >= milestone.at) {
      milestone.firedAt = new Date().toISOString();
      next = applyMilestoneEvents(next, milestone.events, milestone.at);
    }
  }
  if (next.mintedCount >= next.supply && next.status === "live") {
    next.status = "sold_out";
  }
  return next;
}
