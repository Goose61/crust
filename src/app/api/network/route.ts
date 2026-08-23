/**
 * Runtime Solana cluster for the browser.
 *
 * NEXT_PUBLIC_* vars are baked in at build time on Vercel. This route reads
 * SOLANA_NETWORK from the server at request time so deploy env changes take
 * effect without a rebuild.
 */

import { NextResponse } from "next/server";
import { getSolanaNetwork } from "@/lib/solana-config";

export async function GET() {
  return NextResponse.json({ network: getSolanaNetwork() });
}
