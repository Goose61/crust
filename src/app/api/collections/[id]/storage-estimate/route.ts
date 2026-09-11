import { NextRequest, NextResponse } from "next/server";
import { getCollection } from "@/lib/store";
import { assertCreatorAuth, requireWalletAuth } from "@/lib/wallet-auth";
import { fetchIrysPriceLamports } from "@/lib/irys-shared";
import { isCollectionArweaveStoragePaid, isServerBulkArweaveAvailable } from "@/lib/arweave-storage-payment";
import { getPlatformPublicKey } from "@/lib/platform-key";
import { getSolanaNetwork, isDevnetNetwork } from "@/lib/solana-config";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/** Matches payPlatformForArweaveStorage (+2% headroom). */
const STORAGE_PAYMENT_BUFFER = 1.02;
/** One wallet signature to pay for storage at Go Live. */
const LAUNCH_TX_FEE_SOL = 0.00001;

type Params = { params: Promise<{ id: string }> };

async function fetchSolPriceUsd(): Promise<number | null> {
  try {
    const res = await fetch(
      "https://lite-api.jup.ag/price/v2?ids=So11111111111111111111111111111111111111112",
      { signal: AbortSignal.timeout(3_000) },
    );
    if (!res.ok) return null;
    const json = (await res.json()) as { data: Record<string, { price: number }> };
    return json.data["So11111111111111111111111111111111111111112"]?.price ?? null;
  } catch {
    return null;
  }
}

export async function GET(req: NextRequest, { params }: Params) {
  try {
    const { id } = await params;
    const auth = requireWalletAuth(req);
    const collection = await getCollection(id);
    if (!collection) {
      return NextResponse.json({ error: "Collection not found" }, { status: 404 });
    }
    assertCreatorAuth(auth, collection.payments.creatorWallet);

    const totalBytes = Number(req.nextUrl.searchParams.get("totalBytes") || 0);
    if (!Number.isFinite(totalBytes) || totalBytes <= 0) {
      return NextResponse.json({ error: "totalBytes query param required" }, { status: 400 });
    }

    const network = getSolanaNetwork();
    const devnet = isDevnetNetwork(network);
    const [lamports, storagePaid, solPriceUsd] = await Promise.all([
      fetchIrysPriceLamports(totalBytes, devnet),
      isCollectionArweaveStoragePaid(id),
      fetchSolPriceUsd(),
    ]);
    const sol = Number(lamports) / 1e9;
    const solWithBuffer = storagePaid ? 0 : sol * STORAGE_PAYMENT_BUFFER;
    const totalUpfrontSol = storagePaid ? LAUNCH_TX_FEE_SOL : solWithBuffer + LAUNCH_TX_FEE_SOL;

    return NextResponse.json({
      totalBytes,
      lamports: lamports.toString(),
      sol,
      solWithBuffer,
      txFeeSol: LAUNCH_TX_FEE_SOL,
      totalUpfrontSol,
      solPriceUsd,
      storageUsd: solPriceUsd != null ? sol * solPriceUsd : null,
      totalUpfrontUsd: solPriceUsd != null ? totalUpfrontSol * solPriceUsd : null,
      network,
      serverBulkUpload: isServerBulkArweaveAvailable(),
      platformWallet: getPlatformPublicKey(),
      storagePaid,
    });
  } catch (e) {
    const message = e instanceof Error ? e.message : "Estimate failed";
    const status =
      message.includes("signature") || message.includes("creator") ? 401 : 400;
    return NextResponse.json({ error: message }, { status });
  }
}
