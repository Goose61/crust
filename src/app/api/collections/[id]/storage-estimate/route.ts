import { NextRequest, NextResponse } from "next/server";
import { getCollection } from "@/lib/store";
import { assertCreatorAuth, requireWalletAuth } from "@/lib/wallet-auth";
import { fetchIrysPriceLamports } from "@/lib/irys-shared";
import { getSolanaNetwork, isDevnetNetwork } from "@/lib/solana-config";

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
    const lamports = await fetchIrysPriceLamports(totalBytes, devnet);
    const sol = Number(lamports) / 1e9;

    return NextResponse.json({
      totalBytes,
      lamports: lamports.toString(),
      sol,
      network,
    });
  } catch (e) {
    const message = e instanceof Error ? e.message : "Estimate failed";
    const status =
      message.includes("signature") || message.includes("creator") ? 401 : 400;
    return NextResponse.json({ error: message }, { status });
  }
}
