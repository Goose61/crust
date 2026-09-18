import { unstable_cache } from "next/cache";
import { listCollectionsForMarket } from "@/lib/store";
import { partitionMarketCards } from "@/lib/market-card";
import { MarketBrowse } from "@/components/MarketBrowse";

const getMarketCards = unstable_cache(
  async () => partitionMarketCards(await listCollectionsForMarket()),
  ["market-cards"],
  { revalidate: 30 },
);

export default async function MarketPage() {
  const { live, secondary, giftBundle } = await getMarketCards();

  return (
    <main className="relative overflow-hidden">
      <div
        aria-hidden
        className="pointer-events-none absolute inset-x-0 top-0 h-[28rem] bg-[radial-gradient(ellipse_at_top,rgba(226,60,47,0.16),transparent_58%)]"
      />
      <div className="container relative mx-auto max-w-6xl px-4 py-8 sm:py-12">
        <p className="font-[family-name:var(--font-mono)] text-[11px] tracking-[0.22em] text-white/50">
          IN-ECOSYSTEM
        </p>
        <h1 className="mt-2 text-4xl sm:text-5xl md:text-7xl">Market</h1>
        <p className="mt-3 max-w-xl text-sm leading-6 text-white/50">
          Primary mints and secondary listings stay on Ginger. Nothing graduates away.
        </p>
        <MarketBrowse live={live} secondary={secondary} giftBundle={giftBundle} />
      </div>
    </main>
  );
}
