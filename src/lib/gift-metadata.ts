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

export const GIFT_CUSTOM_METADATA_MAX_BYTES = 256 * 1024;

/** Parse and validate an optional user-supplied metadata JSON file. */
export function parseGiftMetadataFile(raw: string): Record<string, unknown> {
  const trimmed = raw.trim();
  if (!trimmed) throw new Error("Metadata file is empty.");
  if (new TextEncoder().encode(trimmed).length > GIFT_CUSTOM_METADATA_MAX_BYTES) {
    throw new Error("Metadata JSON is too large (max 256 KB).");
  }
  let parsed: unknown;
  try {
    parsed = JSON.parse(trimmed);
  } catch {
    throw new Error("Metadata file is not valid JSON.");
  }
  if (!parsed || typeof parsed !== "object" || Array.isArray(parsed)) {
    throw new Error("Metadata JSON must be an object (e.g. { \"name\": \"...\", \"attributes\": [] }).");
  }
  return parsed as Record<string, unknown>;
}

function asRecord(value: unknown): Record<string, unknown> | undefined {
  return value && typeof value === "object" && !Array.isArray(value)
    ? (value as Record<string, unknown>)
    : undefined;
}

/**
 * Merge optional custom metadata with gift defaults.
 * The uploaded image URI always wins so wallets display the correct asset.
 */
export function mergeCustomGiftMetadata(
  custom: Record<string, unknown>,
  params: GiftMetadataParams,
): string {
  const displayName =
    typeof custom.name === "string" && custom.name.trim()
      ? custom.name.trim()
      : params.name;
  const mintName = giftMintName(displayName);

  const customProperties = asRecord(custom.properties);
  const creatorsRaw = customProperties?.creators ?? custom.creators;
  const creators = Array.isArray(creatorsRaw) && creatorsRaw.length > 0
    ? creatorsRaw
    : [{ address: params.platformCreatorAddress, share: 100 }];

  const description =
    typeof custom.description === "string" && custom.description.trim()
      ? sanitizeForPhantomMetadata(custom.description)
      : giftDescription(params.note);

  const attributes = Array.isArray(custom.attributes)
    ? custom.attributes
    : buildGiftAttributes(params.note, params.payerAddress);

  const merged: Record<string, unknown> = {
    ...custom,
    name: mintName,
    symbol:
      typeof custom.symbol === "string" && custom.symbol.trim()
        ? custom.symbol.trim()
        : GIFT_SYMBOL,
    description,
    image: params.imageUri,
    external_url:
      typeof custom.external_url === "string" && custom.external_url.trim()
        ? custom.external_url.trim()
        : GIFT_EXTERNAL_URL,
    seller_fee_basis_points:
      typeof custom.seller_fee_basis_points === "number"
        ? custom.seller_fee_basis_points
        : typeof custom.sellerFeeBasisPoints === "number"
          ? custom.sellerFeeBasisPoints
          : 0,
    attributes,
    properties: {
      ...customProperties,
      files: [
        {
          uri: params.imageUri,
          type: params.imageContentType,
          cdn: true,
        },
      ],
      category: "image",
      creators,
    },
  };

  return JSON.stringify(merged, null, 2);
}

/** Build final metadata JSON — custom file or generated defaults. */
export function buildGiftMetadataForUpload(
  params: GiftMetadataParams,
  custom?: Record<string, unknown> | null,
): string {
  if (custom) return mergeCustomGiftMetadata(custom, params);
  return buildGiftMetadataJson(params);
}
