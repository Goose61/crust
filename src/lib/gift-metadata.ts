/**
 * Off-chain JSON for gift mints — shaped for Phantom / explorer indexing.
 * @see https://docs.phantom.com/best-practices/tokens/collectibles-nfts-and-semi-fungibles
 */

/** Up to 10 chars, alphanumeric — Phantom uses symbol for display fallbacks. */
export function deriveGiftSymbol(name: string): string {
  const base = name.replace(/\s+#\d+$/, "").trim().replace(/\s+/g, "");
  const sym = base.slice(0, 10).toUpperCase().replace(/[^A-Z0-9]/g, "");
  return sym || "GIFT";
}

export type GiftMetadataParams = {
  name: string;
  description: string;
  imageUri: string;
  imageContentType: string;
  note?: string;
  creatorAddress: string;
  coreCollectionAddress?: string | null;
  coreCollectionName?: string | null;
  externalUrl?: string;
};

/** Build Arweave metadata JSON uploaded before the Core mint. */
export function buildGiftMetadataJson(params: GiftMetadataParams): string {
  const collectionName = params.coreCollectionName?.trim() || "Dough Boi Gifts";
  const symbol = deriveGiftSymbol(params.name);

  return JSON.stringify(
    {
      name: params.name,
      symbol,
      description: params.description,
      image: params.imageUri,
      ...(params.externalUrl ? { external_url: params.externalUrl } : {}),
      seller_fee_basis_points: 0,
      attributes: [
        ...(params.note ? [{ trait_type: "Note", value: params.note }] : []),
        { trait_type: "Type", value: "Gift" },
        { trait_type: "Edition", value: "1/1" },
        ...(params.coreCollectionAddress
          ? [{ trait_type: "Collection", value: collectionName }]
          : []),
      ],
      collection: {
        name: collectionName,
        family: collectionName,
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
