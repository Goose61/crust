import { NextRequest, NextResponse } from "next/server";
import {
  estimateGiftFees,
  formatInsufficientBalanceMessage,
  lamportsToSol,
} from "@/lib/gift-fees";
import { isValidSolanaAddress } from "@/lib/mint-nft";
import { getDirectRpcUrl, parseNetwork } from "@/lib/solana-config";

export const runtime = "nodejs";

async function fetchWalletBalanceLamports(
  rpcUrl: string,
  wallet: string,
): Promise<bigint> {
  const res = await fetch(rpcUrl, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({
      jsonrpc: "2.0",
      id: 1,
      method: "getBalance",
      params: [wallet, { commitment: "confirmed" }],
    }),
    signal: AbortSignal.timeout(15_000),
  });
  const json = (await res.json()) as {
    result?: { value: number };
    error?: { message: string };
  };
  if (json.error) throw new Error(json.error.message);
  return BigInt(json.result?.value ?? 0);
}

/** Pre-check payer balance before gift upload + mint. */
export async function GET(req: NextRequest) {
  try {
    const url = new URL(req.url);
    const wallet = String(url.searchParams.get("wallet") || "").trim();
    const imageBytes = Math.max(
      0,
      parseInt(url.searchParams.get("imageBytes") ?? "0", 10) || 0,
    );
    const network = parseNetwork(url.searchParams.get("network"));

    if (!wallet || !isValidSolanaAddress(wallet)) {
      return NextResponse.json({ error: "Valid wallet address required" }, { status: 400 });
    }

    const devnet = network === "devnet";
    const fees = await estimateGiftFees(imageBytes, devnet);
    const rpcUrl = getDirectRpcUrl(network);
    const balanceLamports = await fetchWalletBalanceLamports(rpcUrl, wallet);
    const balanceSol = lamportsToSol(balanceLamports);
    const requiredSol = fees.totalSol;
    const sufficient = balanceLamports >= fees.totalLamports;
    const shortfallSol = sufficient ? 0 : requiredSol - balanceSol;

    return NextResponse.json({
      network,
      balanceSol,
      requiredSol,
      storageSol: fees.storageSol,
      mintSol: fees.mintSol,
      shortfallSol,
      sufficient,
      message: sufficient
        ? null
        : formatInsufficientBalanceMessage({ balanceSol, requiredSol }),
    });
  } catch (err) {
    console.error("[GET /api/gift/balance-check]", err);
    const message = err instanceof Error ? err.message : "Balance check failed";
    return NextResponse.json({ error: message }, { status: 500 });
  }
}
