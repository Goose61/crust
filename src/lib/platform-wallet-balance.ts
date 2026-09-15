import { getDirectRpcUrl, type SolanaNetwork } from "./solana-config";
import { getPlatformPublicKey } from "./platform-key";

const TX_FEE_RESERVE_LAMPORTS = 50_000n;

export type PlatformWalletBalance = {
  address: string;
  network: SolanaNetwork;
  onChainLamports: bigint;
  rentExemptLamports: bigint;
  transferableLamports: bigint;
  onChainSol: number;
  transferableSol: number;
};

export async function getPlatformWalletBalance(
  network: SolanaNetwork,
): Promise<PlatformWalletBalance | null> {
  const address = getPlatformPublicKey();
  if (!address) return null;

  const { Connection, PublicKey } = await import("@solana/web3.js");
  const connection = new Connection(getDirectRpcUrl(network), "confirmed");
  const onChainLamports = BigInt(await connection.getBalance(new PublicKey(address)));
  const rentExemptLamports = BigInt(await connection.getMinimumBalanceForRentExemption(0));
  const transferableLamports =
    onChainLamports > rentExemptLamports + TX_FEE_RESERVE_LAMPORTS
      ? onChainLamports - rentExemptLamports - TX_FEE_RESERVE_LAMPORTS
      : 0n;

  return {
    address,
    network,
    onChainLamports,
    rentExemptLamports,
    transferableLamports,
    onChainSol: Number(onChainLamports) / 1e9,
    transferableSol: Number(transferableLamports) / 1e9,
  };
}
