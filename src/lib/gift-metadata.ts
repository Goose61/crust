/**
 * Off-chain JSON for gift mints — shaped for Phantom / explorer indexing.
 * @see https://docs.phantom.com/best-practices/tokens/collectibles-nfts-and-semi-fungibles
 */

/** Fixed brand symbol for all gift mints (no user input). */
export const GIFT_SYMBOL = "$PIZZA";

/** Display / collection record name. */
export const GIFT_NAME = "$PIZZA Gift";

/** On-chain Metaplex Core asset name (32-char limit). */
export const GIFT_MINT_NAME = "$PIZZA Gift #1";

export const GIFT_DESCRIPTION =
  "A 1/1 $PIZZA gift NFT from Dough Boi. Paid in SOL, delivered on-chain.";

export const GIFT_COLLECTION_FAMILY = "Dough Boi";

export type GiftMetadataParams = {
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

  return JSON.stringify(
    {
      name: GIFT_MINT_NAME,
      symbol: GIFT_SYMBOL,
      description: GIFT_DESCRIPTION,
      image: params.imageUri,
      ...(params.externalUrl ? { external_url: params.externalUrl } : {}),
      seller_fee_basis_points: 0,
      attributes: [
        { trait_type: "Type", value: "Gift" },
        { trait_type: "Edition", value: "1/1" },
        { trait_type: "Brand", value: GIFT_SYMBOL },
        ...(params.coreCollectionAddress
          ? [{ trait_type: "Collection", value: collectionName }]
          : []),
      ],
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

/** Default token attributes stored in the app database. */
export function defaultGiftAttributes() {
  return [
    { trait_type: "Type", value: "Gift" },
    { trait_type: "Edition", value: "1/1" },
    { trait_type: "Brand", value: GIFT_SYMBOL },
  ];
}
