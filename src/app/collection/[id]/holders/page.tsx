import { notFound } from "next/navigation";
import { getCollection } from "@/lib/store";
import { HolderFeePanel } from "@/components/HolderFeePanel";

export const dynamic = "force-dynamic";

export default async function HoldersPage({
  params,
}: {
  params: Promise<{ id: string }>;
}) {
  const { id } = await params;
  const collection = await getCollection(id);
  if (!collection) notFound();
  if (collection.status === "draft" || collection.status === "importing") {
    notFound();
  }
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

  const snapshots = collection.holderSnapshots ?? [];

  return (
    <main className="container mx-auto max-w-2xl px-4 py-20 pt-16">
      <h1 className="text-3xl text-white">{collection.name} holders</h1>
      <p className="mt-3 text-sm text-white/50">
        Exclusive space for this collection. Perks unlock as milestones fire on-chain and in the
        marketplace.
      </p>

      <ul className="mt-8 space-y-2 text-sm text-white/70">
        {collection.sequelAllowlistFromHolders && (
          <li className="rounded border border-primary/30 bg-primary/10 px-3 py-2">
            Sequel allowlist from holders is active — snapshot wallets qualify for the next drop.
          </li>
        )}
        {collection.treasuryBuybackActive && (
          <li className="rounded border border-white/15 bg-white/5 px-3 py-2">
            Treasury buyback program is active
            {collection.buybackTokenCa ? ` — token ${collection.buybackTokenCa.slice(0, 8)}…` : ""}.
          </li>
        )}
        {collection.discordRoleSyncEnabled && (
          <li className="rounded border border-white/15 bg-white/5 px-3 py-2">
            Discord holder role sync is enabled — connect Discord when available.
          </li>
        )}
        {collection.airdropSplPending && (
          <li className="rounded border border-amber-500/30 bg-amber-500/10 px-3 py-2">
            SPL airdrop to holders is pending distribution.
          </li>
        )}
      </ul>

      {snapshots.length > 0 && (
        <section className="mt-10">
          <h2 className="text-xl font-semibold text-white">Holder snapshots</h2>
          <p className="mt-1 text-xs text-white/40">
            Captured automatically when snapshot milestones fire.
          </p>
          <div className="mt-4 space-y-6">
            {snapshots.map((snap, i) => (
              <div key={`${snap.takenAt}-${i}`} className="rounded border border-white/10 p-4">
                <p className="font-mono text-[11px] text-white/40">
                  {new Date(snap.takenAt).toLocaleString()} · milestone {snap.milestoneAt}%
                </p>
                <ul className="mt-3 max-h-48 overflow-y-auto space-y-1 text-sm">
                  {snap.holders
                    .sort((a, b) => b.count - a.count)
                    .map((h) => (
                      <li key={h.wallet} className="flex justify-between gap-2 font-mono text-white/80">
                        <span className="truncate">{h.wallet}</span>
                        <span className="text-white/40">{h.count}</span>
                      </li>
                    ))}
                </ul>
              </div>
            ))}
          </div>
        </section>
      )}

      <HolderFeePanel collectionId={collection.id} />
    </main>
  );
}
