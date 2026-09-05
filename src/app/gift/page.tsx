"use client";

import { useState, useEffect, useRef } from "react";
import { useWallet } from "@/components/WalletProvider";
import { explorerClusterQuery, getClientNetwork } from "@/lib/solana-config";
import { uploadGiftWithPhantom } from "@/lib/irys-client";
import { readJsonResponse } from "@/lib/fetch-json";
import { buildGiftMetadataJson, GIFT_NAME } from "@/lib/gift-metadata";
import { giftBundleHref } from "@/lib/gift-bundle";

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
  tokenId?: number;
  assetAddress?: string;
  txSignature?: string;
  metadataUri?: string;
  imageUri?: string;
  storageMethod: string;
  onChain: boolean;
};

function fmtSol(sol: number) {
  return sol.toLocaleString("en-US", { minimumFractionDigits: 4, maximumFractionDigits: 6 });
}

function fmtUsd(usd: number) {
  return usd.toLocaleString("en-US", { style: "currency", currency: "USD", minimumFractionDigits: 2 });
}

async function detectImageFromBytes(buf: Uint8Array): Promise<{ ext: string; contentType: string } | null> {
  if (buf.length >= 4 && buf[0] === 0x89 && buf[1] === 0x50) return { ext: ".png", contentType: "image/png" };
  if (buf.length >= 3 && buf[0] === 0xff && buf[1] === 0xd8) return { ext: ".jpeg", contentType: "image/jpeg" };
  return null;
}

type ImagePayload = {
  bytes: Uint8Array;
  ext: string;
  contentType: string;
  size: number;
};

type GiftConfig = {
  platformCreatorAddress: string | null;
  coreCollectionAddress: string | null;
  giftBundleCollectionId: string;
  giftCollectionName: string;
};

type BalanceCheck = {
  balanceSol: number;
  requiredSol: number;
  storageSol: number;
  mintSol: number;
  shortfallSol: number;
  sufficient: boolean;
  message: string | null;
};

export default function GiftPage() {
  const { publicKey, connecting, connect, signMintTx } = useWallet();

  const [file, setFile] = useState<File | null>(null);
  const [imagePayload, setImagePayload] = useState<ImagePayload | null>(null);
  const [preview, setPreview] = useState<string | null>(null);
  const [name, setName] = useState(GIFT_NAME);
  const [recipient, setRecipient] = useState("");
  const [mintToSelf, setMintToSelf] = useState(false);
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
  const previewUrlRef = useRef<string | null>(null);
  const [dragOver, setDragOver] = useState(false);
  const [giftConfig, setGiftConfig] = useState<GiftConfig | null>(null);
  const [balanceCheck, setBalanceCheck] = useState<BalanceCheck | null>(null);
  const [balanceLoading, setBalanceLoading] = useState(false);

  useEffect(() => {
    void fetch("/api/gift/config")
      .then((res) => (res.ok ? res.json() : null))
      .then((data: GiftConfig | null) => {
        if (data) setGiftConfig(data);
      })
      .catch(() => {});
  }, []);

  useEffect(() => {
    if (mintToSelf && publicKey) setRecipient(publicKey);
  }, [mintToSelf, publicKey]);

  async function applyImageFile(next: File | null) {
    if (!next) return;
    if (!["image/png", "image/jpeg"].includes(next.type)) {
      setError("Use a PNG or JPEG image — wallets display these most reliably.");
      return;
    }
    try {
      // Snapshot bytes immediately — File handles go stale after wallet popups on some browsers.
      const bytes = new Uint8Array(await next.arrayBuffer());
      const imageInfo = await detectImageFromBytes(bytes);
      if (!imageInfo) {
        setError("Use a PNG or JPEG image — wallets display these most reliably.");
        return;
      }
      if (previewUrlRef.current) URL.revokeObjectURL(previewUrlRef.current);
      const objectUrl = URL.createObjectURL(next);
      previewUrlRef.current = objectUrl;
      setFile(next);
      setImagePayload({
        bytes,
        ext: imageInfo.ext,
        contentType: imageInfo.contentType,
        size: bytes.length,
      });
      setPreview(objectUrl);
      setError(null);
    } catch {
      setError("Could not read that image. Choose the file again (do not rename or move it while sending).");
      setFile(null);
      setImagePayload(null);
      setPreview(null);
    }
  }

  function onDropImage(e: React.DragEvent) {
    e.preventDefault();
    e.stopPropagation();
    setDragOver(false);
    applyImageFile(e.dataTransfer.files?.[0] ?? null);
  }

  useEffect(() => {
    clearTimeout(debounceRef.current);
    if (!imagePayload) { setFees(null); return; }
    setFeesLoading(true);
    debounceRef.current = setTimeout(async () => {
      try {
        const res = await fetch(`/api/gift/estimate?imageBytes=${imagePayload.size}`);
        if (res.ok) setFees(await res.json());
      } finally {
        setFeesLoading(false);
      }
    }, 400);
  }, [imagePayload]);

  useEffect(() => {
    if (!publicKey || !imagePayload) {
      setBalanceCheck(null);
      return;
    }

    let cancelled = false;
    setBalanceLoading(true);

    void (async () => {
      try {
        const network = await getClientNetwork();
        const res = await fetch(
          `/api/gift/balance-check?wallet=${encodeURIComponent(publicKey)}&imageBytes=${imagePayload.size}&network=${network}`,
        );
        if (!res.ok || cancelled) return;
        const data = (await res.json()) as BalanceCheck;
        if (!cancelled) setBalanceCheck(data);
      } catch {
        if (!cancelled) setBalanceCheck(null);
      } finally {
        if (!cancelled) setBalanceLoading(false);
      }
    })();

    return () => {
      cancelled = true;
    };
  }, [publicKey, imagePayload]);

  const insufficientBalance =
    balanceCheck !== null && !balanceCheck.sufficient && !balanceLoading;

  const stageLabel: Record<typeof stage, string> = {
    idle: publicKey ? "Send gift" : "Connect wallet",
    storage: "Approve storage payment in your wallet…",
    uploading: "Uploading to Arweave — waiting for confirmation (up to 2 min)…",
    building: "Preparing mint transaction…",
    minting: "Approve mint in your wallet…",
    confirming: "Confirming on-chain…",
  };

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    if (!imagePayload) { setError("Choose an image first."); return; }
    if (!recipient.trim()) { setError("Enter the recipient wallet address."); return; }
    if (!publicKey) {
      try { await connect(); } catch (err) {
        setError(err instanceof Error ? err.message : "Could not connect wallet.");
      }
      return;
    }
    if (insufficientBalance && balanceCheck?.message) {
      setError(balanceCheck.message);
      return;
    }

    setBusy(true);
    setError(null);

    try {
      const network = await getClientNetwork();
      const imageInfo = {
        ext: imagePayload.ext,
        contentType: imagePayload.contentType,
      };

      const imageBytes = imagePayload.bytes;

      // ── Step 1: Arweave storage via Phantom (fund tx + upload signatures) ──
      setStage("storage");

      const { imageUri, metadataUri } = await uploadGiftWithPhantom({
        imageBytes,
        imageContentType: imageInfo.contentType,
        network,
        onStage: (s) => setStage(s === "funding" ? "storage" : "uploading"),
        buildMetadata: (uri) =>
          buildGiftMetadataJson({
            name: name.trim() || GIFT_NAME,
            note: note || undefined,
            imageUri: uri,
            imageContentType: imageInfo.contentType,
            platformCreatorAddress:
              giftConfig?.platformCreatorAddress ?? publicKey,
            payerAddress: publicKey,
          }),
      });

      // ── Step 2: build partially-signed mint tx ────────────────────────
      setStage("building");
      const res = await fetch("/api/gift", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          name: name.trim() || GIFT_NAME,
          recipient: recipient.trim(),
          payer: publicKey,
          note,
          imageUri,
          metadataUri,
          contentType: imageInfo.contentType,
          imageExt: imageInfo.ext,
          network,
        }),
      });
      const data = await readJsonResponse<{
        collectionId?: string;
        tokenId?: number;
        txBase64?: string;
        assetAddress?: string;
        requiresWalletSignature?: boolean;
        error?: string;
      }>(res);
      if (!res.ok) throw new Error(data.error ?? "Failed to build mint transaction");

      if (!data.requiresWalletSignature || !data.txBase64) {
        setResult({
          collectionId: data.collectionId!,
          tokenId: data.tokenId,
          metadataUri,
          imageUri,
          storageMethod: "arweave",
          onChain: false,
        });
        return;
      }

      // ── Step 3: mint NFT (Phantom tx #2) ──────────────────────────────
      setStage("minting");
      const txSignature = await signMintTx(data.collectionId!, network);

      setStage("confirming");
      const confirmRes = await fetch("/api/gift", {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          collectionId: data.collectionId,
          tokenId: data.tokenId,
          txSignature,
          network,
        }),
      });
      const confirmData = await readJsonResponse<{ ok?: boolean; error?: string }>(confirmRes);
      if (!confirmRes.ok || !confirmData.ok) {
        throw new Error(confirmData.error ?? "Failed to confirm mint on server");
      }

      setResult({
        collectionId: data.collectionId!,
        tokenId: data.tokenId,
        assetAddress: data.assetAddress,
        txSignature,
        metadataUri,
        imageUri,
        storageMethod: "arweave",
        onChain: true,
      });
    } catch (err) {
      const raw = err instanceof Error ? err.message : "Something went wrong";
      const msg =
        raw.toLowerCase().includes("rejected") || raw.toLowerCase().includes("cancel")
          ? "Request cancelled in your wallet."
          : raw.toLowerCase().includes("could not be read") ||
              raw.toLowerCase().includes("permission")
            ? "Image file could not be read. Choose the image again and approve in your wallet without switching apps."
            : raw;
      setError(msg);
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
        {result.onChain && (
          <p className="mt-3 text-xs text-white/40 max-w-md mx-auto">
            Your mint succeeded on-chain (two Phantom steps: storage, then mint — no extra signature).
            Phantom may file new NFTs under{" "}
            <span className="text-white/60">Collectibles → Hidden / Spam</span>; open the NFT and
            tap <span className="text-white/60">Not spam</span> if it appears there. Explorer links
            below always show the token.
          </p>
        )}
        <div className="space-y-3 mb-8 text-left mt-8">
          {result.assetAddress && (
            <>
              <div className="rounded border border-white/10 bg-white/5 px-4 py-3">
                <p className="text-xs text-white/40 mb-1 uppercase tracking-wider">Mint address</p>
                <p className="font-mono text-xs text-white break-all">{result.assetAddress}</p>
              </div>
              <a
                href={`https://explorer.solana.com/address/${result.assetAddress}${cluster}`}
                target="_blank"
                rel="noopener noreferrer"
                className="block rounded border border-white/10 bg-white/5 px-4 py-3 text-sm text-primary hover:border-primary/40"
              >
                View NFT mint on Solana Explorer ↗
              </a>
            </>
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
          {result.metadataUri && (
            <a
              href={result.metadataUri}
              target="_blank"
              rel="noopener noreferrer"
              className="block rounded border border-white/10 bg-white/5 px-4 py-3 text-sm text-primary hover:border-primary/40"
            >
              View metadata JSON on Arweave ↗
            </a>
          )}
          {result.imageUri && (
            <a
              href={result.imageUri}
              target="_blank"
              rel="noopener noreferrer"
              className="block rounded border border-white/10 bg-white/5 px-4 py-3 text-sm text-white/70 hover:text-white"
            >
              View image on Arweave ↗
            </a>
          )}
          <a
            href={giftBundleHref(result.tokenId)}
            className="block rounded border border-white/10 bg-white/5 px-4 py-3 text-sm text-white/70 hover:text-white"
          >
            View in Dough Boi collection ↗
          </a>
        </div>
        <button
          type="button"
          onClick={() => {
            if (previewUrlRef.current) URL.revokeObjectURL(previewUrlRef.current);
            previewUrlRef.current = null;
            setResult(null); setFile(null); setImagePayload(null); setPreview(null);
            setName(GIFT_NAME); setRecipient(""); setMintToSelf(false); setNote("");
            setFees(null); setBalanceCheck(null); setError(null); setStage("idle");
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
      <h1 className="mt-2 text-5xl md:text-7xl">Gift a $PIZZA NFT</h1>
      <p className="mt-4 max-w-xl text-sm leading-6 text-white/50">
        Drop a PNG or JPEG, pick a recipient, and send a 1/1 $PIZZA gift NFT.
        You pay all fees from your wallet — the recipient gets it for free.
      </p>

      {!publicKey && (
        <div className="mt-4 rounded-lg border border-primary/30 bg-primary/10 px-4 py-3 flex flex-col gap-2 sm:flex-row sm:items-center sm:justify-between">
          <p className="text-sm text-white/80">
            Connect your wallet first — then fill out the form below.
          </p>
          <button
            type="button"
            onClick={() => void connect()}
            disabled={connecting}
            className="shrink-0 rounded-full bg-primary px-5 py-2 text-sm font-medium text-white hover:bg-primary/80 disabled:opacity-50"
          >
            {connecting ? "Connecting…" : "Connect wallet"}
          </button>
        </div>
      )}

      <div className="mt-4 rounded border border-white/10 bg-white/5 px-4 py-3 text-xs text-white/60 space-y-1">
        <p className="font-medium text-white/80">What your wallet will ask you to approve</p>
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
              <span className="block mt-1 text-xs text-white/30">PNG · JPEG</span>
            </span>
          )}
          <input
            type="file"
            accept="image/png,image/jpeg"
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

          <div className="block text-sm">
            <span className="mb-1 block text-white/50">Recipient wallet</span>
            <input
              className="input font-mono text-xs"
              placeholder="Solana address (base58)"
              value={recipient}
              spellCheck={false}
              readOnly={mintToSelf}
              onChange={(e) => {
                setMintToSelf(false);
                setRecipient(e.target.value);
                setError(null);
              }}
            />
            {publicKey && (
              <label className="mt-2 flex cursor-pointer items-center gap-2 text-xs text-white/60">
                <input
                  type="checkbox"
                  className="rounded border-white/30"
                  checked={mintToSelf}
                  onChange={(e) => {
                    const checked = e.target.checked;
                    setMintToSelf(checked);
                    setRecipient(checked ? publicKey : "");
                    setError(null);
                  }}
                />
                Mint to my connected wallet
              </label>
            )}
          </div>

          <label className="block text-sm">
            <span className="mb-1 block text-white/50">Note (optional)</span>
            <textarea className="input min-h-20" value={note} maxLength={200} onChange={(e) => setNote(e.target.value)} />
          </label>

          {(imagePayload || fees) && (
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

          {publicKey && imagePayload && (
            <div
              className={`rounded border px-4 py-3 text-xs ${
                balanceLoading
                  ? "border-white/10 bg-white/5 text-white/50"
                  : insufficientBalance
                    ? "border-amber-500/50 bg-amber-500/10 text-amber-100"
                    : balanceCheck
                      ? "border-emerald-500/30 bg-emerald-500/5 text-emerald-100/80"
                      : "border-white/10 bg-white/5 text-white/50"
              }`}
            >
              {balanceLoading && <p>Checking wallet balance…</p>}
              {!balanceLoading && balanceCheck && (
                <>
                  <p className="font-medium">
                    {insufficientBalance ? "⚠️ Not enough SOL in your wallet" : "✓ Wallet balance looks OK"}
                  </p>
                  <p className="mt-1 opacity-90">
                    Balance: {fmtSol(balanceCheck.balanceSol)} SOL · Need: {fmtSol(balanceCheck.requiredSol)} SOL
                    {insufficientBalance && (
                      <> · Short: {fmtSol(balanceCheck.shortfallSol)} SOL</>
                    )}
                  </p>
                  {insufficientBalance && balanceCheck.message && (
                    <p className="mt-2 leading-relaxed opacity-90">{balanceCheck.message}</p>
                  )}
                  {!insufficientBalance && (
                    <p className="mt-1 opacity-75">
                      Storage (~{fmtSol(balanceCheck.storageSol)} SOL) is charged first; keep ~{fmtSol(balanceCheck.mintSol)} SOL for the mint step.
                    </p>
                  )}
                </>
              )}
            </div>
          )}

          <button
            type="submit"
            disabled={busy || insufficientBalance || balanceLoading}
            className="w-full rounded bg-primary py-3 text-sm font-medium text-primary-foreground disabled:opacity-50"
          >
            {busy ? stageLabel[stage] : stageLabel.idle}
          </button>
        </div>
      </form>
    </main>
  );
}
