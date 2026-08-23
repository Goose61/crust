"use client";

import { useState, useEffect, useRef } from "react";
import { Keypair } from "@solana/web3.js";
import { useWallet, rpcUrl, isDevnet } from "@/components/WalletProvider";
import { CreateWalletModal, type NewWallet } from "@/components/CreateWalletModal";
import {
  secretKeyToBase58,
  ephemeralFundingLamports,
} from "@/lib/irys-client";
import { fetchIrysPriceLamports } from "@/lib/irys-shared";

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
  recipientNote?: string;
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
  const { publicKey, connect, signAndSendTx, transferSol } = useWallet();

  const [file, setFile] = useState<File | null>(null);
  const [preview, setPreview] = useState<string | null>(null);
  const [name, setName] = useState("Gift NFT");
  const [recipient, setRecipient] = useState("");
  const [note, setNote] = useState("");
  const [createdWallet, setCreatedWallet] = useState<NewWallet | null>(null);
  const [showCreateWallet, setShowCreateWallet] = useState(false);

  const [fees, setFees] = useState<FeeBreakdown | null>(null);
  const [feesLoading, setFeesLoading] = useState(false);

  const [busy, setBusy] = useState(false);
  const [stage, setStage] = useState<
    "idle" | "funding" | "uploading" | "building" | "signing" | "confirming"
  >("idle");
  const [error, setError] = useState<string | null>(null);
  const [result, setResult] = useState<GiftResult | null>(null);

  const debounceRef = useRef<ReturnType<typeof setTimeout> | undefined>(undefined);

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
    idle: publicKey ? "Send gift" : "Connect wallet",
    funding: "Approve storage payment in wallet…",
    uploading: "Uploading to Arweave…",
    building: "Preparing mint transaction…",
    signing: "Approve mint in wallet…",
    confirming: "Confirming on-chain…",
  };

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    if (!file) { setError("Choose an image first."); return; }
    if (!recipient.trim()) { setError("Enter a recipient wallet or create one."); return; }
    if (!publicKey) { await connect(); return; }

    setBusy(true);
    setError(null);

    try {
      const imageInfo = await detectImageAsync(file);
      if (!imageInfo) throw new Error("Use a PNG, JPEG, or WebP image.");

      const imageBytes = new Uint8Array(await file.arrayBuffer());
      const nftName = `${name.trim() || "Gift NFT"} #1`;

      // ── Step 1: fund ephemeral wallet for Irys uploads (minter pays) ──
      setStage("funding");
      const devnet = isDevnet();
      const [imagePrice, metaPrice] = await Promise.all([
        fetchIrysPriceLamports(imageBytes.length, devnet),
        fetchIrysPriceLamports(512, devnet),
      ]);
      const fundLamports = ephemeralFundingLamports(imagePrice, metaPrice);

      const ephemeral = Keypair.generate();
      await transferSol(ephemeral.publicKey.toBase58(), fundLamports);
      // Brief pause so the ephemeral wallet balance is visible to Irys
      await new Promise((r) => setTimeout(r, 2_000));

      // ── Step 2: upload image + metadata to Arweave via Irys ───────────
      setStage("uploading");
      const secretB58 = secretKeyToBase58(ephemeral.secretKey);

      const { imageUri, metadataUri } = await (async () => {
        const irysMod = await import("@/lib/irys-client");
        const irys = await irysMod.createBrowserIrysUploader(secretB58, rpcUrl(), devnet);
        const imageUri = await irysMod.fundAndUpload(irys, imageBytes, imageInfo.contentType);
        const finalMeta = JSON.stringify(
          {
            name: nftName,
            description: note || "A 1/1 gift NFT.",
            image: imageUri,
            attributes: [
              ...(note ? [{ trait_type: "Note", value: note }] : []),
              { trait_type: "Type", value: "Gift" },
              { trait_type: "Edition", value: "1/1" },
            ],
            properties: {
              files: [{ uri: imageUri, type: imageInfo.contentType }],
              category: "image",
              creators: [{ address: publicKey, share: 100 }],
            },
          },
          null,
          2,
        );
        const metadataUri = await irysMod.fundAndUpload(
          irys,
          new TextEncoder().encode(finalMeta),
          "application/json",
        );
        return { imageUri, metadataUri };
      })();

      // ── Step 3: build partially-signed mint tx ────────────────────────
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
        setResult({
          collectionId: data.collectionId!,
          storageMethod: "arweave",
          onChain: false,
          recipientNote: createdWallet
            ? "Share the private key with the recipient so they can access the NFT."
            : undefined,
        });
        return;
      }

      // ── Step 4: minter signs + submits mint tx ────────────────────────
      setStage("signing");
      const txSignature = await signAndSendTx(data.txBase64);

      setStage("confirming");
      await fetch("/api/gift", {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ collectionId: data.collectionId, txSignature }),
      });

      setResult({
        collectionId: data.collectionId!,
        assetAddress: data.assetAddress,
        txSignature,
        storageMethod: "arweave",
        onChain: true,
        recipientNote: createdWallet
          ? "Share the saved private key with the recipient so they can import the wallet in Phantom."
          : undefined,
      });
    } catch (err) {
      const msg = err instanceof Error ? err.message : "Something went wrong";
      setError(msg.toLowerCase().includes("rejected") ? "Transaction cancelled in wallet." : msg);
      setStage("idle");
    } finally {
      setBusy(false);
    }
  }

  if (result) {
    const cluster = isDevnet() ? "?cluster=devnet" : "";
    return (
      <main className="container mx-auto max-w-2xl px-4 py-16 text-center">
        <div className="text-6xl mb-4">{result.onChain ? "🎁" : "📋"}</div>
        <h1 className="text-3xl font-semibold text-white mb-2">
          {result.onChain ? "Gift sent on-chain" : "Gift recorded"}
        </h1>
        {result.recipientNote && (
          <p className="text-yellow-300/80 text-sm mb-4 max-w-md mx-auto">{result.recipientNote}</p>
        )}
        <div className="space-y-3 mb-8 text-left">
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
              View transaction on Solana Explorer ↗
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
            setCreatedWallet(null); setFees(null); setError(null); setStage("idle");
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
      <CreateWalletModal
        open={showCreateWallet}
        onClose={() => setShowCreateWallet(false)}
        onUse={(w) => { setRecipient(w.publicKey); setCreatedWallet(w); }}
      />

      <p className="font-[family-name:var(--font-mono)] text-[11px] tracking-[0.22em] text-white/50">1 / 1</p>
      <h1 className="mt-2 text-5xl md:text-7xl">Gift an NFT</h1>
      <p className="mt-4 max-w-xl text-sm leading-6 text-white/50">
        Upload an image and send it to any wallet. You pay all fees: permanent Arweave
        storage and Solana mint costs. The recipient receives the NFT for free.
      </p>

      {error && (
        <div className="mt-4 rounded border border-red-500/40 bg-red-500/10 px-3 py-2 text-sm text-red-400">
          {error}
        </div>
      )}

      <form className="mt-10 grid gap-8 md:grid-cols-[220px_1fr]" onSubmit={handleSubmit}>
        <label className="rounded-2xl border border-white/15 bg-white/5 flex aspect-square cursor-pointer flex-col items-center justify-center overflow-hidden text-center text-sm text-white/50 hover:border-white/30">
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

        <div className="space-y-4">
          <label className="block text-sm">
            <span className="mb-1 block text-white/50">Name</span>
            <input className="input" value={name} maxLength={32} onChange={(e) => setName(e.target.value)} />
          </label>

          <div className="block text-sm">
            <span className="mb-1 block text-white/50">Recipient wallet</span>
            <input
              className="input font-mono text-xs"
              placeholder="Solana public key (base58)"
              value={recipient}
              spellCheck={false}
              onChange={(e) => { setRecipient(e.target.value); setCreatedWallet(null); setError(null); }}
            />
            <button
              type="button"
              onClick={() => setShowCreateWallet(true)}
              className="mt-2 text-xs text-primary hover:underline"
            >
              Create new wallet for recipient
            </button>
            {createdWallet && (
              <p className="mt-1 text-xs text-yellow-400/80">
                New wallet selected. Make sure you saved the private key.
              </p>
            )}
          </div>

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

          {(stage === "funding" || stage === "signing") && (
            <p className="text-xs text-white/40 text-center">
              Check Phantom and approve the transaction to continue.
            </p>
          )}
        </div>
      </form>
    </main>
  );
}
