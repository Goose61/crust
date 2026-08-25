import {
  estimateGiftFees,
  GIFT_MINT_RENT_LAMPORTS,
  GIFT_TX_FEE_LAMPORTS,
  lamportsToSol,
} from "@/lib/gift-fees";
import { isDevnetNetwork } from "@/lib/solana-config";

export const runtime = "nodejs";

async function getSolPrice(): Promise<number> {
  try {
    const res = await fetch(
      "https://lite-api.jup.ag/price/v2?ids=So11111111111111111111111111111111111111112",
      { signal: AbortSignal.timeout(3_000) },
    );
    if (!res.ok) return 0;
    const json = (await res.json()) as { data: Record<string, { price: number }> };
    return json.data["So11111111111111111111111111111111111111112"]?.price ?? 0;
  } catch {
    return 0;
  }
}

export async function GET(req: Request) {
  const url = new URL(req.url);
  const imageBytes = Math.max(0, parseInt(url.searchParams.get("imageBytes") ?? "0", 10) || 0);
  const devnet = isDevnetNetwork();

  const [fees, solPrice] = await Promise.all([
    estimateGiftFees(imageBytes, devnet),
    getSolPrice(),
  ]);

  const totalSol = fees.totalSol;
  const totalUsd = solPrice > 0 ? totalSol * solPrice : null;

  return Response.json({
    user: {
      breakdown: {
        storage: {
          lamports: fees.storageWithBufferLamports.toString(),
          sol: fees.storageSol,
          label: "Arweave storage (image + metadata)",
        },
        rent: {
          lamports: GIFT_MINT_RENT_LAMPORTS.toString(),
          sol: lamportsToSol(GIFT_MINT_RENT_LAMPORTS),
          label: "NFT mint account rent (mint step)",
        },
        txFee: {
          lamports: GIFT_TX_FEE_LAMPORTS.toString(),
          sol: lamportsToSol(GIFT_TX_FEE_LAMPORTS),
          label: "Mint transaction fee",
        },
      },
      lamports: fees.totalLamports.toString(),
      sol: totalSol,
      usd: totalUsd,
    },
    solPrice,
    note:
      "Arweave storage is charged first, then the mint step needs ~0.02 SOL left in your wallet for account rent.",
  });
}
