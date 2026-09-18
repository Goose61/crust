export default function MarketLoading() {
  return (
    <main className="container mx-auto max-w-6xl px-4 py-8 sm:py-12">
      <p className="font-[family-name:var(--font-mono)] text-[11px] tracking-[0.22em] text-white/50">
        IN-ECOSYSTEM
      </p>
      <div className="mt-2 h-12 w-48 animate-pulse rounded-lg bg-white/10" />
      <p className="mt-4 text-sm text-white/45">Loading market…</p>
      <div className="mt-8 h-64 animate-pulse rounded-3xl bg-white/5" />
      <div className="mt-6 grid gap-5 sm:grid-cols-2 lg:grid-cols-3">
        <div className="h-72 animate-pulse rounded-2xl bg-white/5" />
        <div className="h-72 animate-pulse rounded-2xl bg-white/5" />
        <div className="h-72 animate-pulse rounded-2xl bg-white/5" />
      </div>
    </main>
  );
}
