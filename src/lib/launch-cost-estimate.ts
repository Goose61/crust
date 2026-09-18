import { estimateArweaveBytes } from "@/lib/client-asset-store";
import { fetchStorageEstimate } from "@/lib/client-launch-api";
import { SOL_USD_FALLBACK } from "@/lib/price-display";
import { FEATURE_ON_MARKET_USD } from "@/lib/platform-fees";
import type { SolanaNetwork } from "@/lib/solana-config";

export type LaunchCostEstimate = {
  totalBytes: number;
  tokenCount: number;
  network: SolanaNetwork;
  /** Irys byte-price quote (before bundler buffer). */
  irysBaseSol: number;
  irysBundlerBufferSol: number;
  /** Irys quote + 10% bundler buffer — funded directly from creator wallet. */
  irysTotalSol: number;
  gasSol: number;
  totalSol: number;
  irysBaseUsd: number;
  totalUsd: number;
  solUsd: number;
  featuredPayTo: string | null;
  featuredFeeUsd: number;
};

export async function fetchLaunchCostEstimate(
  wallet: string,
  collectionId: string,
  tokenCount: number,
): Promise<LaunchCostEstimate> {
  const totalBytes = await estimateArweaveBytes(collectionId, tokenCount);
  const est = await fetchStorageEstimate(wallet, collectionId, totalBytes);
  const solUsd = est.solPriceUsd ?? SOL_USD_FALLBACK;
  const totalSol = est.walletPaymentSol + est.gasSol;

  return {
    totalBytes,
    tokenCount,
    network: est.network ?? "devnet",
    irysBaseSol: est.sol,
    irysBundlerBufferSol: est.irysBundlerBufferSol,
    irysTotalSol: est.irysTotalSol,
    gasSol: est.gasSol,
    totalSol,
    irysBaseUsd: est.sol * solUsd,
    totalUsd: totalSol * solUsd,
    solUsd,
    featuredPayTo: est.featuredPayTo ?? null,
    featuredFeeUsd: est.featuredFeeUsd ?? FEATURE_ON_MARKET_USD,
  };
}

export function formatLaunchBytes(bytes: number): string {
  if (bytes >= 1024 * 1024) return `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
  if (bytes >= 1024) return `${(bytes / 1024).toFixed(0)} KB`;
  return `${bytes} B`;
}
