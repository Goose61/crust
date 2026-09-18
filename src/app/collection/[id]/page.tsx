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

  // Only heal in-flight reserved mints. Verifying every sold token on each page
  // load hammers RPC and blocks navigation back to Market.
  const pending = collection.tokens.find((t) => t.reservedBy && !t.owner);
  if (pending) {
    const sig = txSignatureFromMintUrl(pending.mintTxUrl);
    if (sig) {
      const verified = await verifyMintTransaction(sig, getSolanaNetwork());
      if (!verified.ok && /not found/i.test(verified.reason)) {
        await resetStaleMintState(collection.id, pending.tokenId);
        collection = (await getCollection(id)) ?? collection;
      }
    }
  }

  const publicCollection = toPublicCollection({
    ...collection,
    layers: [],
  });

  return (
    <Suspense fallback={<div className="container mx-auto px-4 py-20 text-white/50">Loading…</div>}>
      <CollectionMint initial={publicCollection} />
    </Suspense>
  );
}
