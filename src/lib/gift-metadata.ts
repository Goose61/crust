/**
 * Off-chain JSON for gift mints — shaped for Phantom / explorer indexing.
 * @see https://docs.phantom.com/best-practices/tokens/collectibles-nfts-and-semi-fungibles
 */

/** Fixed brand symbol for all gift mints (no user input). */
export const GIFT_SYMBOL = "$PIZZA";

/** Default display name when the user leaves the name field blank. */
export const GIFT_NAME = "$PIZZA Gift";

export const GIFT_DESCRIPTION =
  "A 1/1 $PIZZA gift NFT from Dough Boi. Paid in SOL, delivered on-chain.";

export const GIFT_COLLECTION_FAMILY = "Dough Boi";

/** Metaplex Core on-chain name (32-char limit). */
export function giftMintName(displayName: string): string {
  const base = displayName.trim() || GIFT_NAME;
  return `${base} #1`.slice(0, 32);
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
  creatorAddress: string;
  coreCollectionAddress?: string | null;
  coreCollectionName?: string | null;
  externalUrl?: string;
};

/** Build Arweave metadata JSON uploaded before the Core mint. */
export function buildGiftMetadataJson(params: GiftMetadataParams): string {
  const collectionName = params.coreCollectionName?.trim() || "Dough Boi Gifts";
  const mintName = giftMintName(params.name);

  return JSON.stringify(
    {
      name: mintName,
      symbol: GIFT_SYMBOL,
      description: giftDescription(params.note),
      image: params.imageUri,
      ...(params.externalUrl ? { external_url: params.externalUrl } : {}),
      seller_fee_basis_points: 0,
      attributes: buildGiftAttributes(params.note),
      collection: {
        name: collectionName,
        family: GIFT_COLLECTION_FAMILY,
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
        creators: [{ address: params.creatorAddress, share: 100 }],
      },
    },
    null,
    2,
  );
}

/** Token attributes for app DB + Arweave metadata. */
export function buildGiftAttributes(note?: string) {
  return [
    ...(note?.trim() ? [{ trait_type: "Note", value: note.trim() }] : []),
    { trait_type: "Type", value: "Gift" },
    { trait_type: "Edition", value: "1/1" },
    { trait_type: "Brand", value: GIFT_SYMBOL },
  ];
}
