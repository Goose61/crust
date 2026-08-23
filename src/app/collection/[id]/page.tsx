import { notFound } from "next/navigation";
import { getCollection } from "@/lib/store";
import { CollectionMint } from "@/components/CollectionMint";
import { getSolanaNetwork } from "@/lib/solana-config";
import {
  resetStaleMintState,
  txSignatureFromMintUrl,
  verifyMintTransaction,
} from "@/lib/verify-mint";

export const dynamic = "force-dynamic";

export default async function CollectionPage({
  params,
}: {
  params: Promise<{ id: string }>;
}) {
  const { id } = await params;
  let collection = await getCollection(id);
  if (!collection) notFound();

  // Heal false "sold_out" when Phantom returned a signature but tx never landed.
  const token = collection.tokens[0];
  const sig = txSignatureFromMintUrl(token?.mintTxUrl);
  if (sig && collection.payments.giftMintEnabled) {
    const verified = await verifyMintTransaction(sig, getSolanaNetwork());
    if (!verified.ok) {
      await resetStaleMintState(collection.id);
      collection = (await getCollection(id)) ?? collection;
    }
  }

  return <CollectionMint initial={collection} />;
}
