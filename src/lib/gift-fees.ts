import { fetchIrysPriceLamports } from "@/lib/irys-shared";

/** Token Metadata NFT account rent (legacy TM gifts). */
export const GIFT_MINT_RENT_LAMPORTS = BigInt(6_500_000);

/** Mint transaction fee buffer. */
export const GIFT_TX_FEE_LAMPORTS = BigInt(10_000);

/** Extra buffer so estimates err on the safe side. */
export const GIFT_FEE_BUFFER_LAMPORTS = BigInt(500_000);

const META_BYTES = 512;

export type GiftFeeEstimate = {
  storageLamports: bigint;
  storageWithBufferLamports: bigint;
  mintLamports: bigint;
  totalLamports: bigint;
  storageSol: number;
  mintSol: number;
  totalSol: number;
};

export function lamportsToSol(lamports: bigint): number {
  return Number(lamports) / 1_000_000_000;
}

/** Minimum SOL the payer needs for the mint step alone (after Arweave upload). */
export function getMintStepMinLamports(): bigint {
  return GIFT_MINT_RENT_LAMPORTS + GIFT_TX_FEE_LAMPORTS + GIFT_FEE_BUFFER_LAMPORTS;
}

export async function estimateGiftFees(
  imageBytes: number,
  devnet: boolean,
): Promise<GiftFeeEstimate> {
  const safeImageBytes = Math.max(0, imageBytes);
  const [imageLamports, metaLamports] = await Promise.all([
    safeImageBytes > 0
      ? fetchIrysPriceLamports(safeImageBytes, devnet)
      : Promise.resolve(BigInt(0)),
    fetchIrysPriceLamports(META_BYTES, devnet),
  ]);

  const storageLamports = imageLamports + metaLamports;
  const storageWithBufferLamports =
    storageLamports + storageLamports / 10n + BigInt(5000);
  const mintLamports = getMintStepMinLamports();
  const totalLamports = storageWithBufferLamports + mintLamports;

  return {
    storageLamports,
    storageWithBufferLamports,
    mintLamports,
    totalLamports,
    storageSol: lamportsToSol(storageWithBufferLamports),
    mintSol: lamportsToSol(mintLamports),
    totalSol: lamportsToSol(totalLamports),
  };
}

export function formatInsufficientBalanceMessage(params: {
  balanceSol: number;
  requiredSol: number;
  mintOnly?: boolean;
}): string {
  const shortfall = Math.max(0, params.requiredSol - params.balanceSol);
  if (params.mintOnly) {
    return (
      `Not enough SOL left for the mint step. You have ~${params.balanceSol.toFixed(4)} SOL ` +
      `but need ~${params.requiredSol.toFixed(4)} SOL for NFT account rent. ` +
      `Add ~${shortfall.toFixed(4)} SOL to your wallet and try again.`
    );
  }
  return (
    `Your wallet does not have enough SOL for this gift. You have ~${params.balanceSol.toFixed(4)} SOL ` +
    `but need ~${params.requiredSol.toFixed(4)} SOL total (~${shortfall.toFixed(4)} SOL short). ` +
    `Arweave storage is charged first, then the mint step — keep enough for both.`
  );
}
