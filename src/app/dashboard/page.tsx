"use client";

import { useEffect, useMemo, useRef, useState } from "react";
import Link from "next/link";
import type { Collection } from "@/lib/types";
import { useWallet } from "@/components/WalletProvider";
import { buildAuthHeaders } from "@/lib/wallet-auth-client";
import { uploadCollectionLogo } from "@/lib/upload-collection-logo";
import { logoImageSrc } from "@/lib/collection-ui";

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
      const headers: Record<string, string> = {};
      if (publicKey) {
        try {
          Object.assign(headers, await buildAuthHeaders(publicKey));
        } catch (e) {
          if (!cancelled) {
            setLoadError(e instanceof Error ? e.message : "Sign in with your wallet to load drafts");
          }
          return;
        }
      }
      const r = await fetch("/api/collections", { headers });
      const d = await r.json();
      if (!cancelled) setCollections(d.collections ?? []);
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
        setCollections((prev) => prev.map((c) => (c.id === id ? collection : c)));
      } else {
        const d = await fetch("/api/collections", {
          headers: await buildAuthHeaders(publicKey),
        }).then((r) => r.json());
        setCollections(d.collections ?? []);
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
          ? `Showing collections for ${publicKey.slice(0, 6)}…${publicKey.slice(-4)}`
          : "Connect a wallet to manage your launches."}
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
      <div className="mt-8 space-y-4">
        {publicKey && mine.length === 0 && (
          <p className="text-sm text-white/50">
            No collections yet.{" "}
            <Link href="/launch" className="text-primary hover:underline">
              Launch one
            </Link>
            .
          </p>
        )}
        {mine.map((c) => {
          const logo = logoImageSrc(c);
          return (
          <div
            key={c.id}
            className="flex flex-wrap items-center justify-between gap-3 rounded-2xl border border-white/15 bg-card p-4"
          >
            <div className="flex min-w-0 items-center gap-3">
              {logo ? (
                // eslint-disable-next-line @next/next/no-img-element
                <img src={logo} alt="" className="h-12 w-12 rounded-xl object-cover" />
              ) : (
                <div className="flex h-12 w-12 items-center justify-center rounded-xl border border-white/10 bg-white/5 text-xs text-white/35">
                  {c.name.slice(0, 2).toUpperCase()}
                </div>
              )}
              <div>
                <div className="text-white">{c.name}</div>
                <div className="text-xs text-white/50">
                  {c.status} · {c.mintedCount}/{c.supply} · fees {c.fees.locked ? "locked" : "unlocked"}
                  {c.importProgress && c.status === "importing"
                    ? ` · import ${c.importProgress.done}/${c.importProgress.total}`
                    : ""}
                </div>
              </div>
            </div>
            <div className="flex gap-2">
              {canContinueLaunch(c) ? (
                <Link
                  href={`/launch?id=${c.id}`}
                  className="rounded-lg bg-primary px-3 py-1 text-xs text-white"
                >
                  Continue launch
                </Link>
              ) : (
                <Link href={`/collection/${c.slug || c.id}`} className="rounded-lg border border-white/15 px-3 py-1 text-xs">
                  View
                </Link>
              )}
              <button
                type="button"
                disabled={logoBusyId === c.id}
                onClick={() => {
                  logoTargetId.current = c.id;
                  logoInputRef.current?.click();
                }}
                className="rounded-lg border border-white/15 px-3 py-1 text-xs text-white/80 hover:text-white disabled:opacity-50"
              >
                {logoBusyId === c.id ? "Uploading…" : logo ? "Update logo" : "Add logo"}
              </button>
              {c.blindMint && !c.revealed && c.status !== "draft" && c.status !== "importing" && (
                <button
                  onClick={() => void reveal(c.id)}
                  className="rounded-lg bg-primary px-3 py-1 text-xs text-white"
                >
                  Reveal now
                </button>
              )}
            </div>
          </div>
        );
        })}
      </div>
    </main>
  );
}
