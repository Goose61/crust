import { Suspense } from "react";
import { notFound } from "next/navigation";
import { getCollection } from "@/lib/store";
import { toPublicCollection } from "@/lib/public-collection";
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
  if (collection.status === "draft" || collection.status === "importing") {
    notFound();
  }

  // Heal false mint state when Phantom returned a signature but tx never landed.
  for (const t of collection.tokens) {
    const sig = txSignatureFromMintUrl(t.mintTxUrl);
    if (!sig || !t.owner) continue;
    const verified = await verifyMintTransaction(sig, getSolanaNetwork());
    if (!verified.ok) {
      await resetStaleMintState(collection.id, t.tokenId);
      collection = (await getCollection(id)) ?? collection;
      break;
    }
  }

  return (
    <Suspense fallback={<div className="container mx-auto px-4 py-20 text-white/50">Loading…</div>}>
      <CollectionMint initial={toPublicCollection(collection)} />
    </Suspense>
  );
}
