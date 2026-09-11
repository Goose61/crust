import { estimateArweaveBytes } from "@/lib/client-asset-store";
import { fetchStorageEstimate } from "@/lib/client-launch-api";
import { SOL_USD_FALLBACK } from "@/lib/price-display";

export type LaunchCostEstimate = {
  totalBytes: number;
  tokenCount: number;
  /** Irys quote before payment buffer. */
  storageSol: number;
  /** SOL due at Go Live (0 if already paid). Includes +2% payment buffer. */
  storageSolDue: number;
  txFeeSol: number;
  totalSol: number;
  storageUsd: number;
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
  const storageSolDue = est.storagePaid ? 0 : est.solWithBuffer;
  const totalSol = storageSolDue + est.txFeeSol;

  return {
    totalBytes,
    tokenCount,
    storageSol: est.sol,
    storageSolDue,
    txFeeSol: est.txFeeSol,
    totalSol,
    storageUsd: est.sol * solUsd,
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
