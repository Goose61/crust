/**
 * Off-chain JSON for Metaplex Core mints.
 * Avoid words like "Gift" in names/JSON (Phantom spam filter).
 */

export const GIFT_SYMBOL = "$PIZZA";

export const GIFT_NAME = "Dough Boi";

export const GIFT_EXTERNAL_URL = "https://www.thecrust.io";

export const GIFT_DESCRIPTION =
  "A 1/1 $PIZZA collectible from Dough Boi. Minted on Solana.";

/** App / bundle display label — not written into Arweave JSON. */
export const GIFT_COLLECTION_DISPLAY_NAME = "Dough Boi";

const SPAM_WORDS = /\b(gifts?|airdrop|free|claim|winner)\b/gi;

/** Strip Phantom spam keywords from text used in on-chain names or Arweave JSON. */
export function sanitizeForPhantomMetadata(text: string): string {
  return text.replace(SPAM_WORDS, "").replace(/\s+/g, " ").trim();
}

/** Metaplex Core on-chain name (32-byte limit). */
export function giftMintName(displayName: string): string {
  const base = sanitizeForPhantomMetadata(displayName.trim()) || GIFT_NAME;
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
  const trimmed = sanitizeForPhantomMetadata(note?.trim() ?? "");
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
  const safeNote = note?.trim() ? sanitizeForPhantomMetadata(note.trim()) : "";
  return [
    ...(safeNote ? [{ trait_type: "Note", value: safeNote }] : []),
    ...(payer?.trim() ? [{ trait_type: "From", value: payer.trim() }] : []),
    { trait_type: "Type", value: "Dough Boi" },
    { trait_type: "Edition", value: "1/1" },
    { trait_type: "Brand", value: GIFT_SYMBOL },
  ];
}
