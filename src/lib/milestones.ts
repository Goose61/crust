import type { Collection, MilestoneEventId } from "./types";

export function mintedPercent(collection: Collection) {
  if (!collection.supply) return 0;
  return Math.floor((collection.mintedCount / collection.supply) * 100);
}

export function applyMilestoneEvents(
  collection: Collection,
  events: MilestoneEventId[],
): Collection {
  const next = { ...collection };
  for (const event of events) {
    switch (event) {
      case "enable_gift_mint":
        next.payments = { ...next.payments, giftMintEnabled: true };
        break;
      case "enable_secondary":
        next.secondaryEnabled = true;
        break;
      case "unlock_holder_page":
        next.holderPageUnlocked = true;
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
        break;
      case "reveal_batch":
        next.revealed = true;
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
      next = applyMilestoneEvents(next, milestone.events);
    }
  }
  if (next.mintedCount >= next.supply && next.status === "live") {
    next.status = "sold_out";
  }
  return next;
}
