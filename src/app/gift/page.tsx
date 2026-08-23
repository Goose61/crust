"use client";

import { useState } from "react";
import { useWallet } from "@/components/WalletProvider";

type GiftResult = {
  collectionId: string;
  onChain: boolean;
  assetAddress?: string;
  explorerUrl?: string;
  network?: string;
  mintWarning?: string;
};

export default function GiftPage() {
  const { publicKey, connect } = useWallet();
  const [file, setFile] = useState<File | null>(null);
  const [preview, setPreview] = useState<string | null>(null);
  const [name, setName] = useState("Gift NFT");
  const [recipient, setRecipient] = useState("");
  const [note, setNote] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [result, setResult] = useState<GiftResult | null>(null);

  if (result) {
    return (
      <main className="container mx-auto max-w-2xl px-4 py-16 text-center">
        <div className="text-5xl mb-4">{result.onChain ? "🎁" : "📋"}</div>
        <h1 className="text-3xl font-semibold text-white mb-2">
          {result.onChain ? "NFT sent on-chain" : "Gift recorded"}
        </h1>
        <p className="text-white/60 text-sm mb-8">
          {result.onChain
            ? `Minted as a Metaplex Core asset on ${result.network} and sent to the recipient wallet.`
            : "Asset uploaded and collection record created. On-chain mint will happen once the platform key is funded."}
        </p>

        {result.mintWarning && (
          <div className="mb-6 rounded border border-yellow-400/30 bg-yellow-400/10 px-4 py-3 text-sm text-yellow-300 text-left">
            {result.mintWarning}
          </div>
        )}

        <div className="space-y-3 mb-8">
          {result.assetAddress && (
            <div className="rounded border border-white/10 bg-white/5 px-4 py-3 text-left">
              <p className="text-xs text-white/40 mb-1">Asset address</p>
              <p className="font-mono text-xs text-white break-all">{result.assetAddress}</p>
            </div>
          )}
          {result.explorerUrl && (
            <a
              href={result.explorerUrl}
              target="_blank"
              rel="noopener noreferrer"
              className="block rounded border border-white/10 bg-white/5 px-4 py-3 text-sm text-primary hover:border-primary/40 transition-colors"
            >
              View transaction on Solana Explorer ↗
            </a>
          )}
          <a
            href={`/collection/${result.collectionId}`}
            className="block rounded border border-white/10 bg-white/5 px-4 py-3 text-sm text-white/70 hover:text-white transition-colors"
          >
            View collection page ↗
          </a>
        </div>

        <button
          onClick={() => {
            setResult(null);
            setFile(null);
            setPreview(null);
            setName("Gift NFT");
            setRecipient("");
            setNote("");
          }}
          className="text-sm text-white/40 hover:text-white/70"
        >
          Send another gift
        </button>
      </main>
    );
  }

  return (
    <main className="container mx-auto max-w-3xl px-4 py-12">
      <p className="font-[family-name:var(--font-mono)] text-[11px] tracking-[0.22em] text-white/50">
        1 / 1
      </p>
      <h1 className="mt-2 text-5xl md:text-7xl">Gift an NFT</h1>
      <p className="mt-4 max-w-xl font-[family-name:var(--font-body)] text-sm leading-6 text-white/50">
        Drop a single image, name it, and send it to any wallet. Gifts do not need a mint
        price. They are free for the recipient. When the platform key is funded, the NFT
        is minted on-chain via Metaplex Core and delivered to the recipient in a single
        transaction.
      </p>

      {error && (
        <div className="mt-4 rounded border border-destructive px-3 py-2 text-sm text-destructive">
          {error}
        </div>
      )}

      <form
        className="mt-10 grid gap-8 md:grid-cols-[220px_1fr]"
        onSubmit={async (e) => {
          e.preventDefault();
          if (!file) { setError("Choose an image first."); return; }
          if (!recipient.trim()) { setError("Enter a recipient wallet address."); return; }
          if (!publicKey) { await connect(); return; }
          setBusy(true);
          setError(null);
          try {
            const fd = new FormData();
            fd.set("file", file);
            fd.set("name", name);
            fd.set("recipient", recipient.trim());
            fd.set("payer", publicKey);
            fd.set("note", note);
            const res = await fetch("/api/gift", { method: "POST", body: fd });
            const data = await res.json();
            if (!res.ok) throw new Error(data.error ?? "Gift failed");
            setResult({
              collectionId: data.collection.id,
              onChain: data.onChain,
              assetAddress: data.assetAddress,
              explorerUrl: data.explorerUrl,
              network: data.network,
              mintWarning: data.mintWarning,
            });
          } catch (err) {
            setError(err instanceof Error ? err.message : "Gift failed");
          } finally {
            setBusy(false);
          }
        }}
      >
        {/* Image drop zone */}
        <label className="rounded-2xl border border-white/15 bg-white/5 flex aspect-square cursor-pointer flex-col items-center justify-center overflow-hidden text-center text-sm text-white/50">
          {preview ? (
            // eslint-disable-next-line @next/next/no-img-element
            <img src={preview} alt="Preview" className="h-full w-full object-cover" />
          ) : (
            <span className="p-4">Drop image<br /><span className="text-xs text-white/30">PNG · JPEG · WebP</span></span>
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

        {/* Fields */}
        <div className="space-y-4">
          <label className="block text-sm">
            <span className="mb-1 block text-white/50">Name</span>
            <input
              className="input"
              value={name}
              onChange={(e) => setName(e.target.value)}
              maxLength={32}
            />
          </label>
          <label className="block text-sm">
            <span className="mb-1 block text-white/50">Recipient wallet</span>
            <input
              className="input font-mono text-xs"
              placeholder="Solana public key (base58)"
              value={recipient}
              onChange={(e) => setRecipient(e.target.value)}
              spellCheck={false}
            />
          </label>
          <label className="block text-sm">
            <span className="mb-1 block text-white/50">Note (optional)</span>
            <textarea
              className="input min-h-24"
              value={note}
              onChange={(e) => setNote(e.target.value)}
              maxLength={200}
            />
          </label>

          <button
            type="submit"
            disabled={busy}
            className="w-full rounded bg-primary py-3 text-sm font-medium text-primary-foreground disabled:opacity-40"
          >
            {busy
              ? "Processing…"
              : publicKey
              ? "Send gift"
              : "Connect wallet to send"}
          </button>

          <p className="text-[11px] text-white/30 leading-relaxed">
            The platform key pays Solana network fees. You pay nothing.
            A small SOL rent deposit (~0.003 SOL) is required on-chain per NFT.
          </p>
        </div>
      </form>
    </main>
  );
}
