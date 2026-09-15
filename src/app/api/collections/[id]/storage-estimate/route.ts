import { NextRequest, NextResponse } from "next/server";
import { getCollection } from "@/lib/store";
import { assertCreatorAuth, requireWalletAuth } from "@/lib/wallet-auth";
import { fetchIrysPriceLamports } from "@/lib/irys-shared";
import { isCollectionArweaveStoragePaid, isServerBulkArweaveAvailable } from "@/lib/arweave-storage-payment";
import { getPlatformPublicKey } from "@/lib/platform-key";
import { getSolanaNetwork, isDevnetNetwork } from "@/lib/solana-config";
import {
  IRYS_BUNDLER_BUFFER_MULTIPLIER,
  STORAGE_PAYMENT_GAS_SOL,
  STORAGE_PAYMENT_MULTIPLIER,
  STORAGE_WALLET_BUFFER_MULTIPLIER,
} from "@/lib/storage-cost-constants";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

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
    const irysBundlerBufferSol = sol * (IRYS_BUNDLER_BUFFER_MULTIPLIER - 1);
    const irysTotalSol = sol * IRYS_BUNDLER_BUFFER_MULTIPLIER;
    const walletBufferSol = storagePaid ? 0 : irysTotalSol * (STORAGE_WALLET_BUFFER_MULTIPLIER - 1);
    const walletPaymentSol = storagePaid ? 0 : sol * STORAGE_PAYMENT_MULTIPLIER;
    const gasSol = STORAGE_PAYMENT_GAS_SOL;
    const totalUpfrontSol = storagePaid ? 0 : walletPaymentSol + gasSol;

    return NextResponse.json({
      totalBytes,
      lamports: lamports.toString(),
      sol,
      irysBundlerBufferSol,
      irysTotalSol,
      walletBufferSol,
      walletPaymentSol,
      /** @deprecated use walletPaymentSol */
      solWithBuffer: walletPaymentSol,
      gasSol,
      /** @deprecated use gasSol */
      txFeeSol: gasSol,
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
