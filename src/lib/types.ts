export type ChainKey = "solana" | "ethereum" | "base" | "polygon";

export type CollectionStatus = "draft" | "live" | "sold_out" | "archived";

export type RevealTrigger =
  | "at_percent"
  | "at_sold_out"
  | "at_datetime"
  | "manual"
  | "staggered";

export type MilestoneEventId =
  | "reveal_all"
  | "reveal_batch"
  | "reveal_rarity_chart"
  | "unlock_trait_browser"
  | "enable_secondary"
  | "enable_gift_mint"
  | "enable_bundle_mint"
  | "mint_price_increase"
  | "close_primary_mint"
  | "open_public_mint"
  | "unlock_holder_page"
  | "snapshot_holders"
  | "airdrop_spl"
  | "enable_sequel_allowlist"
  | "discord_role_sync"
  | "featured_homepage"
  | "creator_banner"
  | "live_mint_feed"
  | "referral_bonus_boost"
  | "treasury_buyback"
  | "fee_distribution";

export const MILESTONE_EVENTS: {
  id: MilestoneEventId;
  label: string;
  category: string;
}[] = [
  { id: "reveal_all", label: "Reveal all metadata", category: "Reveal" },
  { id: "reveal_batch", label: "Reveal next batch", category: "Reveal" },
  { id: "reveal_rarity_chart", label: "Publish rarity chart", category: "Reveal" },
  { id: "unlock_trait_browser", label: "Unlock trait browser", category: "Reveal" },
  { id: "enable_secondary", label: "Enable marketplace listings", category: "Marketplace" },
  { id: "enable_gift_mint", label: "Enable gift mint", category: "Marketplace" },
  { id: "enable_bundle_mint", label: "Enable bundle discount", category: "Marketplace" },
  { id: "mint_price_increase", label: "Increase mint price", category: "Marketplace" },
  { id: "close_primary_mint", label: "Close primary mint", category: "Marketplace" },
  { id: "open_public_mint", label: "Open public mint", category: "Marketplace" },
  { id: "unlock_holder_page", label: "Unlock holder page", category: "Holders" },
  { id: "snapshot_holders", label: "Snapshot holders", category: "Holders" },
  { id: "airdrop_spl", label: "Airdrop SPL token", category: "Holders" },
  { id: "enable_sequel_allowlist", label: "Sequel allowlist from holders", category: "Holders" },
  { id: "discord_role_sync", label: "Sync Discord holder roles", category: "Holders" },
  { id: "featured_homepage", label: "Feature on homepage", category: "Marketing" },
  { id: "creator_banner", label: "Show creator banner", category: "Marketing" },
  { id: "live_mint_feed", label: "Live mint feed", category: "Marketing" },
  { id: "referral_bonus_boost", label: "Boost referral bonus", category: "Marketing" },
  { id: "treasury_buyback", label: "Treasury buyback", category: "Treasury" },
  { id: "fee_distribution", label: "Open fee claims", category: "Treasury" },
];

export type TraitFile = {
  traitType: string;
  value: string;
  fileName: string;
};

export type LayerCatalog = {
  traitType: string;
  values: { value: string; fileName: string; weight: number; blobUrl?: string }[];
};

export type Milestone = {
  at: number;
  events: MilestoneEventId[];
  firedAt?: string | null;
};

export type PaymentSettings = {
  basePriceUsd: number;
  acceptSol: boolean;
  acceptUsdc: boolean;
  acceptPizza: boolean;
  acceptSlicePay: boolean;
  pizzaDiscountPercent: number;
  giftMintEnabled: boolean;
  creatorWallet: string;
};

export const defaultPayments = (
  overrides: Partial<PaymentSettings> = {},
): PaymentSettings => ({
  basePriceUsd: 25,
  acceptSol: true,
  acceptUsdc: true,
  acceptPizza: true,
  acceptSlicePay: true,
  pizzaDiscountPercent: 0,
  giftMintEnabled: false,
  creatorWallet: "",
  ...overrides,
});

export type FeeSplit = {
  ownerPercent: number;
  holdersPercent: number;
  buybackPercent: number;
  platformPercent: number;
  locked: boolean;
};

export type GeneratedToken = {
  tokenId: number;
  dna: string;
  attributes: { trait_type: string; value: string | number; display_type?: string; max_value?: number }[];
  imageRelPath: string;
  metadataRelPath: string;
  imageUri?: string;
  metadataUri?: string;
  owner?: string | null;
  /** On-chain Metaplex Core asset address, set after a real mint */
  assetAddress?: string;
  /** Explorer link for the mint transaction */
  mintTxUrl?: string;
};

/** Server-only co-sign data for in-progress gift mints (cleared after confirm). */
export type PendingMint = {
  assetSecretKeyB64: string;
  assetAddress: string;
  /** Snapshot of mint params so the tx can be rebuilt with a fresh blockhash. */
  name: string;
  metadataUri: string;
  recipient: string;
  payer: string;
};

export type CollectionSocials = {
  twitter?: string;
  discord?: string;
  website?: string;
  telegram?: string;
};

export type RoyaltySplit = {
  ownerPercent: number;
  holdersPercent: number;
  buybackPercent: number;
};

export type TraitRarity = "common" | "rare" | "epic";

export type TraitPricing = {
  [traitType: string]: {
    [value: string]: { rarity: TraitRarity; priceModifier: number };
  };
};

export type Collection = {
  id: string;
  slug: string;
  name: string;
  symbol: string;
  description: string;
  nameTemplate: string;
  chain: ChainKey;
  status: CollectionStatus;
  supply: number;
  mintedCount: number;
  artPath: "path-b" | "path-a";
  stackOrder: string[];
  layers: LayerCatalog[];
  blindMint: boolean;
  placeholderUri?: string;
  revealTrigger: RevealTrigger;
  revealAtPercent?: number;
  revealAt?: string | null;
  revealed: boolean;
  milestones: Milestone[];
  payments: PaymentSettings;
  fees: FeeSplit;
  allowlist: string[];
  waitlist: string[];
  publicMintOpen: boolean;
  secondaryEnabled: boolean;
  holderPageUnlocked: boolean;
  featuredUntil?: string | null;
  banner?: string | null;
  irysPublished: boolean;
  logoUrl?: string;
  logoBlob?: string;
  royaltyBps?: number;
  royaltySplit?: RoyaltySplit;
  socials?: CollectionSocials;
  traitPricing?: TraitPricing;
  /** Ephemeral asset keypair for Phantom-first multi-signer mint flow */
  pendingMint?: PendingMint;
  createdAt: string;
  updatedAt: string;
  tokens: GeneratedToken[];
};

export type LaunchTemplateId = "pfp" | "1of1" | "meme-token" | "holder-sequel";
