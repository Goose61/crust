/**
 * GET /api/gift/estimate?imageBytes=N
 *
 * Returns a live fee breakdown for minting a gift NFT:
 *   - platform_lamports: what the platform pays for Arweave storage
 *   - user_lamports:     what the minter pays in Solana chain fees
 *   - sol_usd:           live SOL/USD price from Jupiter
 *   - user_usd:          estimated USD cost for the minter
 */

import { NextRequest, NextResponse } from "next/server";
import { getIrysPrice } from "@/lib/irys";

export const runtime = "nodejs";

// Fixed on-chain costs (in lamports) — values from Metaplex docs (2025/2026)
// https://www.metaplex.com/docs/smart-contracts/core
const SOLANA_RENT_LAMPORTS = BigInt(2900000);   // ~0.0029 SOL account rent
const MPL_PROTOCOL_LAMPORTS = BigInt(1500000);  // 0.0015 SOL Metaplex Core create fee
const TX_FEE_LAMPORTS = BigInt(5000);            // ~0.000005 SOL base tx fee

/** Fetch the current SOL/USD price from Jupiter price API. */
async function getSolPrice(): Promise<number> {
  try {
    const res = await fetch(
      "https://lite-api.jup.ag/price/v2?ids=So11111111111111111111111111111111111111112",
      { signal: AbortSignal.timeout(3_000) },
    );
    if (!res.ok) return 0;
    const json = await res.json() as {
      data: Record<string, { price: number }>;
    };
    return json.data["So11111111111111111111111111111111111111112"]?.price ?? 0;
  } catch {
    return 0;
  }
}

export async function GET(req: NextRequest) {
  const raw = req.nextUrl.searchParams.get("imageBytes");
  const imageBytes = raw ? Math.max(0, parseInt(raw, 10) || 0) : 0;

  // Estimate metadata JSON size (typical: ~500 bytes)
  const metaBytes = 512;

  // Fetch Irys upload prices and SOL spot price in parallel
  const [imageLamports, metaLamports, solPrice] = await Promise.all([
    imageBytes > 0 ? getIrysPrice(imageBytes) : Promise.resolve(BigInt(0)),
    getIrysPrice(metaBytes),
    getSolPrice(),
  ]);

  const platformLamports = imageLamports + metaLamports;
  const userLamports =
    SOLANA_RENT_LAMPORTS + MPL_PROTOCOL_LAMPORTS + TX_FEE_LAMPORTS;

  const lamportsToSol = (l: bigint) => Number(l) / 1_000_000_000;

  const platformSol = lamportsToSol(platformLamports);
  const userSol = lamportsToSol(userLamports);
  const userUsd = solPrice > 0 ? userSol * solPrice : null;

  return NextResponse.json({
    platform: {
      lamports: platformLamports.toString(),
      sol: platformSol,
      description: "Arweave permanent storage (paid by platform)",
    },
    user: {
      breakdown: {
        rent:     { lamports: SOLANA_RENT_LAMPORTS.toString(),   sol: lamportsToSol(SOLANA_RENT_LAMPORTS),   label: "Solana account rent" },
        protocol: { lamports: MPL_PROTOCOL_LAMPORTS.toString(), sol: lamportsToSol(MPL_PROTOCOL_LAMPORTS), label: "Metaplex Core protocol fee" },
        txFee:    { lamports: TX_FEE_LAMPORTS.toString(),        sol: lamportsToSol(TX_FEE_LAMPORTS),        label: "Transaction fee" },
      },
      lamports: userLamports.toString(),
      sol: userSol,
      usd: userUsd,
      description: "On-chain fees paid from your wallet",
    },
    solPrice,
    note: "Arweave storage is covered by the platform. You only pay Solana network fees.",
  });
}
