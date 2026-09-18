"use client";

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import Link from "next/link";
import type { Collection } from "@/lib/types";
import { useWallet, networkName } from "@/components/WalletProvider";
import { buildAuthHeaders } from "@/lib/wallet-auth-client";
import { uploadCollectionLogo } from "@/lib/upload-collection-logo";
import { logoImageSrc, tokenName } from "@/lib/collection-ui";
import { isLaunchedCreatorCollection } from "@/lib/creator-access";
import { readJsonResponse } from "@/lib/fetch-json";

function canContinueLaunch(c: Collection) {
  return c.status === "draft" || c.status === "importing";
}

export default function DashboardPage() {
  const { publicKey, connect } = useWallet();
  const [collections, setCollections] = useState<Collection[]>([]);
  const [loadError, setLoadError] = useState<string | null>(null);
  const [logoBusyId, setLogoBusyId] = useState<string | null>(null);
  const [loadingPublic, setLoadingPublic] = useState(true);
  const [loadingLaunches, setLoadingLaunches] = useState(false);
  const [launchesAuthed, setLaunchesAuthed] = useState(false);
  const logoInputRef = useRef<HTMLInputElement>(null);
  const logoTargetId = useRef<string | null>(null);

  const loadPublicCollections = useCallback(async () => {
    setLoadingPublic(true);
    setLoadError(null);
    try {
      const publicRes = await fetch("/api/collections");
      const publicData = await publicRes.json();
      setCollections(publicData.collections ?? []);
    } catch (e) {
      setLoadError(e instanceof Error ? e.message : "Could not load collections");
    } finally {
      setLoadingPublic(false);
    }
  }, []);

  useEffect(() => {
    void loadPublicCollections();
  }, [loadPublicCollections]);

  useEffect(() => {
    setLaunchesAuthed(false);
  }, [publicKey]);

  async function loadLaunches() {
    if (!publicKey) {
      await connect();
      return;
    }
    setLoadingLaunches(true);
    setLoadError(null);
    try {
      const headers = await buildAuthHeaders(publicKey, { force: true });
      const authed = await fetch("/api/collections", { headers });
      const authedData = await authed.json();
      if (!authed.ok) {
        throw new Error(authedData.error ?? "Could not load launches");
      }
      if (Array.isArray(authedData.collections)) {
        setCollections(authedData.collections);
      }
      setLaunchesAuthed(true);
    } catch (e) {
      setLaunchesAuthed(false);
      setLoadError(e instanceof Error ? e.message : "Could not load launches");
    } finally {
      setLoadingLaunches(false);
    }
  }

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
    <main className="container mx-auto max-w-4xl px-4 py-8 sm:py-12">
      <h1 className="text-2xl text-white sm:text-3xl">Creator dashboard</h1>
      <p className="mt-2 text-sm text-white/50">
        {publicKey
          ? `Collections for ${publicKey.slice(0, 6)}…${publicKey.slice(-4)}`
          : "Connect the wallet you launched with to manage logos and drops."}
      </p>
      <div className="mt-4 flex flex-wrap items-center gap-3">
        {!publicKey && (
          <button
            type="button"
            onClick={() => void connect()}
            className="rounded-lg bg-primary px-4 py-2 text-sm text-white"
          >
            Connect wallet
          </button>
        )}
        {publicKey && (
          <button
            type="button"
            disabled={loadingLaunches}
            onClick={() => void loadLaunches()}
            className="rounded-lg bg-primary px-4 py-2 text-sm font-medium text-white hover:bg-primary/90 disabled:opacity-50"
          >
            {loadingLaunches ? "Waiting for signature…" : "Load launches"}
          </button>
        )}
      </div>
      {publicKey && (
        <p className="mt-2 text-xs text-white/40">
          {launchesAuthed
            ? "Wallet signed — drafts and creator tools are unlocked for this session."
            : "Load launches to approve the auth message in your wallet, then your drafts and logo tools appear."}
        </p>
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

      {publicKey && !loadingPublic && launched.length === 0 && drafts.length === 0 && (
        <p className="mt-8 text-sm text-white/50">
          {launchesAuthed
            ? <>
                No launched collections for this wallet.{" "}
                <Link href="/launch" className="text-primary hover:underline">
                  Launch one
                </Link>
                .
              </>
            : "No public collections for this wallet yet. Load launches if you have drafts."}
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
              onCollectionUpdate={(updated) =>
                setCollections((prev) => prev.map((row) => (row.id === updated.id ? { ...row, ...updated } : row)))
              }
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

function giftableTokens(collection: Collection) {
  return collection.tokens.filter((t) => !t.owner && !t.reservedBy);
}

function looksLikeSolanaAddress(value: string) {
  return /^[1-9A-HJ-NP-Za-km-z]{32,44}$/.test(value.trim());
}

function DashboardRow({
  collection: c,
  logoBusy,
  onPickLogo,
  onReveal,
  onCollectionUpdate,
}: {
  collection: Collection;
  logoBusy: boolean;
  onPickLogo: () => void;
  onReveal?: () => void;
  onCollectionUpdate?: (collection: Collection) => void;
}) {
  const logo = logoImageSrc(c);
  const canGift = c.status === "live" && giftableTokens(c).length > 0;
  const [giftOpen, setGiftOpen] = useState(false);
  return (
    <div className="rounded-2xl border border-white/15 bg-card p-4">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div className="flex min-w-0 items-center gap-3">
          {logo ? (
            <div className="collection-logo-frame h-14 w-14 shrink-0 rounded-xl p-1">
              {/* eslint-disable-next-line @next/next/no-img-element */}
              <img src={logo} alt="" className="collection-logo" />
            </div>
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
          {canGift && onCollectionUpdate && (
            <button
              type="button"
              onClick={() => setGiftOpen((open) => !open)}
              className="rounded-lg bg-white/10 px-3 py-1.5 text-xs font-medium text-white hover:bg-white/15"
            >
              {giftOpen ? "Hide gift" : "Gift NFT"}
            </button>
          )}
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
      {giftOpen && onCollectionUpdate && (
        <GiftNftPanel collection={c} onCollectionUpdate={onCollectionUpdate} />
      )}
    </div>
  );
}

function GiftNftPanel({
  collection,
  onCollectionUpdate,
}: {
  collection: Collection;
  onCollectionUpdate: (collection: Collection) => void;
}) {
  const { publicKey, connect, signMintTx } = useWallet();
  const unsold = useMemo(() => giftableTokens(collection), [collection]);
  const [tokenId, setTokenId] = useState(String(unsold[0]?.tokenId ?? ""));
  const [recipient, setRecipient] = useState("");
  const [busy, setBusy] = useState(false);
  const [message, setMessage] = useState<string | null>(null);

  useEffect(() => {
    if (!unsold.some((t) => String(t.tokenId) === tokenId)) {
      setTokenId(String(unsold[0]?.tokenId ?? ""));
    }
  }, [unsold, tokenId]);

  async function sendGift() {
    if (!publicKey) {
      await connect();
      return;
    }
    const recipientAddr = recipient.trim();
    const id = Number(tokenId);
    if (!looksLikeSolanaAddress(recipientAddr)) {
      setMessage("Enter a valid Solana wallet address.");
      return;
    }
    if (!Number.isFinite(id) || id <= 0) {
      setMessage("Pick an NFT to gift.");
      return;
    }
    setBusy(true);
    setMessage(null);
    try {
      const headers = {
        "Content-Type": "application/json",
        ...(await buildAuthHeaders(publicKey)),
      };
      const res = await fetch(`/api/collections/${collection.id}`, {
        method: "POST",
        headers,
        body: JSON.stringify({
          action: "creator_gift",
          tokenId: id,
          recipient: recipientAddr,
          network: networkName(),
        }),
      });
      const data = await readJsonResponse<{
        collection?: Collection;
        requiresOnChainMint?: boolean;
        error?: string;
      }>(res);
      if (!res.ok) throw new Error(data.error ?? "Could not gift NFT");
      if (data.collection) onCollectionUpdate(data.collection);

      if (data.requiresOnChainMint) {
        setMessage("Approve the free mint in your wallet (recipient pays nothing)…");
        const txSignature = await signMintTx(collection.id, networkName());
        const confirm = await fetch(`/api/collections/${collection.id}/confirm-mint`, {
          method: "PATCH",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            collectionId: collection.id,
            tokenId: id,
            txSignature,
            network: networkName(),
          }),
        });
        const confirmed = await readJsonResponse<{ collection?: Collection; error?: string }>(confirm);
        if (!confirm.ok) throw new Error(confirmed.error ?? "Could not confirm gift mint");
        if (confirmed.collection) onCollectionUpdate(confirmed.collection);
        setMessage(`Gifted #${id} to ${recipientAddr.slice(0, 4)}…${recipientAddr.slice(-4)}`);
      } else {
        setMessage(`Gifted #${id} to ${recipientAddr.slice(0, 4)}…${recipientAddr.slice(-4)}`);
      }
      setRecipient("");
    } catch (e) {
      setMessage(e instanceof Error ? e.message : "Gift failed");
    } finally {
      setBusy(false);
    }
  }

  if (unsold.length === 0) {
    return (
      <p className="mt-3 text-xs text-white/45">
        Every NFT in this collection is already minted or reserved.
      </p>
    );
  }

  return (
    <div className="mt-4 space-y-3 border-t border-white/10 pt-4">
      <p className="text-xs text-white/50">
        Send an unminted piece to another wallet for free. The recipient pays nothing; you only
        approve the on-chain mint (rent) in your wallet.
      </p>
      <div className="grid gap-2 sm:grid-cols-[minmax(0,1fr)_minmax(0,1.4fr)_auto]">
        <select
          className="input"
          value={tokenId}
          onChange={(e) => setTokenId(e.target.value)}
        >
          {unsold.slice(0, 400).map((token) => (
            <option key={token.tokenId} value={token.tokenId}>
              #{token.tokenId} · {tokenName(collection, token)}
            </option>
          ))}
        </select>
        <input
          className="input"
          placeholder="Recipient wallet"
          value={recipient}
          onChange={(e) => setRecipient(e.target.value)}
        />
        <button
          type="button"
          disabled={busy}
          onClick={() => void sendGift()}
          className="rounded-lg bg-primary px-3 py-2 text-xs font-medium text-white disabled:opacity-50"
        >
          {busy ? "Sending…" : "Send gift"}
        </button>
      </div>
      {message && <p className="text-xs text-white/55">{message}</p>}
    </div>
  );
}
