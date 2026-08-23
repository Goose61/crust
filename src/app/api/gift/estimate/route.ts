import { fetchIrysPriceLamports } from "@/lib/irys-shared";

export const runtime = "nodejs";

// Metaplex Core on-chain costs (lamports) — https://www.metaplex.com/docs/smart-contracts/core
const SOLANA_RENT_LAMPORTS = BigInt(2900000);
const MPL_PROTOCOL_LAMPORTS = BigInt(1500000);
const TX_FEE_LAMPORTS = BigInt(5000);
// SOL transfer to ephemeral wallet + Irys fund tx overheads
const EPHEMERAL_OVERHEAD_LAMPORTS = BigInt(20000);

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
  const metaBytes = 512;
  const devnet = process.env.SOLANA_RPC_URL?.includes("devnet") ?? false;

  const [imageLamports, metaLamports, solPrice] = await Promise.all([
    imageBytes > 0 ? fetchIrysPriceLamports(imageBytes, devnet) : Promise.resolve(BigInt(0)),
    fetchIrysPriceLamports(metaBytes, devnet),
    getSolPrice(),
  ]);

  const storageLamports = imageLamports + metaLamports;
  const storageWithBuffer = storageLamports + storageLamports / 6n + EPHEMERAL_OVERHEAD_LAMPORTS;

  const chainLamports = SOLANA_RENT_LAMPORTS + MPL_PROTOCOL_LAMPORTS + TX_FEE_LAMPORTS;
  const totalLamports = storageWithBuffer + chainLamports;

  const toSol = (l: bigint) => Number(l) / 1_000_000_000;
  const totalSol = toSol(totalLamports);
  const totalUsd = solPrice > 0 ? totalSol * solPrice : null;

  return Response.json({
    user: {
      breakdown: {
        storage: {
          lamports: storageWithBuffer.toString(),
          sol: toSol(storageWithBuffer),
          label: "Arweave storage (image + metadata)",
        },
        rent: {
          lamports: SOLANA_RENT_LAMPORTS.toString(),
          sol: toSol(SOLANA_RENT_LAMPORTS),
          label: "Solana account rent",
        },
        protocol: {
          lamports: MPL_PROTOCOL_LAMPORTS.toString(),
          sol: toSol(MPL_PROTOCOL_LAMPORTS),
          label: "Metaplex Core protocol fee",
        },
        txFee: {
          lamports: TX_FEE_LAMPORTS.toString(),
          sol: toSol(TX_FEE_LAMPORTS),
          label: "Mint transaction fee",
        },
      },
      lamports: totalLamports.toString(),
      sol: totalSol,
      usd: totalUsd,
    },
    solPrice,
    note: "All fees are paid from your connected wallet when you approve each step.",
  });
}
