/**
 * Fixed Crypgo marketplace fees (not creator-configurable).
 * SlicePay / checkout processor costs are absorbed by the platform — never passed to buyers or creators.
 */

/** Primary mint platform fee (% of mint price). */
export const PRIMARY_PLATFORM_FEE_PERCENT = 0.7;

/** Trade tax on primary mints (% of mint price). */
export const PRIMARY_TRADE_TAX_PERCENT = 0.3;

/** Secondary sale platform fee (% of sale price). */
export const SECONDARY_PLATFORM_FEE_PERCENT = 0.5;

export const PRIMARY_PLATFORM_TOTAL_PERCENT =
  PRIMARY_PLATFORM_FEE_PERCENT + PRIMARY_TRADE_TAX_PERCENT;

export function formatPlatformFeePercent(n: number): string {
  return n % 1 === 0 ? String(n) : n.toFixed(1).replace(/\.0$/, "");
}

export function primaryPlatformFeeLine(): string {
  return `${formatPlatformFeePercent(PRIMARY_PLATFORM_FEE_PERCENT)}% platform + ${formatPlatformFeePercent(PRIMARY_TRADE_TAX_PERCENT)}% trade tax (${formatPlatformFeePercent(PRIMARY_PLATFORM_TOTAL_PERCENT)}% total)`;
}

export function secondaryPlatformFeeLine(): string {
  return `${formatPlatformFeePercent(SECONDARY_PLATFORM_FEE_PERCENT)}% on secondary sales`;
}

/** Default creator revenue split (must sum to 100%; platform fees are separate). */
export const DEFAULT_CREATOR_FEE_SPLIT = {
  ownerPercent: 98,
  holdersPercent: 1,
  buybackPercent: 1,
  locked: false,
} as const;
