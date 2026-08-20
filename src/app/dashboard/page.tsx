"use client";

import { useEffect, useState } from "react";
import Link from "next/link";
import type { Collection } from "@/lib/types";
import { useWallet } from "@/components/WalletProvider";

export default function DashboardPage() {
  const { publicKey } = useWallet();
  const [collections, setCollections] = useState<Collection[]>([]);

  useEffect(() => {
    fetch("/api/collections")
      .then((r) => r.json())
      .then((d) => setCollections(d.collections ?? []));
  }, []);

  async function reveal(id: string) {
    await fetch(`/api/collections/${id}`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ action: "reveal" }),
    });
    const d = await fetch("/api/collections").then((r) => r.json());
    setCollections(d.collections ?? []);
  }

  return (
    <main className="container mx-auto max-w-4xl px-4 py-12 pt-12">
      <h1 className="text-3xl text-white">Creator dashboard</h1>
      <p className="mt-2 text-sm text-white/50">
        {publicKey ? `Signed in as ${publicKey.slice(0, 6)}…` : "Connect a wallet to manage launches."}
      </p>
      <div className="mt-8 space-y-4">
        {collections.map((c) => (
          <div
            key={c.id}
            className="flex flex-wrap items-center justify-between gap-3 rounded-2xl border border-white/15 bg-card p-4"
          >
            <div>
              <div className="text-white">{c.name}</div>
              <div className="text-xs text-white/50">
                {c.status} · {c.mintedCount}/{c.supply} · fees {c.fees.locked ? "locked" : "unlocked"}
              </div>
            </div>
            <div className="flex gap-2">
              <Link href={`/collection/${c.id}`} className="rounded-lg border border-white/15 px-3 py-1 text-xs">
                View
              </Link>
              {c.blindMint && !c.revealed && (
                <button
                  onClick={() => void reveal(c.id)}
                  className="rounded-lg bg-primary px-3 py-1 text-xs text-white"
                >
                  Reveal now
                </button>
              )}
            </div>
          </div>
        ))}
      </div>
    </main>
  );
}
