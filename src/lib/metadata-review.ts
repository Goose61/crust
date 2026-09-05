import type {
  Collection,
  GeneratedToken,
  MetadataCreator,
  TokenSidecar,
} from "./types";

function isValidSolanaAddress(addr: string): boolean {
  if (!addr || addr.length < 32 || addr.length > 44) return false;
  if (!/^[1-9A-HJ-NP-Za-km-z]+$/.test(addr)) return false;
  return true;
}

const CORE_NAME_MAX = 32;
const WEAK_SYMBOL_MAX = 1;
const MAX_CREATORS = 5;

export type MetadataIssue = {
  severity: "error" | "warning";
  code: string;
  message: string;
};

export type MetadataReview = {
  tokenCount: number;
  sidecarCount: number;
  missingSidecarCount: number;
  uniqueSymbols: string[];
  uniqueBps: number[];
  uniqueCreatorSets: string[];
  consensus: {
    symbol?: string;
    description?: string;
    sellerFeeBps?: number;
    creators?: MetadataCreator[];
  };
  issues: MetadataIssue[];
  samples: {
    tokenId: number;
    name: string;
    symbol?: string;
    sellerFeeBps?: number;
    creators?: MetadataCreator[];
    traitCount: number;
    sidecarPresent: boolean;
  }[];
};

function asCreators(raw: unknown): MetadataCreator[] | undefined {
  if (!Array.isArray(raw)) return undefined;
  const creators: MetadataCreator[] = [];
  for (const entry of raw) {
    if (!entry || typeof entry !== "object") continue;
    const rec = entry as { address?: unknown; share?: unknown };
    const address = String(rec.address ?? "").trim();
    const share = Number(rec.share);
    if (!address) continue;
    creators.push({ address, share: Number.isFinite(share) ? share : 0 });
  }
  return creators.length > 0 ? creators : undefined;
}

export function parseSidecarJson(raw: unknown): TokenSidecar {
  if (!raw || typeof raw !== "object") return { present: false };
  const rec = raw as Record<string, unknown>;
  const properties =
    rec.properties && typeof rec.properties === "object"
      ? (rec.properties as Record<string, unknown>)
      : {};
  const bpsRaw = rec.seller_fee_basis_points ?? rec.sellerFeeBasisPoints;
  const bps = bpsRaw != null ? Number(bpsRaw) : undefined;
  return {
    present: true,
    name: rec.name != null ? String(rec.name) : undefined,
    symbol: rec.symbol != null ? String(rec.symbol) : undefined,
    description: rec.description != null ? String(rec.description) : undefined,
    sellerFeeBps: bps != null && Number.isFinite(bps) ? bps : undefined,
    creators: asCreators(properties.creators ?? rec.creators),
    image: rec.image != null ? String(rec.image) : undefined,
  };
}

export function creatorsKey(creators?: MetadataCreator[]): string {
  if (!creators?.length) return "";
  return creators.map((c) => `${c.address}:${c.share}`).join("|");
}

function mostCommon<T>(values: T[], keyFn: (v: T) => string): T | undefined {
  if (values.length === 0) return undefined;
  const counts = new Map<string, { count: number; value: T }>();
  for (const value of values) {
    const key = keyFn(value);
    const prev = counts.get(key);
    if (prev) prev.count += 1;
    else counts.set(key, { count: 1, value });
  }
  let best: { count: number; value: T } | undefined;
  for (const entry of counts.values()) {
    if (!best || entry.count > best.count) best = entry;
  }
  return best?.value;
}

export function reviewCollectionMetadata(collection: Collection): MetadataReview {
  const tokens = collection.tokens;
  const sidecars = tokens.map((t) => t.sidecar).filter((s): s is TokenSidecar => Boolean(s?.present));
  const symbols = sidecars.map((s) => s.symbol).filter((s): s is string => Boolean(s && s.trim()));
  const bps = sidecars
    .map((s) => s.sellerFeeBps)
    .filter((n): n is number => n != null && Number.isFinite(n));
  const creatorSets = sidecars
    .map((s) => s.creators)
    .filter((c): c is MetadataCreator[] => Boolean(c?.length));

  const uniqueSymbols = Array.from(new Set(symbols));
  const uniqueBps = Array.from(new Set(bps)).sort((a, b) => a - b);
  const uniqueCreatorSets = Array.from(new Set(creatorSets.map(creatorsKey)));

  const consensusCreators = mostCommon(creatorSets, creatorsKey);
  const consensus: MetadataReview["consensus"] = {
    symbol: mostCommon(symbols, (s) => s) ?? collection.symbol,
    description: mostCommon(
      sidecars.map((s) => s.description).filter((s): s is string => Boolean(s)),
      (s) => s,
    ) ?? collection.description,
    sellerFeeBps: mostCommon(bps, (n) => String(n)) ?? collection.royaltyBps,
    creators: consensusCreators ?? collection.royaltyCreators,
  };

  const issues: MetadataIssue[] = [];
  const missingSidecarCount = tokens.filter((t) => !t.sidecar?.present).length;

  if (tokens.length === 0) {
    issues.push({ severity: "error", code: "no-tokens", message: "No NFTs in this collection yet." });
  }
  if (missingSidecarCount > 0 && missingSidecarCount < tokens.length) {
    issues.push({
      severity: "warning",
      code: "partial-sidecars",
      message: `${missingSidecarCount} of ${tokens.length} images have no sidecar JSON.`,
    });
  }
  if (tokens.length > 0 && missingSidecarCount === tokens.length) {
    issues.push({
      severity: "warning",
      code: "no-sidecars",
      message: "No sidecar JSON found. Royalty and creator fields will use the values you set below.",
    });
  }
  const jsonCount = collection.sidecarJsonCount ?? sidecars.length;
  if (jsonCount > 0 && jsonCount !== tokens.length) {
    issues.push({
      severity: "warning",
      code: "count-mismatch",
      message: `Found ${jsonCount} metadata JSON files and ${tokens.length} images.`,
    });
  }
  if (uniqueBps.length > 1) {
    issues.push({
      severity: collection.metadataConfirmed ? "warning" : "error",
      code: "mixed-bps",
      message: collection.metadataConfirmed
        ? `Imported JSON used mixed royalty rates (${uniqueBps.join(", ")} bps). Go-live will use the collection-wide rate you applied.`
        : `Tokens use mixed royalty rates: ${uniqueBps.join(", ")} bps. Apply one rate to all before going live.`,
    });
  }
  if (uniqueCreatorSets.length > 1) {
    issues.push({
      severity: collection.metadataConfirmed ? "warning" : "error",
      code: "mixed-creators",
      message: collection.metadataConfirmed
        ? "Imported JSON used different creator sets. Go-live will use the creators you applied."
        : "Tokens use different creator addresses or shares. Apply one creator set to all.",
    });
  }
  if (uniqueSymbols.length > 1) {
    issues.push({
      severity: "warning",
      code: "mixed-symbols",
      message: `Multiple symbols found (${uniqueSymbols.join(", ")}). Apply one symbol to all.`,
    });
  }

  const effectiveBps = collection.royaltyBps ?? consensus.sellerFeeBps;
  if (effectiveBps != null && (effectiveBps < 0 || effectiveBps > 10_000)) {
    issues.push({
      severity: "error",
      code: "bps-range",
      message: `Royalty basis points must be 0–10000 (got ${effectiveBps}).`,
    });
  }

  const creators = collection.royaltyCreators ?? consensus.creators ?? [];
  if (creators.length > MAX_CREATORS) {
    issues.push({
      severity: "error",
      code: "too-many-creators",
      message: `Metaplex Core supports at most ${MAX_CREATORS} royalty creators.`,
    });
  }
  const shareSum = creators.reduce((sum, c) => sum + Number(c.share || 0), 0);
  if (creators.length > 0 && shareSum !== 100) {
    issues.push({
      severity: "error",
      code: "share-sum",
      message: `Creator shares must sum to 100 (currently ${shareSum}).`,
    });
  }
  for (const creator of creators) {
    if (!isValidSolanaAddress(creator.address)) {
      issues.push({
        severity: "error",
        code: "bad-address",
        message: `Invalid creator address: ${creator.address || "(empty)"}`,
      });
    }
  }

  const symbol = (collection.symbol || consensus.symbol || "").trim();
  if (!symbol) {
    issues.push({
      severity: "error",
      code: "no-symbol",
      message: "Collection symbol is empty.",
    });
  } else if (symbol.length <= WEAK_SYMBOL_MAX) {
    issues.push({
      severity: "warning",
      code: "weak-symbol",
      message: `Symbol "${symbol}" is too short for wallets and marketplaces. Use 2–10 characters.`,
    });
  }

  const longNames = tokens.filter((t) => (t.sidecar?.name ?? "").length > CORE_NAME_MAX);
  if (collection.name.length > CORE_NAME_MAX) {
    issues.push({
      severity: "error",
      code: "name-length",
      message: `Collection name is ${collection.name.length} characters. Core on-chain names max out at ${CORE_NAME_MAX}.`,
    });
  } else if (longNames.length > 0) {
    issues.push({
      severity: "warning",
      code: "token-name-length",
      message: `${longNames.length} token names exceed ${CORE_NAME_MAX} characters (Core on-chain limit). They will be truncated at mint.`,
    });
  }

  const missingTraits = tokens.filter((t) => t.attributes.length === 0).length;
  if (missingTraits > 0) {
    issues.push({
      severity: "warning",
      code: "no-attributes",
      message: `${missingTraits} tokens have no attributes.`,
    });
  }

  const samples = tokens.slice(0, 8).map((t) => ({
    tokenId: t.tokenId,
    name: t.sidecar?.name || `${collection.name} #${t.tokenId}`,
    symbol: t.sidecar?.symbol,
    sellerFeeBps: t.sidecar?.sellerFeeBps,
    creators: t.sidecar?.creators,
    traitCount: t.attributes.length,
    sidecarPresent: Boolean(t.sidecar?.present),
  }));

  return {
    tokenCount: tokens.length,
    sidecarCount: sidecars.length,
    missingSidecarCount,
    uniqueSymbols,
    uniqueBps,
    uniqueCreatorSets,
    consensus,
    issues,
    samples,
  };
}

export function seedCollectionFromSidecars(
  collection: Collection,
  tokens: GeneratedToken[],
  jsonFileCount: number,
): Collection {
  const review = reviewCollectionMetadata({ ...collection, tokens, sidecarJsonCount: jsonFileCount });
  return {
    ...collection,
    tokens,
    sidecarJsonCount: jsonFileCount,
    royaltyBps: review.consensus.sellerFeeBps ?? collection.royaltyBps,
    royaltyCreators: review.consensus.creators ?? collection.royaltyCreators,
    symbol: review.consensus.symbol || collection.symbol,
    description: review.consensus.description || collection.description,
  };
}

export function applyMetadataOverrides(
  collection: Collection,
  overrides: {
    royaltyBps: number;
    royaltyCreators: MetadataCreator[];
    symbol: string;
    description: string;
  },
): Collection {
  const creators = overrides.royaltyCreators
    .map((c) => ({ address: c.address.trim(), share: Number(c.share) || 0 }))
    .filter((c) => c.address.length > 0);
  const tokens = collection.tokens.map((token) => ({
    ...token,
    sidecar: {
      present: true,
      name: token.sidecar?.name,
      symbol: overrides.symbol,
      description: overrides.description,
      sellerFeeBps: overrides.royaltyBps,
      creators,
      image: token.sidecar?.image,
    },
  }));
  return {
    ...collection,
    tokens,
    royaltyBps: overrides.royaltyBps,
    royaltyCreators: creators,
    symbol: overrides.symbol,
    description: overrides.description,
    metadataConfirmed: true,
  };
}

export function metadataReviewBlocksLaunch(review: MetadataReview): boolean {
  return review.issues.some((i) => i.severity === "error");
}
