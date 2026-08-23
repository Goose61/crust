"use client";

import { useState, useEffect, useRef } from "react";
import { useWallet } from "@/components/WalletProvider";

// ── Types ──────────────────────────────────────────────────────────────────

type FeeBreakdown = {
  platform: { sol: number; description: string };
  user: {
    breakdown: {
      rent:     { sol: number; label: string };
      protocol: { sol: number; label: string };
      txFee:    { sol: number; label: string };
    };
    sol: number;
    usd: number | null;
    description: string;
  };
  solPrice: number;
};

type GiftResult = {
  collectionId: string;
  assetAddress?: string;
  txSignature?: string;
  explorerUrl?: string;
  storageMethod: string;
  onChain: boolean;
};

// ── Helpers ────────────────────────────────────────────────────────────────

function fmtSol(sol: number) {
  return sol.toLocaleString("en-US", { minimumFractionDigits: 4, maximumFractionDigits: 4 });
}

function fmtUsd(usd: number) {
  return usd.toLocaleString("en-US", { style: "currency", currency: "USD", minimumFractionDigits: 2 });
}

// ── Component ──────────────────────────────────────────────────────────────

export default function GiftPage() {
  const { publicKey, connect, signAndSendTx } = useWallet();

  const [file, setFile]         = useState<File | null>(null);
  const [preview, setPreview]   = useState<string | null>(null);
  const [name, setName]         = useState("Gift NFT");
  const [recipient, setRecipient] = useState("");
  const [note, setNote]         = useState("");

  const [fees, setFees]         = useState<FeeBreakdown | null>(null);
  const [feesLoading, setFeesLoading] = useState(false);

  const [busy, setBusy]         = useState(false);
  const [stage, setStage]       = useState<"idle"|"uploading"|"signing"|"confirming">("idle");
  const [error, setError]       = useState<string | null>(null);
  const [result, setResult]     = useState<GiftResult | null>(null);

  const debounceRef = useRef<ReturnType<typeof setTimeout> | undefined>(undefined);

  // Fetch fee estimate whenever the selected image changes
  useEffect(() => {
    clearTimeout(debounceRef.current);
    if (!file) { setFees(null); return; }
    setFeesLoading(true);
    debounceRef.current = setTimeout(async () => {
      try {
        const res = await fetch(`/api/gift/estimate?imageBytes=${file.size}`);
        if (res.ok) setFees(await res.json());
      } finally {
        setFeesLoading(false);
      }
    }, 400);
  }, [file]);

  // ── Success screen ────────────────────────────────────────────────────────
  if (result) {
    const cluster = process.env.NEXT_PUBLIC_SOLANA_CLUSTER === "devnet" ? "?cluster=devnet" : "";
    return (
      <main className="container mx-auto max-w-2xl px-4 py-16 text-center">
        <div className="text-6xl mb-4">{result.onChain ? "🎁" : "📋"}</div>
        <h1 className="text-3xl font-semibold text-white mb-2">
          {result.onChain ? "Gift sent on-chain" : "Gift recorded"}
        </h1>
        <p className="text-white/60 text-sm mb-8 max-w-md mx-auto">
          {result.onChain
            ? "Your NFT was minted as a Metaplex Core asset and transferred to the recipient wallet."
            : "Image and metadata are staged. Configure ARWEAVE_SOLANA_KEY to enable on-chain minting."}
        </p>

        <div className="space-y-3 mb-8 text-left">
          {result.assetAddress && (
            <div className="rounded border border-white/10 bg-white/5 px-4 py-3">
              <p className="text-xs text-white/40 mb-1 uppercase tracking-wider">Asset address</p>
              <p className="font-mono text-xs text-white break-all">{result.assetAddress}</p>
            </div>
          )}
          {result.txSignature && (
            <div className="rounded border border-white/10 bg-white/5 px-4 py-3">
              <p className="text-xs text-white/40 mb-1 uppercase tracking-wider">Transaction</p>
              <a
                href={`https://explorer.solana.com/tx/${result.txSignature}${cluster}`}
                target="_blank"
                rel="noopener noreferrer"
                className="font-mono text-xs text-primary hover:underline break-all"
              >
                {result.txSignature.slice(0, 40)}… ↗
              </a>
            </div>
          )}
          <a
            href={`/collection/${result.collectionId}`}
            className="flex items-center justify-between rounded border border-white/10 bg-white/5 px-4 py-3 text-sm text-white/70 hover:text-white transition-colors"
          >
            <span>View collection page</span>
            <span>↗</span>
          </a>
        </div>

        <button
          onClick={() => {
            setResult(null); setFile(null); setPreview(null);
            setName("Gift NFT"); setRecipient(""); setNote(""); setFees(null);
            setError(null); setStage("idle");
          }}
          className="text-sm text-white/40 hover:text-white/70 transition-colors"
        >
          Send another gift
        </button>
      </main>
    );
  }

  // ── Form ──────────────────────────────────────────────────────────────────
  const stageLabel: Record<typeof stage, string> = {
    idle:        publicKey ? "Send gift" : "Connect wallet",
    uploading:   "Uploading to Arweave…",
    signing:     "Waiting for wallet approval…",
    confirming:  "Confirming on-chain…",
  };

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    if (!file)      { setError("Choose an image first."); return; }
    if (!recipient.trim()) { setError("Enter a recipient wallet address."); return; }
    if (!publicKey) { await connect(); return; }

    setBusy(true);
    setError(null);
    try {
      // Step 1: upload image + metadata, get partially-signed tx
      setStage("uploading");
      const fd = new FormData();
      fd.set("file", file);
      fd.set("name", name);
      fd.set("recipient", recipient.trim());
      fd.set("payer", publicKey);
      fd.set("note", note);

      const res = await fetch("/api/gift", { method: "POST", body: fd });
      const data = await res.json() as {
        collectionId?: string;
        txBase64?: string;
        assetAddress?: string;
        storageMethod?: string;
        requiresWalletSignature?: boolean;
        error?: string;
      };
      if (!res.ok) throw new Error(data.error ?? "Upload failed");

      // Step 2: no on-chain key configured → record only
      if (!data.requiresWalletSignature || !data.txBase64) {
        setResult({
          collectionId: data.collectionId!,
          storageMethod: data.storageMethod ?? "staging",
          onChain: false,
        });
        return;
      }

      // Step 3: ask wallet to sign + submit the Metaplex Core tx
      setStage("signing");
      const txSignature = await signAndSendTx(data.txBase64);

      // Step 4: notify server that the tx confirmed, update collection status
      setStage("confirming");
      await fetch("/api/gift", {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ collectionId: data.collectionId, txSignature }),
      });

      setResult({
        collectionId: data.collectionId!,
        assetAddress: data.assetAddress ?? undefined,
        txSignature,
        storageMethod: data.storageMethod ?? "arweave",
        onChain: true,
      });
    } catch (err) {
      const msg = err instanceof Error ? err.message : "Something went wrong";
      // Phantom user rejection is not a fatal error
      if (msg.toLowerCase().includes("user rejected")) {
        setError("Transaction cancelled in wallet.");
      } else {
        setError(msg);
      }
      setStage("idle");
    } finally {
      setBusy(false);
      if (stage !== "idle") setStage("idle");
    }
  }

  return (
    <main className="container mx-auto max-w-3xl px-4 py-12">
      <p className="font-[family-name:var(--font-mono)] text-[11px] tracking-[0.22em] text-white/50">
        1 / 1
      </p>
      <h1 className="mt-2 text-5xl md:text-7xl">Gift an NFT</h1>
      <p className="mt-4 max-w-xl text-sm leading-6 text-white/50">
        Upload an image, name it, and send it to any wallet. The recipient pays nothing.
        You pay a small Solana network fee (~0.0044 SOL) when you approve the transaction
        in your wallet. The platform covers permanent Arweave storage.
      </p>

      {error && (
        <div className="mt-4 rounded border border-red-500/40 bg-red-500/10 px-3 py-2 text-sm text-red-400">
          {error}
        </div>
      )}

      <form className="mt-10 grid gap-8 md:grid-cols-[220px_1fr]" onSubmit={handleSubmit}>
        {/* Image drop zone */}
        <label className="rounded-2xl border border-white/15 bg-white/5 flex aspect-square cursor-pointer flex-col items-center justify-center overflow-hidden text-center text-sm text-white/50 hover:border-white/30 transition-colors">
          {preview ? (
            // eslint-disable-next-line @next/next/no-img-element
            <img src={preview} alt="Preview" className="h-full w-full object-cover" />
          ) : (
            <span className="p-4 select-none">
              Drop image
              <span className="block mt-1 text-xs text-white/30">PNG · JPEG · WebP</span>
            </span>
          )}
          <input
            type="file"
            accept="image/png,image/jpeg,image/webp"
            className="hidden"
            onChange={(e) => {
              const next = e.target.files?.[0] ?? null;
              setFile(next);
              setPreview(next ? URL.createObjectURL(next) : null);
              setError(null);
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
              maxLength={32}
              onChange={(e) => setName(e.target.value)}
            />
          </label>

          <label className="block text-sm">
            <span className="mb-1 block text-white/50">Recipient wallet</span>
            <input
              className="input font-mono text-xs"
              placeholder="Solana public key (base58)"
              value={recipient}
              spellCheck={false}
              onChange={(e) => { setRecipient(e.target.value); setError(null); }}
            />
          </label>

          <label className="block text-sm">
            <span className="mb-1 block text-white/50">Note (optional)</span>
            <textarea
              className="input min-h-20"
              value={note}
              maxLength={200}
              onChange={(e) => setNote(e.target.value)}
            />
          </label>

          {/* ── Fee breakdown ─────────────────────────────────────────────── */}
          {(file || fees) && (
            <div className="rounded border border-white/10 bg-white/5 px-4 py-3 text-xs space-y-1.5">
              <p className="text-white/40 uppercase tracking-wider text-[10px] mb-2">Fee breakdown</p>

              {feesLoading && <p className="text-white/30">Fetching live fees…</p>}

              {fees && !feesLoading && (
                <>
                  {Object.values(fees.user.breakdown).map((item) => (
                    <div key={item.label} className="flex justify-between text-white/60">
                      <span>{item.label}</span>
                      <span>{fmtSol(item.sol)} SOL</span>
                    </div>
                  ))}
                  <div className="border-t border-white/10 pt-1.5 flex justify-between font-medium text-white">
                    <span>You pay</span>
                    <span>
                      {fmtSol(fees.user.sol)} SOL
                      {fees.user.usd !== null && (
                        <span className="text-white/40 ml-1">≈ {fmtUsd(fees.user.usd)}</span>
                      )}
                    </span>
                  </div>
                  <div className="flex justify-between text-white/30 pt-0.5">
                    <span>Arweave storage</span>
                    <span>Covered by platform</span>
                  </div>
                </>
              )}
            </div>
          )}

          <button
            type="submit"
            disabled={busy}
            className="w-full rounded bg-primary py-3 text-sm font-medium text-primary-foreground disabled:opacity-50 transition-opacity"
          >
            {busy ? stageLabel[stage] : stageLabel.idle}
          </button>

          {stage === "signing" && (
            <p className="text-xs text-white/40 text-center leading-relaxed">
              Check Phantom for the approval popup. Approve the transaction to mint and deliver the NFT.
            </p>
          )}
        </div>
      </form>
    </main>
  );
}
