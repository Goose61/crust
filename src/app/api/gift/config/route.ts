import { NextResponse } from "next/server";
import { getCoreCollectionAddress } from "@/lib/core-collection";
import { getSolanaNetwork } from "@/lib/solana-config";

export const runtime = "nodejs";

/** Public gift-mint config (collection address/name for metadata JSON). */
export async function GET() {
  const network = getSolanaNetwork();
  const coreCollectionAddress = getCoreCollectionAddress(network);
  const coreCollectionName =
    process.env.CORE_COLLECTION_NAME?.trim() || "Dough Boi Gifts";

  return NextResponse.json({
    network,
    coreCollectionAddress,
    coreCollectionName,
  });
}
