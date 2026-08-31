import type { GeneratedToken, RoyaltySplit } from "./types";

export function buildCreatorsFromRoyaltySplit(
  creatorWallet: string,
  royaltySplit?: RoyaltySplit,
): { address: string; share: number }[] {
  const wallet = creatorWallet || "CREATOR_WALLET";
  if (!royaltySplit) {
    return [{ address: wallet, share: 100 }];
  }
  const entries: { address: string; share: number }[] = [];
  if (royaltySplit.ownerPercent > 0) {
    entries.push({ address: wallet, share: royaltySplit.ownerPercent });
  }
  // Holder and buyback treasuries use platform-managed placeholder addresses in metadata;
  // actual routing is enforced off-chain until on-chain treasury contracts are wired.
  const treasury = process.env.PLATFORM_TREASURY_WALLET ?? wallet;
  if (royaltySplit.holdersPercent > 0) {
    entries.push({ address: treasury, share: royaltySplit.holdersPercent });
  }
  if (royaltySplit.buybackPercent > 0) {
    entries.push({ address: treasury, share: royaltySplit.buybackPercent });
  }
  if (entries.length === 0) return [{ address: wallet, share: 100 }];
  return entries;
}

export function buildTokenMetadataJson(opts: {
  name: string;
  symbol: string;
  description: string;
  sellerFeeBps: number;
  image: string;
  attributes: GeneratedToken["attributes"];
  creatorWallet: string;
  royaltySplit?: RoyaltySplit;
}): Record<string, unknown> {
  return {
    name: opts.name,
    symbol: opts.symbol,
    description: opts.description,
    seller_fee_basis_points: opts.sellerFeeBps,
    image: opts.image,
    attributes: opts.attributes,
    properties: {
      files: [{ uri: opts.image, type: "image/png" }],
      category: "image",
      creators: buildCreatorsFromRoyaltySplit(opts.creatorWallet, opts.royaltySplit),
    },
  };
}
