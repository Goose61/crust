import type { GeneratedToken } from "./types";

export type OverallRarity = "legendary" | "epic" | "rare" | "uncommon" | "common";

export const OVERALL_RARITY_ORDER: OverallRarity[] = [
  "legendary",
  "epic",
  "rare",
  "uncommon",
  "common",
];

export const OVERALL_RARITY_LABEL: Record<OverallRarity, string> = {
  legendary: "Legendary",
  epic: "Epic",
  rare: "Rare",
  uncommon: "Uncommon",
  common: "Common",
};

export const OVERALL_RARITY_CLASS: Record<OverallRarity, string> = {
  legendary: "bg-amber-400 text-black",
  epic: "bg-fuchsia-500 text-white",
  rare: "bg-sky-500 text-white",
  uncommon: "bg-emerald-500 text-white",
  common: "bg-white/20 text-white",
};

export function tokenRarityRank(token: GeneratedToken): number | null {
  const attr = token.attributes.find((a) => a.trait_type === "Rarity Rank");
  if (attr == null) return null;
  const n = Number(attr.value);
  return Number.isFinite(n) && n > 0 ? n : null;
}

export function overallRarityFromRank(rank: number, supply: number): OverallRarity {
  if (supply <= 1) return "common";
  const pct = rank / supply;
  if (pct <= 0.05) return "legendary";
  if (pct <= 0.15) return "epic";
  if (pct <= 0.35) return "rare";
  if (pct <= 0.65) return "uncommon";
  return "common";
}

/** Rank map (1 = rarest). Uses stored Rarity Rank when every token has it. */
export function rarityRankByTokenId(tokens: GeneratedToken[]): Map<number, number> {
  const existing = new Map<number, number>();
  let complete = tokens.length > 0;
  for (const token of tokens) {
    const rank = tokenRarityRank(token);
    if (rank == null) complete = false;
    else existing.set(token.tokenId, rank);
  }
  if (complete) return existing;
  const ranked = assignRarityRanks(tokens);
  return new Map(
    ranked.map((token) => [token.tokenId, tokenRarityRank(token) ?? ranked.length]),
  );
}

export function tokenOverallRarity(
  token: GeneratedToken,
  supply: number,
  ranks?: Map<number, number>,
): OverallRarity {
  const rank = ranks?.get(token.tokenId) ?? tokenRarityRank(token);
  if (rank != null) return overallRarityFromRank(rank, Math.max(1, supply));
  return "common";
}

export function assignRarityRanks(tokens: GeneratedToken[]): GeneratedToken[] {
  const freq = new Map<string, number>();
  for (const t of tokens) {
    for (const a of t.attributes) {
      const key = `${a.trait_type}:${a.value}`;
      freq.set(key, (freq.get(key) ?? 0) + 1);
    }
  }
  const scored = tokens.map((t) => {
    const score = t.attributes.reduce((s, a) => {
      const f = freq.get(`${a.trait_type}:${a.value}`) ?? tokens.length;
      return s + tokens.length / f;
    }, 0);
    return { t, score };
  });
  scored.sort((a, b) => b.score - a.score);
  const max = tokens.length;
  return scored.map((row, idx) => {
    const rank = idx + 1;
    const attrs = row.t.attributes.filter((a) => a.trait_type !== "Rarity Rank");
    attrs.push({ trait_type: "Rarity Rank", value: rank, display_type: "number", max_value: max });
    return { ...row.t, attributes: attrs };
  });
}
