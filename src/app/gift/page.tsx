"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { useWallet } from "@/components/WalletProvider";

export default function GiftPage() {
  const router = useRouter();
  const { publicKey, connect } = useWallet();
  const [file, setFile] = useState<File | null>(null);
  const [preview, setPreview] = useState<string | null>(null);
  const [name, setName] = useState("Gift NFT");
  const [recipient, setRecipient] = useState("");
  const [note, setNote] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  return (
    <main className="container mx-auto max-w-3xl px-4 py-12">
      <p className="font-[family-name:var(--font-mono)] text-[11px] tracking-[0.22em] text-white/50">
        1 / 1
      </p>
      <h1 className="mt-2 text-5xl md:text-7xl">Gift an NFT</h1>
      <p className="mt-4 max-w-xl font-[family-name:var(--font-body)] text-sm leading-6 text-white/50">
        Drop a single image, name it, and send it to any wallet. Gifts do not need a mint
        price. They are free for the recipient. When on-chain minting is live, you will
        still pay a small Solana network fee, not a marketplace markup.
      </p>

      {error && (
        <div className="mt-4 border border-destructive px-3 py-2 text-sm text-destructive">{error}</div>
      )}

      <form
        className="mt-10 grid gap-8 md:grid-cols-[220px_1fr]"
        onSubmit={async (e) => {
          e.preventDefault();
          if (!file) {
            setError("Choose an image first.");
            return;
          }
          if (!recipient.trim()) {
            setError("Enter a recipient wallet.");
            return;
          }
          if (!publicKey) {
            await connect();
            return;
          }
          setBusy(true);
          setError(null);
          try {
            const form = new FormData();
            form.set("file", file);
            form.set("name", name);
            form.set("recipient", recipient.trim());
            form.set("payer", publicKey);
            form.set("note", note);
            const res = await fetch("/api/gift", { method: "POST", body: form });
            const data = await res.json();
            if (!res.ok) throw new Error(data.error);
            router.push(`/collection/${data.collection.id}`);
          } catch (err) {
            setError(err instanceof Error ? err.message : "Gift failed");
          } finally {
            setBusy(false);
          }
        }}
      >
        <label className="rounded-2xl border border-white/15 bg-white/5 flex aspect-square cursor-pointer flex-col items-center justify-center overflow-hidden text-center text-sm text-white/50">
          {preview ? (
            // eslint-disable-next-line @next/next/no-img-element
            <img src={preview} alt="Preview" className="h-full w-full object-cover" />
          ) : (
            <span className="p-4">Drop image</span>
          )}
          <input
            type="file"
            accept="image/png,image/jpeg,image/webp"
            className="hidden"
            onChange={(e) => {
              const next = e.target.files?.[0] ?? null;
              setFile(next);
              setPreview(next ? URL.createObjectURL(next) : null);
            }}
          />
        </label>

        <div className="space-y-4">
          <label className="block text-sm">
            <span className="mb-1 block text-white/50">Name</span>
            <input className="input" value={name} onChange={(e) => setName(e.target.value)} />
          </label>
          <label className="block text-sm">
            <span className="mb-1 block text-white/50">Recipient wallet</span>
            <input
              className="input"
              placeholder="Solana address"
              value={recipient}
              onChange={(e) => setRecipient(e.target.value)}
            />
          </label>
          <label className="block text-sm">
            <span className="mb-1 block text-white/50">Note (optional)</span>
            <textarea
              className="input min-h-24"
              value={note}
              onChange={(e) => setNote(e.target.value)}
            />
          </label>
          <button
            disabled={busy}
            className="w-full bg-primary py-3 text-sm font-medium text-primary-foreground disabled:opacity-40"
          >
            {busy ? "Sending…" : publicKey ? "Send gift" : "Connect wallet to send"}
          </button>
        </div>
      </form>
    </main>
  );
}
