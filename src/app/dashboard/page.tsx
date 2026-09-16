"use client";

import { useEffect, useMemo, useRef, useState } from "react";
import Link from "next/link";
import type { Collection } from "@/lib/types";
import { useWallet } from "@/components/WalletProvider";
import { buildAuthHeaders } from "@/lib/wallet-auth-client";
import { uploadCollectionLogo } from "@/lib/upload-collection-logo";
import { logoImageSrc } from "@/lib/collection-ui";
import { isLaunchedCreatorCollection } from "@/lib/creator-access";

function canContinueLaunch(c: Collection) {
  return c.status === "draft" || c.status === "importing";
}

export default function DashboardPage() {
  const { publicKey, connect } = useWallet();
  const [collections, setCollections] = useState<Collection[]>([]);
  const [loadError, setLoadError] = useState<string | null>(null);
  const [logoBusyId, setLogoBusyId] = useState<string | null>(null);
  const logoInputRef = useRef<HTMLInputElement>(null);
  const logoTargetId = useRef<string | null>(null);

  useEffect(() => {
    let cancelled = false;
    async function load() {
      setLoadError(null);
      try {
        const publicRes = await fetch("/api/collections");
        const publicData = await publicRes.json();
        let next: Collection[] = publicData.collections ?? [];

        if (publicKey) {
          try {
            const headers = await buildAuthHeaders(publicKey);
            const authed = await fetch("/api/collections", { headers });
            const authedData = await authed.json();
            if (Array.isArray(authedData.collections)) next = authedData.collections;
          } catch {
            // Live collections still load without a signature.
          }
        }

        if (!cancelled) setCollections(next);
      } catch (e) {
        if (!cancelled) {
          setLoadError(e instanceof Error ? e.message : "Could not load collections");
        }
      }
    }
    void load();
    return () => {
      cancelled = true;
    };
  }, [publicKey]);

  const mine = useMemo(() => {
    if (!publicKey) return [];
    return collections.filter((c) => c.payments.creatorWallet === publicKey);
  }, [collections, publicKey]);
  const launched = useMemo(
    () => mine.filter((c) => isLaunchedCreatorCollection(c, publicKey)),
    [mine, publicKey],
  );
  const drafts = useMemo(() => mine.filter((c) => canContinueLaunch(c)), [mine]);

  async function reveal(id: string) {
    if (!publicKey) {
      await connect();
      return;
    }
    const headers = {
      "Content-Type": "application/json",
      ...(await buildAuthHeaders(publicKey)),
    };
    await fetch(`/api/collections/${id}`, {
      method: "POST",
      headers,
      body: JSON.stringify({ action: "reveal" }),
    });
    const d = await fetch("/api/collections", {
      headers: await buildAuthHeaders(publicKey),
    }).then((r) => r.json());
    setCollections(d.collections ?? []);
  }

  async function onLogoPicked(file: File | null) {
    const id = logoTargetId.current;
    if (!file || !id || !publicKey) return;
    setLogoBusyId(id);
    setLoadError(null);
    try {
      const { collection } = await uploadCollectionLogo(id, file, publicKey);
      if (collection) {
        setCollections((prev) => prev.map((c) => (c.id === id ? { ...c, ...collection } : c)));
      }
    } catch (e) {
      setLoadError(e instanceof Error ? e.message : "Could not update logo");
    } finally {
      setLogoBusyId(null);
      logoTargetId.current = null;
    }
  }

  return (
    <main className="container mx-auto max-w-4xl px-4 py-12 pt-12">
      <h1 className="text-3xl text-white">Creator dashboard</h1>
      <p className="mt-2 text-sm text-white/50">
        {publicKey
          ? `Collections for ${publicKey.slice(0, 6)}…${publicKey.slice(-4)}`
          : "Connect the wallet you launched with to manage logos and drops."}
      </p>
      {!publicKey && (
        <button
          type="button"
          onClick={() => void connect()}
          className="mt-4 rounded-lg bg-primary px-4 py-2 text-sm text-white"
        >
          Connect wallet
        </button>
      )}
      {loadError && <p className="mt-4 text-sm text-primary">{loadError}</p>}
      <input
        ref={logoInputRef}
        type="file"
        accept="image/png,image/jpeg,image/webp"
        className="hidden"
        onChange={(e) => {
          const file = e.target.files?.[0] ?? null;
          e.target.value = "";
          void onLogoPicked(file);
        }}
      />

      {publicKey && launched.length === 0 && drafts.length === 0 && (
        <p className="mt-8 text-sm text-white/50">
          No launched collections for this wallet.{" "}
          <Link href="/launch" className="text-primary hover:underline">
            Launch one
          </Link>
          .
        </p>
      )}

      {launched.length > 0 && (
        <section className="mt-8 space-y-4">
          <h2 className="text-lg text-white">Launched collections</h2>
          {launched.map((c) => (
            <DashboardRow
              key={c.id}
              collection={c}
              logoBusy={logoBusyId === c.id}
              onPickLogo={() => {
                logoTargetId.current = c.id;
                logoInputRef.current?.click();
              }}
              onReveal={() => void reveal(c.id)}
            />
          ))}
        </section>
      )}

      {drafts.length > 0 && (
        <section className="mt-10 space-y-4">
          <h2 className="text-lg text-white">Drafts</h2>
          {drafts.map((c) => (
            <DashboardRow
              key={c.id}
              collection={c}
              logoBusy={logoBusyId === c.id}
              onPickLogo={() => {
                logoTargetId.current = c.id;
                logoInputRef.current?.click();
              }}
            />
          ))}
        </section>
      )}
    </main>
  );
}

function DashboardRow({
  collection: c,
  logoBusy,
  onPickLogo,
  onReveal,
}: {
  collection: Collection;
  logoBusy: boolean;
  onPickLogo: () => void;
  onReveal?: () => void;
}) {
  const logo = logoImageSrc(c);
  return (
    <div className="flex flex-wrap items-center justify-between gap-3 rounded-2xl border border-white/15 bg-card p-4">
      <div className="flex min-w-0 items-center gap-3">
        {logo ? (
          // eslint-disable-next-line @next/next/no-img-element
          <img src={logo} alt="" className="h-14 w-14 rounded-xl object-cover" />
        ) : (
          <div className="flex h-14 w-14 items-center justify-center rounded-xl border border-white/10 bg-white/5 text-xs text-white/35">
            {c.name.slice(0, 2).toUpperCase()}
          </div>
        )}
        <div>
          <div className="text-white">{c.name}</div>
          <div className="text-xs text-white/50">
            {c.status} · {c.mintedCount}/{c.supply}
          </div>
        </div>
      </div>
      <div className="flex flex-wrap gap-2">
        {canContinueLaunch(c) ? (
          <Link
            href={`/launch?id=${c.id}`}
            className="rounded-lg bg-primary px-3 py-1.5 text-xs text-white"
          >
            Continue launch
          </Link>
        ) : (
          <Link
            href={`/collection/${c.slug || c.id}`}
            className="rounded-lg border border-white/15 px-3 py-1.5 text-xs"
          >
            View
          </Link>
        )}
        <button
          type="button"
          disabled={logoBusy}
          onClick={onPickLogo}
          className="rounded-lg bg-white/10 px-3 py-1.5 text-xs font-medium text-white hover:bg-white/15 disabled:opacity-50"
        >
          {logoBusy ? "Uploading…" : logo ? "Change logo" : "Add logo"}
        </button>
        {c.blindMint && !c.revealed && !canContinueLaunch(c) && onReveal && (
          <button
            onClick={onReveal}
            className="rounded-lg bg-primary px-3 py-1.5 text-xs text-white"
          >
            Reveal now
          </button>
        )}
      </div>
    </div>
  );
}
