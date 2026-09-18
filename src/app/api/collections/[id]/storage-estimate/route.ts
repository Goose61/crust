import { NextRequest, NextResponse } from "next/server";
import { getCollection } from "@/lib/store";
import { assertCreatorAuth, requireWalletAuth } from "@/lib/wallet-auth";
import { fetchIrysPriceLamports } from "@/lib/irys-shared";
import { isServerBulkArweaveAvailable } from "@/lib/arweave-storage-payment";
import { getPlatformPublicKey } from "@/lib/platform-key";
import { getSolanaNetwork, isDevnetNetwork } from "@/lib/solana-config";
import {
  IRYS_BUNDLER_BUFFER_MULTIPLIER,
  STORAGE_PAYMENT_GAS_SOL,
} from "@/lib/storage-cost-constants";
import { fetchSolUsd } from "@/lib/sol-price";
import { FEATURE_ON_MARKET_USD } from "@/lib/platform-fees";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

type Params = { params: Promise<{ id: string }> };

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
    const [lamports, solPriceUsd] = await Promise.all([
      fetchIrysPriceLamports(totalBytes, devnet),
      fetchSolUsd(),
    ]);
    const sol = Number(lamports) / 1e9;
    const irysBundlerBufferSol = sol * (IRYS_BUNDLER_BUFFER_MULTIPLIER - 1);
    const irysTotalSol = sol * IRYS_BUNDLER_BUFFER_MULTIPLIER;
    /** Creator funds Irys directly from their wallet (no platform wallet). */
    const walletPaymentSol = irysTotalSol;
    const gasSol = STORAGE_PAYMENT_GAS_SOL;
    const totalUpfrontSol = walletPaymentSol + gasSol;

    return NextResponse.json({
      totalBytes,
      lamports: lamports.toString(),
      sol,
      irysBundlerBufferSol,
      irysTotalSol,
      walletBufferSol: 0,
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
      creatorPaysIrys: true,
      serverBulkUpload: isServerBulkArweaveAvailable(),
      /** Server uploader pubkey — creator grants a one-time Irys spend approval (not a SOL transfer). */
      uploadDelegateAddress: getPlatformPublicKey(),
      featuredPayTo: getPlatformPublicKey(),
      featuredFeeUsd: FEATURE_ON_MARKET_USD,
    });
  } catch (e) {
    const message = e instanceof Error ? e.message : "Estimate failed";
    const status =
      message.includes("signature") || message.includes("creator") ? 401 : 400;
    return NextResponse.json({ error: message }, { status });
  }
}
