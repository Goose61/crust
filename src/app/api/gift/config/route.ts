import { NextResponse } from "next/server";
import { getGiftCollectionMint, getGiftCollectionName } from "@/lib/gift-collection";
import {
  GIFT_NAME,
  GIFT_SYMBOL,
} from "@/lib/gift-metadata";
import { getPlatformPublicKey } from "@/lib/platform-key";
import { getSolanaNetwork } from "@/lib/solana-config";

export const runtime = "nodejs";

/** Public gift-mint config (platform creator, TM collection, metadata defaults). */
export async function GET() {
  const network = getSolanaNetwork();
  const platformCreatorAddress = getPlatformPublicKey();
  const giftCollectionMint = getGiftCollectionMint(network);
  const giftCollectionName = getGiftCollectionName();

  return NextResponse.json({
    network,
    platformCreatorAddress,
    giftCollectionMint,
    giftCollectionName,
    giftSymbol: GIFT_SYMBOL,
    giftName: GIFT_NAME,
  });
}
