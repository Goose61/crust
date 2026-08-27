import type { Collection, GeneratedToken } from "./types";

export const GIFT_BUNDLE_SLUG = "dough-boi-gifts";

export function getGiftBundleId(): string {
  return process.env.GIFT_BUNDLE_COLLECTION_ID?.trim() || GIFT_BUNDLE_SLUG;
}

export function isGiftBundle(collection: Collection): boolean {
  return collection.kind === "gift_bundle";
}

export function isStandaloneGiftRecord(collection: Collection): boolean {
  if (isGiftBundle(collection)) return false;
  return (
    collection.payments.giftMintEnabled &&
    collection.supply === 1 &&
    collection.tokens[0]?.dna === "gift"
  );
}

export function countMintedGiftTokens(tokens: GeneratedToken[]): number {
  return tokens.filter((t) => Boolean(t.mintTxUrl || t.assetAddress)).length;
}

export function syncGiftBundleCounts(bundle: Collection): Collection {
  const minted = countMintedGiftTokens(bundle.tokens);
  bundle.mintedCount = minted;
  bundle.supply = Math.max(bundle.tokens.length, minted);
  bundle.status = "live";
  return bundle;
}

export function appendGiftToken(
  bundle: Collection,
  tokenInput: Omit<GeneratedToken, "tokenId">,
): { bundle: Collection; token: GeneratedToken; tokenId: number } {
  const tokenId = bundle.tokens.length + 1;
  const token: GeneratedToken = { ...tokenInput, tokenId };
  bundle.tokens = [...bundle.tokens, token];
  syncGiftBundleCounts(bundle);
  bundle.updatedAt = new Date().toISOString();
  return { bundle, token, tokenId };
}

export function findGiftToken(
  bundle: Collection,
  tokenId: number,
): GeneratedToken | undefined {
  return bundle.tokens.find((t) => t.tokenId === tokenId);
}

export function giftDisplayNameFromToken(token: GeneratedToken): string {
  const note = token.attributes.find((a) => a.trait_type === "Note")?.value;
  if (typeof note === "string" && note.trim()) {
    return note.trim().slice(0, 32);
  }
  return `Gift #${token.tokenId}`;
}

export function giftBundleHref(tokenId?: number): string {
  const base = `/collection/${GIFT_BUNDLE_SLUG}`;
  return tokenId ? `${base}?token=${tokenId}` : base;
}
