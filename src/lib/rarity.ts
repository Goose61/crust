import type { GeneratedToken } from "./types";

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
