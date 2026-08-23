"use client";

import { useState, useEffect, useRef } from "react";
import { useWallet, rpcUrl, isDevnet, networkName } from "@/components/WalletProvider";
import { explorerClusterQuery } from "@/lib/solana-config";
import { uploadGiftWithPhantom } from "@/lib/irys-client";

type FeeBreakdown = {
  user: {
    breakdown: Record<string, { sol: number; label: string }>;
    sol: number;
    usd: number | null;
  };
  solPrice: number;
};

type GiftResult = {
  collectionId: string;
  assetAddress?: string;
  txSignature?: string;
  storageMethod: string;
  onChain: boolean;
};

function fmtSol(sol: number) {
  return sol.toLocaleString("en-US", { minimumFractionDigits: 4, maximumFractionDigits: 6 });
}

function fmtUsd(usd: number) {
  return usd.toLocaleString("en-US", { style: "currency", currency: "USD", minimumFractionDigits: 2 });
}

async function detectImageAsync(file: File): Promise<{ ext: string; contentType: string } | null> {
  const buf = new Uint8Array(await file.slice(0, 16).arrayBuffer());
  if (buf.length >= 4 && buf[0] === 0x89 && buf[1] === 0x50) return { ext: ".png", contentType: "image/png" };
  if (buf.length >= 3 && buf[0] === 0xff && buf[1] === 0xd8) return { ext: ".jpeg", contentType: "image/jpeg" };
  if (buf.length >= 12 && buf[0] === 0x52 && buf[8] === 0x57) return { ext: ".webp", contentType: "image/webp" };
  return null;
}

export default function GiftPage() {
  const { publicKey, connecting, connect, signAndSendTx } = useWallet();

  const [file, setFile] = useState<File | null>(null);
  const [preview, setPreview] = useState<string | null>(null);
  const [name, setName] = useState("Gift NFT");
  const [recipient, setRecipient] = useState("");
  const [note, setNote] = useState("");

  const [fees, setFees] = useState<FeeBreakdown | null>(null);
  const [feesLoading, setFeesLoading] = useState(false);

  const [busy, setBusy] = useState(false);
  const [stage, setStage] = useState<
    "idle" | "storage" | "uploading" | "building" | "minting" | "confirming"
  >("idle");
  const [error, setError] = useState<string | null>(null);
  const [result, setResult] = useState<GiftResult | null>(null);

  const debounceRef = useRef<ReturnType<typeof setTimeout> | undefined>(undefined);
  const [dragOver, setDragOver] = useState(false);

  function applyImageFile(next: File | null) {
    if (!next) return;
    if (!["image/png", "image/jpeg", "image/webp"].includes(next.type)) {
      setError("Use a PNG, JPEG, or WebP image.");
      return;
    }
    setFile(next);
    setPreview(URL.createObjectURL(next));
    setError(null);
  }

  function onDropImage(e: React.DragEvent) {
    e.preventDefault();
    e.stopPropagation();
    setDragOver(false);
    applyImageFile(e.dataTransfer.files?.[0] ?? null);
  }

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

  const stageLabel: Record<typeof stage, string> = {
    idle: publicKey ? "Send gift" : "Connect Phantom",
    storage: "Approve storage payment in Phantom…",
    uploading: "Uploading to Arweave…",
    building: "Preparing mint transaction…",
    minting: "Approve mint in Phantom…",
    confirming: "Confirming on-chain…",
  };

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    if (!file) { setError("Choose an image first."); return; }
    if (!recipient.trim()) { setError("Enter the recipient wallet address."); return; }
    if (!publicKey) {
      try { await connect(); } catch (err) {
        setError(err instanceof Error ? err.message : "Could not connect Phantom.");
      }
      return;
    }

    setBusy(true);
    setError(null);

    try {
      const imageInfo = await detectImageAsync(file);
      if (!imageInfo) throw new Error("Use a PNG, JPEG, or WebP image.");

      const imageBytes = new Uint8Array(await file.arrayBuffer());
      const nftName = `${name.trim() || "Gift NFT"} #1`;

      // ── Step 1: Arweave storage via Phantom (fund tx + upload signatures) ──
      setStage("uploading");

      const { imageUri, metadataUri } = await uploadGiftWithPhantom({
        imageBytes,
        imageContentType: imageInfo.contentType,
        buildMetadata: (uri) =>
          JSON.stringify(
            {
              name: nftName,
              description: note || "A 1/1 gift NFT.",
              image: uri,
              attributes: [
                ...(note ? [{ trait_type: "Note", value: note }] : []),
                { trait_type: "Type", value: "Gift" },
                { trait_type: "Edition", value: "1/1" },
              ],
              properties: {
                files: [{ uri, type: imageInfo.contentType }],
                category: "image",
                creators: [{ address: publicKey, share: 100 }],
              },
            },
            null,
            2,
          ),
        rpcUrl: rpcUrl(),
        devnet: isDevnet(),
      });

      // ── Step 2: build partially-signed mint tx ────────────────────────
      setStage("building");
      const res = await fetch("/api/gift", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          name: name.trim() || "Gift NFT",
          recipient: recipient.trim(),
          payer: publicKey,
          note,
          imageUri,
          metadataUri,
          contentType: imageInfo.contentType,
          imageExt: imageInfo.ext,
          network: networkName(),
        }),
      });
      const data = await res.json() as {
        collectionId?: string;
        txBase64?: string;
        assetAddress?: string;
        requiresWalletSignature?: boolean;
        error?: string;
      };
      if (!res.ok) throw new Error(data.error ?? "Failed to build mint transaction");

      if (!data.requiresWalletSignature || !data.txBase64) {
        setResult({ collectionId: data.collectionId!, storageMethod: "arweave", onChain: false });
        return;
      }

      // ── Step 3: mint NFT (Phantom tx #2) ──────────────────────────────
      setStage("minting");
      const txSignature = await signAndSendTx(data.txBase64);

      setStage("confirming");
      await fetch("/api/gift", {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ collectionId: data.collectionId, txSignature, network: networkName() }),
      });

      setResult({
        collectionId: data.collectionId!,
        assetAddress: data.assetAddress,
        txSignature,
        storageMethod: "arweave",
        onChain: true,
      });
    } catch (err) {
      const msg = err instanceof Error ? err.message : "Something went wrong";
      setError(msg.toLowerCase().includes("rejected") || msg.toLowerCase().includes("cancel")
        ? "Request cancelled in Phantom."
        : msg);
      setStage("idle");
    } finally {
      setBusy(false);
    }
  }

  if (result) {
    const cluster = explorerClusterQuery();
    return (
      <main className="container mx-auto max-w-2xl px-4 py-16 text-center">
        <div className="text-6xl mb-4">{result.onChain ? "🎁" : "📋"}</div>
        <h1 className="text-3xl font-semibold text-white mb-2">
          {result.onChain ? "Gift sent on-chain" : "Gift recorded"}
        </h1>
        {result.onChain && recipient.trim() && (
          <p className="mt-2 text-sm text-white/50">
            The NFT was minted to{" "}
            <span className="font-mono text-white/70">{recipient.trim()}</span>.
            {publicKey && recipient.trim() !== publicKey && (
              <> It will not appear in your wallet — the recipient must check theirs in Phantom.</>
            )}
          </p>
        )}
        <div className="space-y-3 mb-8 text-left mt-8">
          {result.assetAddress && (
            <div className="rounded border border-white/10 bg-white/5 px-4 py-3">
              <p className="text-xs text-white/40 mb-1 uppercase tracking-wider">Asset address</p>
              <p className="font-mono text-xs text-white break-all">{result.assetAddress}</p>
            </div>
          )}
          {result.txSignature && (
            <a
              href={`https://explorer.solana.com/tx/${result.txSignature}${cluster}`}
              target="_blank"
              rel="noopener noreferrer"
              className="block rounded border border-white/10 bg-white/5 px-4 py-3 text-sm text-primary hover:border-primary/40"
            >
              View mint transaction on Solana Explorer ↗
            </a>
          )}
          <a
            href={`/collection/${result.collectionId}`}
            className="block rounded border border-white/10 bg-white/5 px-4 py-3 text-sm text-white/70 hover:text-white"
          >
            View collection page ↗
          </a>
        </div>
        <button
          type="button"
          onClick={() => {
            setResult(null); setFile(null); setPreview(null);
            setName("Gift NFT"); setRecipient(""); setNote("");
            setFees(null); setError(null); setStage("idle");
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
      <p className="font-[family-name:var(--font-mono)] text-[11px] tracking-[0.22em] text-white/50">1 / 1</p>
      <h1 className="mt-2 text-5xl md:text-7xl">Gift an NFT</h1>
      <p className="mt-4 max-w-xl text-sm leading-6 text-white/50">
        Connect with Phantom to send a 1/1 NFT. You pay all fees from your wallet.
        The recipient receives the NFT for free. Your private key never leaves Phantom.
      </p>

      {!publicKey && (
        <div className="mt-4 rounded-lg border border-primary/30 bg-primary/10 px-4 py-3 flex flex-col gap-2 sm:flex-row sm:items-center sm:justify-between">
          <p className="text-sm text-white/80">
            Connect your Phantom wallet first — then fill out the form below.
          </p>
          <button
            type="button"
            onClick={() => void connect()}
            disabled={connecting}
            className="shrink-0 rounded-full bg-primary px-5 py-2 text-sm font-medium text-white hover:bg-primary/80 disabled:opacity-50"
          >
            {connecting ? "Connecting…" : "Connect Phantom"}
          </button>
        </div>
      )}

      <div className="mt-4 rounded border border-white/10 bg-white/5 px-4 py-3 text-xs text-white/60 space-y-1">
        <p className="font-medium text-white/80">What Phantom will ask you to approve</p>
        <p>1. <span className="text-white">Storage payment</span> — funds permanent Arweave upload (one Solana transaction)</p>
        <p>2. <span className="text-white">Mint transaction</span> — creates the NFT on-chain and sends it to the recipient</p>
        <p className="text-white/40 pt-1">Upload steps may also show message signature prompts (no extra SOL).</p>
      </div>

      {error && (
        <div className="mt-4 rounded border border-red-500/40 bg-red-500/10 px-3 py-2 text-sm text-red-400">
          {error}
        </div>
      )}

      <form
        className="mt-10 grid gap-8 md:grid-cols-[220px_1fr]"
        onSubmit={handleSubmit}
        onDragOver={(e) => e.preventDefault()}
      >
        <label
          className={`rounded-2xl border bg-white/5 flex aspect-square cursor-pointer flex-col items-center justify-center overflow-hidden text-center text-sm text-white/50 hover:border-white/30 ${
            dragOver ? "border-primary/60 bg-primary/5" : "border-white/15"
          }`}
          onDrop={onDropImage}
          onDragOver={(e) => {
            e.preventDefault();
            e.stopPropagation();
            setDragOver(true);
          }}
          onDragLeave={(e) => {
            e.preventDefault();
            setDragOver(false);
          }}
        >
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
              applyImageFile(e.target.files?.[0] ?? null);
              e.target.value = "";
            }}
          />
        </label>

        <div className="space-y-4">
          <label className="block text-sm">
            <span className="mb-1 block text-white/50">Name</span>
            <input className="input" value={name} maxLength={32} onChange={(e) => setName(e.target.value)} />
          </label>

          <label className="block text-sm">
            <span className="mb-1 block text-white/50">Recipient wallet</span>
            <input
              className="input font-mono text-xs"
              placeholder="Solana address (base58)"
              value={recipient}
              spellCheck={false}
              onChange={(e) => { setRecipient(e.target.value); setError(null); }}
            />
          </label>

          <label className="block text-sm">
            <span className="mb-1 block text-white/50">Note (optional)</span>
            <textarea className="input min-h-20" value={note} maxLength={200} onChange={(e) => setNote(e.target.value)} />
          </label>

          {(file || fees) && (
            <div className="rounded border border-white/10 bg-white/5 px-4 py-3 text-xs space-y-1.5">
              <p className="text-white/40 uppercase tracking-wider text-[10px] mb-2">You pay (live estimate)</p>
              {feesLoading && <p className="text-white/30">Fetching fees…</p>}
              {fees && !feesLoading && (
                <>
                  {Object.values(fees.user.breakdown).map((item) => (
                    <div key={item.label} className="flex justify-between text-white/60">
                      <span>{item.label}</span>
                      <span>{fmtSol(item.sol)} SOL</span>
                    </div>
                  ))}
                  <div className="border-t border-white/10 pt-1.5 flex justify-between font-medium text-white">
                    <span>Total</span>
                    <span>
                      {fmtSol(fees.user.sol)} SOL
                      {fees.user.usd !== null && (
                        <span className="text-white/40 ml-1">≈ {fmtUsd(fees.user.usd)}</span>
                      )}
                    </span>
                  </div>
                </>
              )}
            </div>
          )}

          <button
            type="submit"
            disabled={busy}
            className="w-full rounded bg-primary py-3 text-sm font-medium text-primary-foreground disabled:opacity-50"
          >
            {busy ? stageLabel[stage] : stageLabel.idle}
          </button>
        </div>
      </form>
    </main>
  );
}
