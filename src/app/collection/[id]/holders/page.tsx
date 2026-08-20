import { notFound } from "next/navigation";
import { getCollection } from "@/lib/store";

export const dynamic = "force-dynamic";

export default async function HoldersPage({
  params,
}: {
  params: Promise<{ id: string }>;
}) {
  const { id } = await params;
  const collection = await getCollection(id);
  if (!collection) notFound();
  if (!collection.holderPageUnlocked) {
    return (
      <main className="container mx-auto max-w-xl px-4 py-20 pt-16 text-center">
        <h1 className="text-2xl text-white">Holder lounge locked</h1>
        <p className="mt-3 text-sm text-white/50">
          This page unlocks when the collection hits its holder-page milestone.
        </p>
      </main>
    );
  }
  return (
    <main className="container mx-auto max-w-xl px-4 py-20 pt-16">
      <h1 className="text-3xl text-white">{collection.name} holders</h1>
      <p className="mt-3 text-sm text-white/50">
        Exclusive space for this collection. Connect a wallet that holds a minted piece to unlock
        perks, sequel allowlists, and token drops as milestones fire.
      </p>
    </main>
  );
}
