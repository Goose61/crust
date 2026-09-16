import { listCollections } from "@/lib/store";
import { toPublicCollection } from "@/lib/public-collection";
import { isGiftBundle, isStandaloneGiftRecord } from "@/lib/gift-bundle";
import { MarketBrowse } from "@/components/MarketBrowse";

export const dynamic = "force-dynamic";

export default async function MarketPage() {
  const all = (await listCollections()).map(toPublicCollection);
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
    <main className="relative overflow-hidden">
      <div
        aria-hidden
        className="pointer-events-none absolute inset-x-0 top-0 h-[28rem] bg-[radial-gradient(ellipse_at_top,rgba(226,60,47,0.16),transparent_58%)]"
      />
      <div className="container relative mx-auto max-w-6xl px-4 py-12">
        <p className="font-[family-name:var(--font-mono)] text-[11px] tracking-[0.22em] text-white/50">
          IN-ECOSYSTEM
        </p>
        <h1 className="mt-2 text-5xl md:text-7xl">Market</h1>
        <p className="mt-3 max-w-xl text-sm leading-6 text-white/50">
          Primary mints and secondary listings stay on Ginger. Nothing graduates away.
        </p>
        <MarketBrowse live={live} secondary={secondary} giftBundle={giftBundle} />
      </div>
    </main>
  );
}
