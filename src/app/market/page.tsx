import Link from "next/link";
import { listCollections } from "@/lib/store";
import { coverImageSrc, formatUsd } from "@/lib/collection-ui";
import { isGiftBundle, isStandaloneGiftRecord } from "@/lib/gift-bundle";

export const dynamic = "force-dynamic";

export default async function MarketPage() {
  const all = await listCollections();
  const live = all.filter((c) => {
    if (c.status !== "live" && c.status !== "sold_out") return false;
    if (isStandaloneGiftRecord(c)) return false;
    return true;
  });
  const secondary = all.filter(
    (c) =>
      c.secondaryEnabled &&
      !isStandaloneGiftRecord(c) &&
      c.tokens.some((t) => t.listing),
  );

  const giftBundle = live.find((c) => isGiftBundle(c));

  return (
    <main className="container mx-auto max-w-6xl px-4 py-12">
      <p className="font-[family-name:var(--font-mono)] text-[11px] tracking-[0.22em] text-white/50">
        IN-ECOSYSTEM
      </p>
      <h1 className="mt-2 text-5xl md:text-7xl">Market</h1>
      <p className="mt-3 max-w-xl text-sm text-white/50">
        Primary mints and secondary listings stay here. Nothing graduates away.
      </p>

      <section className="mt-10">
        <h2 className="mb-4 text-3xl">Open mints</h2>
        {live.length === 0 ? (
          <p className="text-sm text-white/50">No active mints right now.</p>
        ) : (
          <div className="grid gap-5 sm:grid-cols-2 lg:grid-cols-3">
            {live.map((c) => (
              <Link
                key={c.id}
                href={`/collection/${c.slug || c.id}`}
                className="rounded-2xl border border-white/15 bg-white/5 group block overflow-hidden"
              >
                <div className="aspect-square overflow-hidden bg-white/5">
                  {/* eslint-disable-next-line @next/next/no-img-element */}
                  <img src={coverImageSrc(c)} alt={c.name} className="h-full w-full object-cover" />
                </div>
                <div className="flex items-center justify-between border-t border-white/15 p-4">
                  <div className="min-w-0">
                    <h3 className="truncate text-xl">{c.name}</h3>
                    {isGiftBundle(c) && (
                      <p className="mt-1 text-xs text-white/45">
                        {c.mintedCount} gift{c.mintedCount === 1 ? "" : "s"} minted
                      </p>
                    )}
                  </div>
                  <span className="font-[family-name:var(--font-mono)] text-xs shrink-0 ml-2">
                    {formatUsd(c.payments.basePriceUsd)}
                  </span>
                </div>
              </Link>
            ))}
          </div>
        )}
        {giftBundle && giftBundle.mintedCount === 0 && (
          <p className="mt-4 text-sm text-white/45">
            Send a gift via{" "}
            <Link href="/gift" className="text-primary hover:underline">
              /gift
            </Link>{" "}
            — it will appear in {giftBundle.name}.
          </p>
        )}
      </section>

      <section className="mt-12">
        <h2 className="mb-4 text-3xl">Secondary listings</h2>
        {secondary.length === 0 ? (
          <p className="text-sm text-white/50">
            Secondary unlocks when a collection hits its milestone. Nothing here yet.
          </p>
        ) : (
          <div className="grid gap-5 sm:grid-cols-2 lg:grid-cols-3">
            {secondary.map((c) => (
              <Link
                key={c.id}
                href={`/collection/${c.slug || c.id}`}
                className="rounded-2xl border border-white/15 bg-white/5 group block overflow-hidden"
              >
                <div className="aspect-square overflow-hidden bg-white/5">
                  {/* eslint-disable-next-line @next/next/no-img-element */}
                  <img src={coverImageSrc(c)} alt={c.name} className="h-full w-full object-cover" />
                </div>
                <div className="border-t border-white/15 p-4">
                  <h3 className="text-xl">{c.name}</h3>
                  <p className="mt-1 text-xs text-white/50">{c.mintedCount} minted · secondary open</p>
                </div>
              </Link>
            ))}
          </div>
        )}
      </section>
    </main>
  );
}
