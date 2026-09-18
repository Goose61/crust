import type { Collection, GeneratedToken } from "./types";
import { giftDisplayNameFromToken, isGiftBundle } from "./gift-bundle";
import { isTokenRevealed, placeholderImageSrc } from "./reveal";
import type { OverallRarity } from "./rarity";
import { OVERALL_RARITY_LABEL, rarityRankByTokenId, tokenOverallRarity } from "./rarity";

export const COLLECTION_GRID_PAGE_SIZE = 48;

export type TokenStatusFilter = "all" | "for_sale" | "sold" | "listed";
export type TokenSort = "id_asc" | "price_asc" | "price_desc" | "rarity_asc" | "rarity_desc";
export type OverallRarityFilter = "all" | OverallRarity;

export function nftPrice(collection: Collection, token: GeneratedToken): number {
  let price = collection.payments.basePriceUsd;
  if (!collection.traitPricing) return price;
  for (const attr of token.attributes) {
    const tp = collection.traitPricing[attr.trait_type];
    if (tp) {
      const vp = tp[String(attr.value)];
      if (vp) price += vp.priceModifier;
    }
  }
  return Math.max(0, price);
}

export function proxyIrysUrl(uri: string): string {
  const m = uri.match(/gateway\.irys\.xyz\/([A-Za-z0-9_-]+)/);
  if (m) return `/api/irys-gateway/${m[1]}`;
  return uri;
}

export function tokenImageSrc(collection: Collection, token: GeneratedToken) {
  if (!isTokenRevealed(collection, token.tokenId)) {
    return placeholderImageSrc(collection);
  }

  const collectionId = collection.id;
  if (token.imageUri && !token.imageUri.startsWith("/api/")) {
    return proxyIrysUrl(token.imageUri);
  }
  return `/api/assets/${collectionId}/${token.imageRelPath}`;
}

/** @deprecated Use tokenImageSrc(collection, token) */
export function tokenImageSrcLegacy(collectionId: string, token: GeneratedToken) {
  if (token.imageUri && !token.imageUri.startsWith("/api/")) {
    return proxyIrysUrl(token.imageUri);
  }
  return `/api/assets/${collectionId}/${token.imageRelPath}`;
}

export function logoImageSrc(collection: Collection): string | null {
  if (!collection.logoUrl) return null;
  return proxyIrysUrl(collection.logoUrl);
}

export function thumbSrc(src: string, width = 400): string {
  if (!src || src.startsWith("blob:") || src.startsWith("data:")) return src;
  return `/api/image-thumb?u=${encodeURIComponent(src)}&w=${width}`;
}

export function tokenThumbSrc(collection: Collection, token: GeneratedToken, width = 400) {
  return thumbSrc(tokenImageSrc(collection, token), width);
}

export function coverImageSrc(collection: Collection) {
  const logo = logoImageSrc(collection);
  if (logo) return logo;
  if (isGiftBundle(collection)) {
    const latest = [...collection.tokens]
      .reverse()
      .find((t) => t.imageUri);
    if (latest) return tokenImageSrc(collection, latest);
  }
  const token = collection.tokens[0];
  if (!token) return "/images/dough/pixel-slice.webp";
  return tokenImageSrc(collection, token);
}

export function isTokenSold(token: GeneratedToken, collection: Collection) {
  if (token.owner || token.reservedBy) return true;
  if (collection.tokens.some((t) => t.owner)) return false;
  const ordered = [...collection.tokens].sort((a, b) => a.tokenId - b.tokenId);
  const index = ordered.findIndex((t) => t.tokenId === token.tokenId);
  return index >= 0 && index < collection.mintedCount;
}

export function formatUsd(value: number) {
  if (value <= 0) return "Free";
  return formatUsdAmount(value);
}

export function formatUsdAmount(value: number) {
  return new Intl.NumberFormat("en-US", {
    style: "currency",
    currency: "USD",
    maximumFractionDigits: value !== 0 && Math.abs(value) < 1 ? 2 : 0,
  }).format(value);
}

export function formatSol(sol: number) {
  if (!Number.isFinite(sol) || sol <= 0) return "0 SOL";
  const digits = sol < 0.01 ? 4 : sol < 1 ? 3 : 2;
  return `${sol.toFixed(digits)} SOL`;
}

export function usdToSol(usd: number, solUsd: number | null | undefined) {
  if (!solUsd || solUsd <= 0 || !Number.isFinite(usd)) return 0;
  return usd / solUsd;
}

export function formatUsdAndSol(usd: number, solUsd: number | null | undefined) {
  const usdLabel = formatUsd(usd);
  if (!solUsd || usd <= 0) return usdLabel;
  return `${usdLabel} · ${formatSol(usdToSol(usd, solUsd))}`;
}

export function tokenName(collection: Collection, token: GeneratedToken) {
  if (isGiftBundle(collection)) {
    return giftDisplayNameFromToken(token);
  }
  return collection.nameTemplate
    .replace("{name}", collection.name)
    .replace("{id}", String(token.tokenId));
}

export function filterTokensByTrait(
  tokens: GeneratedToken[],
  _collection: Collection,
  filters: Record<string, string>,
): GeneratedToken[] {
  if (Object.keys(filters).length === 0) return tokens;
  return tokens.filter((token) =>
    Object.entries(filters).every(([traitType, value]) =>
      token.attributes.some(
        (a) => a.trait_type === traitType && String(a.value) === value,
      ),
    ),
  );
}

export function filterTokensByStatus(
  tokens: GeneratedToken[],
  collection: Collection,
  status: TokenStatusFilter,
): GeneratedToken[] {
  if (status === "all") return tokens;
  return tokens.filter((token) => {
    const sold = isTokenSold(token, collection);
    const listed = Boolean(token.listing);
    if (status === "listed") return listed;
    if (status === "sold") return sold && !listed;
    return !sold;
  });
}

export function filterTokensBySearch(
  tokens: GeneratedToken[],
  collection: Collection,
  query: string,
): GeneratedToken[] {
  const q = query.trim().toLowerCase();
  if (!q) return tokens;
  const supply = collection.supply || collection.tokens.length;
  return tokens.filter((token) => {
    const name = tokenName(collection, token).toLowerCase();
    const id = String(token.tokenId);
    const rarity = OVERALL_RARITY_LABEL[tokenOverallRarity(token, supply)].toLowerCase();
    return name.includes(q) || id.includes(q) || `#${id}`.includes(q) || rarity.includes(q);
  });
}

export function tokenAskPrice(collection: Collection, token: GeneratedToken): number {
  if (token.listing) return token.listing.priceUsd;
  return nftPrice(collection, token);
}

export function filterTokensByRarity(
  tokens: GeneratedToken[],
  collection: Collection,
  rarity: OverallRarityFilter,
  ranks?: Map<number, number>,
): GeneratedToken[] {
  if (rarity === "all") return tokens;
  const supply = collection.supply || collection.tokens.length;
  const rankMap = ranks ?? rarityRankByTokenId(collection.tokens);
  return tokens.filter((token) => tokenOverallRarity(token, supply, rankMap) === rarity);
}

export function sortTokens(
  tokens: GeneratedToken[],
  collection: Collection,
  sort: TokenSort,
  ranks?: Map<number, number>,
): GeneratedToken[] {
  const copy = [...tokens];
  if (sort === "price_asc") {
    copy.sort((a, b) => tokenAskPrice(collection, a) - tokenAskPrice(collection, b) || a.tokenId - b.tokenId);
  } else if (sort === "price_desc") {
    copy.sort((a, b) => tokenAskPrice(collection, b) - tokenAskPrice(collection, a) || a.tokenId - b.tokenId);
  } else if (sort === "rarity_asc" || sort === "rarity_desc") {
    const rankMap = ranks ?? rarityRankByTokenId(collection.tokens);
    const dir = sort === "rarity_asc" ? 1 : -1;
    copy.sort((a, b) => {
      const ra = rankMap.get(a.tokenId) ?? Number.POSITIVE_INFINITY;
      const rb = rankMap.get(b.tokenId) ?? Number.POSITIVE_INFINITY;
      return (ra - rb) * dir || a.tokenId - b.tokenId;
    });
  } else {
    copy.sort((a, b) => a.tokenId - b.tokenId);
  }
  return copy;
}

export function uniqueTraitFilters(collection: Collection) {
  const map = new Map<string, Set<string>>();
  for (const t of collection.tokens) {
    for (const a of t.attributes) {
      if (a.trait_type === "Rarity Rank") continue;
      if (!map.has(a.trait_type)) map.set(a.trait_type, new Set());
      map.get(a.trait_type)!.add(String(a.value));
    }
  }
  return Array.from(map.entries()).map(([traitType, values]) => ({
    traitType,
    values: Array.from(values).sort(),
  }));
}
