"use client";

import { useMemo, useState, type ReactNode } from "react";
import Link from "next/link";
import { formatUsd, formatUsdAmount } from "@/lib/collection-ui";
import type { MarketCard } from "@/lib/market-card";

type Tab = "mints" | "secondary";

function CollectionCard({
  collection,
  featured = false,
}: {
  collection: MarketCard;
  featured?: boolean;
}) {
  const { stats, coverSrc } = collection;
  const href = `/collection/${collection.slug || collection.id}`;

  if (featured) {
    return (
      <Link
        href={href}
        className="group relative grid overflow-hidden rounded-3xl border border-white/12 bg-card md:grid-cols-[1.35fr_1fr]"
      >
        <div className="relative flex aspect-[4/3] items-center justify-center bg-white/5 md:aspect-auto md:min-h-[340px]">
          {/* eslint-disable-next-line @next/next/no-img-element */}
          <img
            src={coverSrc}
            alt={collection.name}
            className="h-full w-full object-contain p-4 transition duration-500 group-hover:scale-[1.03]"
          />
          <div className="absolute inset-0 bg-gradient-to-t from-black/70 via-black/10 to-transparent md:bg-gradient-to-r md:from-transparent md:via-transparent md:to-card" />
        </div>
        <div className="relative flex flex-col justify-end p-5 sm:p-8">
          <p className="font-[family-name:var(--font-mono)] text-[11px] tracking-[0.22em] text-white/40">
            FEATURED · {collection.chain.toUpperCase()}
          </p>
          <h2 className="mt-2 break-words text-3xl font-bold tracking-tight text-white sm:text-5xl">
            {collection.name}
          </h2>
          <p className="mt-3 line-clamp-3 max-w-md text-sm leading-6 text-white/55">
            {collection.description}
          </p>
          <dl className="mt-6 grid grid-cols-3 gap-2 sm:gap-3">
            <MiniStat label="Floor" value={formatUsd(stats.floorUsd)} />
            <MiniStat label="Volume" value={formatUsdAmount(stats.volumeUsd)} />
            <MiniStat label="Available" value={String(stats.available)} />
          </dl>
        </div>
      </Link>
    );
  }

  return (
    <Link
      href={href}
      className="group overflow-hidden rounded-2xl border border-white/12 bg-card transition hover:border-white/25 hover:shadow-[0_18px_40px_rgba(0,0,0,0.35)]"
    >
      <div className="relative flex aspect-square items-center justify-center overflow-hidden bg-white/5 p-3">
        {/* eslint-disable-next-line @next/next/no-img-element */}
        <img
          src={coverSrc}
          alt={collection.name}
          loading="lazy"
          decoding="async"
          className="max-h-full max-w-full object-contain transition duration-500 group-hover:scale-[1.04]"
        />
        <span className="absolute left-3 top-3 rounded-full bg-black/55 px-2.5 py-1 font-[family-name:var(--font-mono)] text-[10px] text-white backdrop-blur-sm">
          {formatUsd(stats.floorUsd)}
        </span>
      </div>
      <div className="border-t border-white/10 p-4">
        <div className="flex items-start justify-between gap-3">
          <div className="min-w-0">
            <h3 className="truncate text-lg font-semibold text-white">{collection.name}</h3>
            {collection.kind === "gift_bundle" ? (
              <p className="mt-1 text-xs text-white/45">
                {collection.mintedCount} gift{collection.mintedCount === 1 ? "" : "s"} minted
              </p>
            ) : (
              <p className="mt-1 text-xs text-white/45">
                {stats.available} available · {stats.sold} sold
              </p>
            )}
          </div>
        </div>
        <dl className="mt-4 grid grid-cols-2 gap-2 text-xs">
          <div className="rounded-lg bg-white/5 px-2.5 py-2">
            <dt className="font-[family-name:var(--font-mono)] text-[10px] tracking-[0.14em] text-white/40">
              VOLUME
            </dt>
            <dd className="mt-0.5 text-sm text-white">{formatUsdAmount(stats.volumeUsd)}</dd>
          </div>
          <div className="rounded-lg bg-white/5 px-2.5 py-2">
            <dt className="font-[family-name:var(--font-mono)] text-[10px] tracking-[0.14em] text-white/40">
              MCAP
            </dt>
            <dd className="mt-0.5 text-sm text-white">{formatUsdAmount(stats.marketCapUsd)}</dd>
          </div>
        </dl>
      </div>
    </Link>
  );
}

function MiniStat({ label, value }: { label: string; value: string }) {
  return (
    <div className="rounded-xl border border-white/10 bg-black/20 px-2 py-2 sm:px-3 sm:py-2.5">
      <dt className="font-[family-name:var(--font-mono)] text-[9px] tracking-[0.16em] text-white/40 sm:text-[10px]">
        {label.toUpperCase()}
      </dt>
      <dd className="mt-1 truncate text-sm font-semibold text-white sm:text-lg">{value}</dd>
    </div>
  );
}

export function MarketBrowse({
  live,
  secondary,
  giftBundle,
}: {
  live: MarketCard[];
  secondary: MarketCard[];
  giftBundle?: MarketCard;
}) {
  const [tab, setTab] = useState<Tab>("mints");
  const items = tab === "mints" ? live : secondary;
  const featured = items[0];
  const rest = useMemo(
    () => (featured ? items.slice(1) : items),
    [featured, items],
  );

  return (
    <div>
      <div className="mt-8 flex w-full rounded-full border border-white/12 bg-white/5 p-1 sm:inline-flex sm:w-auto">
        <TabButton active={tab === "mints"} onClick={() => setTab("mints")}>
          Open mints
          <span className="ml-2 text-white/40">{live.length}</span>
        </TabButton>
        <TabButton active={tab === "secondary"} onClick={() => setTab("secondary")}>
          Secondary
          <span className="ml-2 text-white/40">{secondary.length}</span>
        </TabButton>
      </div>

      {items.length === 0 ? (
        <p className="mt-10 text-sm text-white/50">
          {tab === "mints"
            ? "No active mints right now."
            : "Secondary unlocks when a collection hits its milestone. Nothing here yet."}
        </p>
      ) : (
        <div className="mt-8 space-y-6">
          {featured && <CollectionCard collection={featured} featured />}
          {rest.length > 0 && (
            <div className="grid gap-5 sm:grid-cols-2 lg:grid-cols-3">
              {rest.map((c) => (
                <CollectionCard key={c.id} collection={c} />
              ))}
            </div>
          )}
        </div>
      )}

      {tab === "mints" && giftBundle && giftBundle.mintedCount === 0 && (
        <p className="mt-6 text-sm text-white/45">
          Send a gift via{" "}
          <Link href="/gift" className="text-primary hover:underline">
            /gift
          </Link>{" "}
          — it will appear in {giftBundle.name}.
        </p>
      )}
    </div>
  );
}

function TabButton({
  active,
  onClick,
  children,
}: {
  active: boolean;
  onClick: () => void;
  children: ReactNode;
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      className={`flex-1 rounded-full px-3 py-2 text-sm transition sm:flex-none sm:px-4 ${
        active ? "bg-primary text-white" : "text-white/55 hover:text-white"
      }`}
    >
      {children}
    </button>
  );
}
