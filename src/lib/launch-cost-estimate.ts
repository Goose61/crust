import { estimateArweaveBytes } from "@/lib/client-asset-store";
import { fetchStorageEstimate } from "@/lib/client-launch-api";
import { SOL_USD_FALLBACK } from "@/lib/price-display";
import type { SolanaNetwork } from "@/lib/solana-config";

export type LaunchCostEstimate = {
  totalBytes: number;
  tokenCount: number;
  network: SolanaNetwork;
  /** Irys byte-price quote (before bundler buffer). */
  irysBaseSol: number;
  irysBundlerBufferSol: number;
  irysTotalSol: number;
  walletBufferSol: number;
  walletPaymentSol: number;
  gasSol: number;
  totalSol: number;
  irysBaseUsd: number;
  walletPaymentUsd: number;
  gasUsd: number;
  totalUsd: number;
  storagePaid: boolean;
  serverBulkUpload: boolean;
  solUsd: number;
};

export async function fetchLaunchCostEstimate(
  wallet: string,
  collectionId: string,
  tokenCount: number,
): Promise<LaunchCostEstimate> {
  const totalBytes = await estimateArweaveBytes(collectionId, tokenCount);
  const est = await fetchStorageEstimate(wallet, collectionId, totalBytes);
  const solUsd = est.solPriceUsd ?? SOL_USD_FALLBACK;
  const walletPaymentSol = est.storagePaid ? 0 : est.walletPaymentSol;
  const gasSol = est.storagePaid ? 0 : est.gasSol;
  const totalSol = walletPaymentSol + gasSol;

  return {
    totalBytes,
    tokenCount,
    network: est.network ?? "devnet",
    irysBaseSol: est.sol,
    irysBundlerBufferSol: est.irysBundlerBufferSol,
    irysTotalSol: est.irysTotalSol,
    walletBufferSol: est.storagePaid ? 0 : est.walletBufferSol,
    walletPaymentSol,
    gasSol,
    totalSol,
    irysBaseUsd: est.sol * solUsd,
    walletPaymentUsd: walletPaymentSol * solUsd,
    gasUsd: gasSol * solUsd,
    totalUsd: totalSol * solUsd,
    storagePaid: !!est.storagePaid,
    serverBulkUpload: !!est.serverBulkUpload,
    solUsd,
  };
}

export function formatLaunchBytes(bytes: number): string {
  if (bytes >= 1024 * 1024) return `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
  if (bytes >= 1024) return `${(bytes / 1024).toFixed(0)} KB`;
  return `${bytes} B`;
}
