import type { Collection, GeneratedToken } from "./types";
import { giftDisplayNameFromToken, isGiftBundle } from "./gift-bundle";

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

export function tokenImageSrc(collectionId: string, token: GeneratedToken) {
  // Gift NFTs (and other Irys uploads) store the image on Arweave — no local file.
  if (token.imageUri && !token.imageUri.startsWith("/api/")) {
    // Proxy Irys gateway URLs same-origin (gateway redirects to CDN domains blocked by CSP).
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
    if (latest) return tokenImageSrc(collection.id, latest);
  }
  const token = collection.tokens[0];
  if (!token) return "/images/dough/pixel-slice.webp";
  return tokenImageSrc(collection.id, token);
}

export function isTokenSold(token: GeneratedToken, collection: Collection) {
  if (token.owner) return true;
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
