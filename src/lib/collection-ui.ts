import type { Collection, GeneratedToken } from "./types";
import { giftDisplayNameFromToken, isGiftBundle } from "./gift-bundle";
import { isTokenRevealed, placeholderImageSrc } from "./reveal";

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

export function tokenImageSrc(collection: Collection, token: GeneratedToken) {
  if (!isTokenRevealed(collection, token.tokenId)) {
    return placeholderImageSrc(collection);
  }

  const collectionId = collection.id;
  if (token.imageUri && !token.imageUri.startsWith("/api/")) {
    const m = token.imageUri.match(/gateway\.irys\.xyz\/([A-Za-z0-9_-]+)/);
    if (m) return `/api/irys-gateway/${m[1]}`;
    return token.imageUri;
  }
  return `/api/assets/${collectionId}/${token.imageRelPath}`;
}

/** @deprecated Use tokenImageSrc(collection, token) */
export function tokenImageSrcLegacy(collectionId: string, token: GeneratedToken) {
  if (token.imageUri && !token.imageUri.startsWith("/api/")) {
    const m = token.imageUri.match(/gateway\.irys\.xyz\/([A-Za-z0-9_-]+)/);
    if (m) return `/api/irys-gateway/${m[1]}`;
    return token.imageUri;
  }
  return `/api/assets/${collectionId}/${token.imageRelPath}`;
}

export function coverImageSrc(collection: Collection) {
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
  return new Intl.NumberFormat("en-US", {
    style: "currency",
    currency: "USD",
    maximumFractionDigits: value < 1 ? 2 : 0,
  }).format(value);
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
  collection: Collection,
  filters: Record<string, string>,
): GeneratedToken[] {
  if (!collection.traitBrowserEnabled || Object.keys(filters).length === 0) {
    return tokens;
  }
  return tokens.filter((token) =>
    Object.entries(filters).every(([traitType, value]) =>
      token.attributes.some(
        (a) => a.trait_type === traitType && String(a.value) === value,
      ),
    ),
  );
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
