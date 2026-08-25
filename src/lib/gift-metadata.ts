/**
 * Off-chain JSON for gift mints — shaped for Phantom / explorer indexing.
 * Avoid words like "Gift" in on-chain names and Arweave JSON (Phantom spam filter).
 * @see https://docs.phantom.com/best-practices/tokens/collectibles-nfts-and-semi-fungibles
 */

/** Display symbol in Arweave JSON / UI. */
export const GIFT_SYMBOL = "$PIZZA";

/** On-chain Metaplex symbol — alphanumeric only (no `$`; causes InstructionPackError). */
export const GIFT_ON_CHAIN_SYMBOL = "PIZZA";

/** Default display name when the user leaves the name field blank (no "Gift"). */
export const GIFT_NAME = "Dough Boi";

/** Safe external link — do not use `/gift` (spam heuristic). */
export const GIFT_EXTERNAL_URL = "https://www.thecrust.io";

export const GIFT_DESCRIPTION =
  "A 1/1 $PIZZA collectible from Dough Boi. Minted on Solana.";

export const GIFT_COLLECTION_FAMILY = "Dough Boi";

/** Default off-chain collection label (no "Gifts"). */
export const GIFT_COLLECTION_DISPLAY_NAME = "Dough Boi";

/** Metaplex Token Metadata on-chain name (32-byte limit, not characters). */
export function giftMintName(displayName: string): string {
  const base = displayName.trim() || GIFT_NAME;
  const full = `${base} #1`;
  const bytes = new TextEncoder().encode(full);
  if (bytes.length <= 32) return full;
  let trimmed = bytes.slice(0, 32);
  // Drop trailing partial UTF-8 code point.
  while (trimmed.length > 0 && (trimmed[trimmed.length - 1] & 0xc0) === 0x80) {
    trimmed = trimmed.slice(0, -1);
  }
  return new TextDecoder().decode(trimmed);
}

export function giftDescription(note?: string): string {
  const trimmed = note?.trim();
  return trimmed || GIFT_DESCRIPTION;
}

export type GiftMetadataParams = {
  name: string;
  note?: string;
  imageUri: string;
  imageContentType: string;
  /** Platform update authority — must match on-chain verified creator. */
  platformCreatorAddress: string;
  /** Wallet that paid for the mint (shown as "From" attribute). */
  payerAddress?: string;
  collectionName?: string | null;
  /** Token Metadata collection mint for off-chain grouping hints. */
  collectionMint?: string | null;
};

/** Build Arweave metadata JSON uploaded before the Token Metadata mint. */
export function buildGiftMetadataJson(params: GiftMetadataParams): string {
  const collectionName =
    params.collectionName?.trim() || GIFT_COLLECTION_DISPLAY_NAME;
  const mintName = giftMintName(params.name);

  return JSON.stringify(
    {
      name: mintName,
      symbol: GIFT_SYMBOL,
      description: giftDescription(params.note),
      image: params.imageUri,
      external_url: GIFT_EXTERNAL_URL,
      seller_fee_basis_points: 0,
      attributes: buildGiftAttributes(params.note, params.payerAddress),
      collection: {
        name: collectionName,
        family: GIFT_COLLECTION_FAMILY,
        ...(params.collectionMint ? { key: params.collectionMint } : {}),
      },
      properties: {
        files: [
          {
            uri: params.imageUri,
            type: params.imageContentType,
            cdn: true,
          },
        ],
        category: "image",
        creators: [{ address: params.platformCreatorAddress, share: 100 }],
      },
    },
    null,
    2,
  );
}

/** Token attributes for app DB + Arweave metadata (avoid "Gift" — Phantom spam filter). */
export function buildGiftAttributes(note?: string, payer?: string) {
  return [
    ...(note?.trim() ? [{ trait_type: "Note", value: note.trim() }] : []),
    ...(payer?.trim() ? [{ trait_type: "From", value: payer.trim() }] : []),
    { trait_type: "Type", value: "Dough Boi" },
    { trait_type: "Edition", value: "1/1" },
    { trait_type: "Brand", value: GIFT_SYMBOL },
  ];
}
