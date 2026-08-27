/**
 * Off-chain JSON for Metaplex Core gift mints.
 * Avoid words like "Gift" in metadata (Phantom spam filter).
 */

export const GIFT_SYMBOL = "$PIZZA";

export const GIFT_NAME = "Dough Boi";

export const GIFT_EXTERNAL_URL = "https://www.thecrust.io";

export const GIFT_DESCRIPTION =
  "A 1/1 $PIZZA collectible from Dough Boi. Minted on Solana.";

export const GIFT_COLLECTION_DISPLAY_NAME = "Dough Boi Gifts";

/** Metaplex Core on-chain name (keep short). */
export function giftMintName(displayName: string): string {
  const base = displayName.trim() || GIFT_NAME;
  const full = `${base} #1`;
  const bytes = new TextEncoder().encode(full);
  if (bytes.length <= 32) return full;
  let trimmed = bytes.slice(0, 32);
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
  platformCreatorAddress: string;
  payerAddress?: string;
};

/** Build Arweave metadata JSON uploaded before the Core asset mint. */
export function buildGiftMetadataJson(params: GiftMetadataParams): string {
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

export function buildGiftAttributes(note?: string, payer?: string) {
  return [
    ...(note?.trim() ? [{ trait_type: "Note", value: note.trim() }] : []),
    ...(payer?.trim() ? [{ trait_type: "From", value: payer.trim() }] : []),
    { trait_type: "Type", value: "Dough Boi" },
    { trait_type: "Edition", value: "1/1" },
    { trait_type: "Brand", value: GIFT_SYMBOL },
  ];
}
