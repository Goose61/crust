"use client";

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { useSearchParams } from "next/navigation";
import type { Collection, GeneratedToken } from "@/lib/types";
import { useWallet, networkName } from "./WalletProvider";
import { explorerClusterQuery } from "@/lib/solana-config";
import { isGiftBundle } from "@/lib/gift-bundle";
import { formatUsd, filterTokensByTrait, isTokenSold, nftPrice, tokenImageSrc, tokenName, uniqueTraitFilters } from "@/lib/collection-ui";
import { readJsonResponse } from "@/lib/fetch-json";
import { buildAuthHeaders } from "@/lib/wallet-auth-client";
import {
  PRIMARY_PLATFORM_FEE_PERCENT,
  PRIMARY_TRADE_TAX_PERCENT,
  PRIMARY_PLATFORM_TOTAL_PERCENT,
  SECONDARY_PLATFORM_FEE_PERCENT,
} from "@/lib/platform-fees";
import {
  SLICEPAY_ORIGINS,
  buildSlicePayReturnUrl,
  messageInvoiceId,
  messageLooksPaid,
  openSlicePayCheckout,
  parseSlicePayReturnParams,
} from "@/lib/slicepay-client";
import { isPaidStatus } from "@/lib/slicepay-shared";

export function CollectionMint({ initial }: { initial: Collection }) {
  const searchParams = useSearchParams();
  const { publicKey, connect, signMintTx, signAndSendTx } = useWallet();
  const [collection, setCollection] = useState(initial);
  const [selected, setSelected] = useState<GeneratedToken | null>(null);
  const [recipient, setRecipient] = useState("");
  const [checkoutPending, setCheckoutPending] = useState(false);
  const [invoiceId, setInvoiceId] = useState<string | null>(null);
  const [isDemoCheckout, setIsDemoCheckout] = useState(false);
  const [slicePayLive, setSlicePayLive] = useState<boolean | null>(null);
  const [paymentMethod, setPaymentMethod] = useState<"slicepay" | "sol">("slicepay");
  const [checkoutKind, setCheckoutKind] = useState<"primary_mint" | "secondary_buy">("primary_mint");
  const [listPrice, setListPrice] = useState("");
  const [traitFilters, setTraitFilters] = useState<Record<string, string>>({});
  const [message, setMessage] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const pendingTokenRef = useRef<GeneratedToken | null>(null);
  const returnHandledRef = useRef(false);

  const tokens = useMemo(() => {
    const sorted = [...collection.tokens].sort((a, b) => a.tokenId - b.tokenId);
    return filterTokensByTrait(sorted, collection, traitFilters);
  }, [collection, traitFilters]);
  const traitFilterOptions = useMemo(
    () => (collection.traitBrowserEnabled ? uniqueTraitFilters(collection) : []),
    [collection],
  );
  const soldCount = tokens.filter((t) => isTokenSold(t, collection)).length;
  const remaining = Math.max(0, collection.supply - soldCount);
  const fees = collection.fees;
  const socials = collection.socials ?? {};

  const [mintBusy, setMintBusy] = useState(false);

  const pendingOnChainToken = useMemo(() => {
    if (!publicKey) return null;
    return (
      collection.tokens.find(
        (t) =>
          !t.mintTxUrl &&
          (t.reservedBy === publicKey ||
            t.owner === publicKey ||
            (collection.pendingMint?.payer === publicKey &&
              collection.pendingMint?.tokenId === t.tokenId)),
      ) ?? null
    );
  }, [collection, publicKey]);

  const isUnmintedGift =
    Boolean(pendingOnChainToken) &&
    (collection.payments.giftMintEnabled ||
      collection.supply > 1 ||
      Boolean(collection.pendingMint));

  useEffect(() => {
    fetch("/api/slicepay/invoice")
      .then((r) => r.json())
      .then((d) => setSlicePayLive(Boolean(d.configured)))
      .catch(() => setSlicePayLive(false));
  }, []);

  const completeSlicePayFlow = useCallback(
    async (token: GeneratedToken, id: string, kind: "primary_mint" | "secondary_buy") => {
      setBusy(true);
      setMessage("Payment confirmed — completing mint…");
      try {
        if (kind === "secondary_buy") {
          await finalizeSecondaryBuy(token, id);
        } else {
          await finalizeMint(token, isDemoCheckout ? "demo" : "slicepay", undefined, id);
        }
        setCheckoutPending(false);
        window.history.replaceState({}, "", window.location.pathname);
      } catch (e) {
        setMessage(e instanceof Error ? e.message : "Could not complete purchase");
      } finally {
        setBusy(false);
      }
    },
    [isDemoCheckout],
  );

  const pollInvoice = useCallback(
    async (id: string, token: GeneratedToken, kind: "primary_mint" | "secondary_buy") => {
      const res = await fetch(`/api/slicepay/status/${encodeURIComponent(id)}`);
      const data = await res.json();
      if (data.paid || isPaidStatus(data.status)) {
        await completeSlicePayFlow(token, id, kind);
        return true;
      }
      return false;
    },
    [completeSlicePayFlow],
  );

  useEffect(() => {
    if (!invoiceId || !pendingTokenRef.current || !checkoutPending) return;
    const token = pendingTokenRef.current;
    const kind = checkoutKind;
    const interval = setInterval(() => {
      void pollInvoice(invoiceId, token, kind);
    }, 3000);
    return () => clearInterval(interval);
  }, [invoiceId, checkoutPending, checkoutKind, pollInvoice]);

  useEffect(() => {
    const handler = (event: MessageEvent) => {
      if (!SLICEPAY_ORIGINS.some((o) => event.origin.startsWith(o.replace(/\/$/, "")))) return;
      if (!messageLooksPaid(event.data)) return;
      const id = messageInvoiceId(event.data) ?? invoiceId;
      const token = pendingTokenRef.current ?? selected;
      if (!id || !token) return;
      void completeSlicePayFlow(token, id, checkoutKind);
    };
    window.addEventListener("message", handler);
    return () => window.removeEventListener("message", handler);
  }, [invoiceId, selected, checkoutKind, completeSlicePayFlow]);

  useEffect(() => {
    if (returnHandledRef.current) return;
    const { invoiceId: retId, tokenId, status } = parseSlicePayReturnParams(searchParams.toString());
    if (!retId || !searchParams.get("slicepay")) return;
    returnHandledRef.current = true;
    const token =
      tokenId != null
        ? collection.tokens.find((t) => t.tokenId === tokenId) ?? null
        : collection.tokens[0] ?? null;
    if (!token) return;
    setSelected(token);
    setInvoiceId(retId);
    setCheckoutPending(true);
    if (isPaidStatus(status)) {
      void completeSlicePayFlow(token, retId, token.listing ? "secondary_buy" : "primary_mint");
    } else {
      void pollInvoice(retId, token, token.listing ? "secondary_buy" : "primary_mint");
    }
  }, [searchParams, collection.tokens, completeSlicePayFlow, pollInvoice]);

  async function completeOnChainMint(tokenId?: number, snapshot?: Collection) {
    if (!publicKey) {
      await connect();
      return;
    }
    const col = snapshot ?? collection;
    setMintBusy(true);
    setMessage(null);
    try {
      const resolvedTokenId =
        tokenId ??
        col.pendingMint?.tokenId ??
        pendingOnChainToken?.tokenId ??
        col.tokens[0]?.tokenId;

      if (!col.pendingMint || col.pendingMint.tokenId !== resolvedTokenId) {
        const res = await fetch("/api/gift/mint", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            collectionId: col.id,
            tokenId: resolvedTokenId,
            payer: publicKey,
            network: networkName(),
          }),
        });
        const data = await readJsonResponse<{
          txBase64?: string;
          assetAddress?: string;
          collection?: Collection;
          error?: string;
        }>(res);
        if (!res.ok) throw new Error(data.error ?? "Could not build mint transaction");
        if (data.collection) setCollection(data.collection);
      }

      setMessage("Approve the mint in Phantom…");
      const txSignature = await signMintTx(col.id, networkName());

      const confirmEndpoint = isGiftBundle(col)
        ? "/api/gift/mint"
        : `/api/collections/${col.id}/confirm-mint`;

      const confirm = await fetch(confirmEndpoint, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          collectionId: col.id,
          tokenId: resolvedTokenId,
          txSignature,
          network: networkName(),
        }),
      });
      const confirmed = await readJsonResponse<{ collection?: Collection; error?: string }>(confirm);
      if (!confirm.ok) throw new Error(confirmed.error ?? "Could not confirm mint");

      if (confirmed.collection) setCollection(confirmed.collection);
      setMessage("Minted on-chain! Check Phantom or Solana Explorer.");
    } catch (e) {
      setMessage(e instanceof Error ? e.message : "Mint failed");
    } finally {
      setMintBusy(false);
    }
  }

  async function startCheckout(token: GeneratedToken, kind: "primary_mint" | "secondary_buy" = "primary_mint") {
    if (!publicKey) {
      await connect();
      return;
    }
    setBusy(true);
    setMessage(null);
    setInvoiceId(null);
    setIsDemoCheckout(false);
    setCheckoutKind(kind);
    pendingTokenRef.current = token;
    try {
      const amountUsd =
        kind === "secondary_buy" && token.listing
          ? token.listing.priceUsd
          : nftPrice(collection, token);
      const orderPrefix = kind === "secondary_buy" ? `secondary-${collection.id}-` : `mint-${collection.id}-`;
      const inv = await fetch("/api/slicepay/invoice", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          amountUsd,
          orderId: `${orderPrefix}${token.tokenId}-${Date.now()}`,
          description:
            kind === "secondary_buy"
              ? `Secondary: ${tokenName(collection, token)}`
              : tokenName(collection, token),
          redirectUrl: buildSlicePayReturnUrl(collection.slug || collection.id, token.tokenId),
          collectionId: collection.id,
          tokenId: token.tokenId,
          payerWallet: publicKey,
          kind,
        }),
      }).then((r) => r.json());
      if (inv.error) throw new Error(String(inv.error));
      if (inv.invoiceId) setInvoiceId(String(inv.invoiceId));
      if (inv.demo) {
        setIsDemoCheckout(true);
        setMessage("Demo mode — confirm below after reviewing the order.");
        setCheckoutPending(true);
        return;
      }
      if (inv.checkoutUrl) {
        setCheckoutPending(true);
        setMessage("Complete payment in the SlicePay window. This page will update automatically.");
        openSlicePayCheckout(String(inv.checkoutUrl));
      }
    } catch (e) {
      setMessage(e instanceof Error ? e.message : "Checkout failed");
    } finally {
      setBusy(false);
    }
  }

  async function payWithSol(token: GeneratedToken) {
    if (!publicKey) {
      await connect();
      return;
    }
    if (!collection.payments.creatorWallet) {
      setMessage("Creator payout wallet not configured.");
      return;
    }
    setBusy(true);
    setMessage(null);
    try {
      const amountUsd = nftPrice(collection, token);
      const { quote } = await fetch(`/api/quotes?usd=${amountUsd}`).then((r) => r.json()) as {
        quote: { sol: number };
      };
      const { Connection, PublicKey, SystemProgram, Transaction, LAMPORTS_PER_SOL } =
        await import("@solana/web3.js");
      const { getRpcUrl } = await import("@/lib/solana-config");
      const connection = new Connection(getRpcUrl(), "confirmed");
      const { blockhash } = await connection.getLatestBlockhash();
      const tx = new Transaction().add(
        SystemProgram.transfer({
          fromPubkey: new PublicKey(publicKey),
          toPubkey: new PublicKey(collection.payments.creatorWallet),
          lamports: Math.ceil(quote.sol * LAMPORTS_PER_SOL),
        }),
      );
      tx.recentBlockhash = blockhash;
      tx.feePayer = new PublicKey(publicKey);
      const txBase64 = Buffer.from(
        tx.serialize({ requireAllSignatures: false, verifySignatures: false }),
      ).toString("base64");
      setMessage(`Sending ${quote.sol.toFixed(4)} SOL…`);
      const txSignature = await signAndSendTx(txBase64);
      await finalizeMint(token, "sol", txSignature);
    } catch (e) {
      setMessage(e instanceof Error ? e.message : "SOL payment failed");
    } finally {
      setBusy(false);
    }
  }

  async function finalizeMint(
    token: GeneratedToken,
    method: "slicepay" | "sol" | "demo",
    txSignature?: string,
    confirmedInvoiceId?: string,
  ) {
    if (!publicKey) return;
    const res = await fetch(`/api/collections/${collection.id}`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        action: "mint",
        payer: publicKey,
        recipient: collection.payments.giftMintEnabled && recipient ? recipient : publicKey,
        qty: 1,
        tokenId: token.tokenId,
        method,
        invoiceId: method === "slicepay" ? (confirmedInvoiceId ?? invoiceId) : undefined,
        txSignature: method === "sol" ? txSignature : undefined,
        network: networkName(),
      }),
    });
    const data = await res.json();
    if (!res.ok) throw new Error(data.error);
    setCollection(data.collection);
    if (data.requiresOnChainMint) {
      setMessage(`Paid — approve the on-chain mint in Phantom for #${token.tokenId}…`);
      await completeOnChainMint(token.tokenId, data.collection);
    } else {
      const feeNote =
        Array.isArray(data.feeBreakdowns) && data.feeBreakdowns.length > 0
          ? ` · Holder pool +${formatUsd(
              data.feeBreakdowns.reduce(
                (sum: number, b: { holdersUsd: number }) => sum + b.holdersUsd,
                0,
              ),
            )}`
          : "";
      setMessage(`Minted #${data.mintedTokenIds.join(", ")} → ${data.recipient}${feeNote}`);
    }
    setCheckoutPending(false);
    setInvoiceId(null);
    setSelected(null);
  }

  async function finalizeSecondaryBuy(token: GeneratedToken, confirmedInvoiceId?: string) {
    if (!publicKey) return;
    const res = await fetch(`/api/collections/${collection.id}`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        action: "buy_secondary",
        payer: publicKey,
        tokenId: token.tokenId,
        method: isDemoCheckout ? "demo" : "slicepay",
        invoiceId: confirmedInvoiceId ?? invoiceId,
      }),
    });
    const data = await res.json();
    if (!res.ok) throw new Error(data.error);
    setCollection(data.collection);
    const feeNote = data.feeBreakdown
      ? ` · Royalties: holder +${formatUsd(data.feeBreakdown.holdersUsd)}, buyback +${formatUsd(data.feeBreakdown.buybackUsd)}`
      : "";
    setMessage(`Purchased #${token.tokenId}${feeNote}`);
    setCheckoutPending(false);
    setInvoiceId(null);
    setSelected(null);
  }

  async function listForSale(token: GeneratedToken) {
    if (!publicKey) {
      await connect();
      return;
    }
    const priceUsd = Number(listPrice);
    if (!priceUsd || priceUsd <= 0) {
      setMessage("Enter a valid list price.");
      return;
    }
    setBusy(true);
    try {
      const headers = {
        "Content-Type": "application/json",
        ...(await buildAuthHeaders(publicKey)),
      };
      const res = await fetch(`/api/collections/${collection.id}`, {
        method: "POST",
        headers,
        body: JSON.stringify({ action: "list_secondary", tokenId: token.tokenId, priceUsd }),
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error);
      setCollection(data.collection);
      setMessage(`#${token.tokenId} listed at ${formatUsd(priceUsd)}`);
    } catch (e) {
      setMessage(e instanceof Error ? e.message : "Listing failed");
    } finally {
      setBusy(false);
    }
  }

  async function unlist(token: GeneratedToken) {
    if (!publicKey) return;
    setBusy(true);
    try {
      const headers = {
        "Content-Type": "application/json",
        ...(await buildAuthHeaders(publicKey)),
      };
      const res = await fetch(`/api/collections/${collection.id}`, {
        method: "POST",
        headers,
        body: JSON.stringify({ action: "unlist_secondary", tokenId: token.tokenId }),
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error);
      setCollection(data.collection);
      setMessage(`#${token.tokenId} unlisted`);
    } catch (e) {
      setMessage(e instanceof Error ? e.message : "Unlist failed");
    } finally {
      setBusy(false);
    }
  }

  async function confirmMint(token: GeneratedToken) {
    if (!publicKey) {
      await connect();
      return;
    }
    setBusy(true);
    setMessage(null);
    try {
      if (checkoutKind === "secondary_buy") {
        await finalizeSecondaryBuy(token);
      } else {
        await finalizeMint(token, isDemoCheckout ? "demo" : "slicepay");
      }
    } catch (e) {
      setMessage(e instanceof Error ? e.message : "Mint failed");
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="container mx-auto max-w-6xl px-4 py-10">
      {/* Collection identity header */}
      <div className="mb-8 flex items-center gap-4">
        {collection.logoUrl ? (
          // eslint-disable-next-line @next/next/no-img-element
          <img src={collection.logoUrl} alt={collection.name}
            className="h-16 w-16 rounded-2xl border border-white/15 object-cover" />
        ) : (
          <div className="flex h-16 w-16 items-center justify-center rounded-2xl border border-white/15 bg-white/5 text-2xl font-bold text-white/30">
            {collection.name.slice(0, 2).toUpperCase()}
          </div>
        )}
        <div>
          <p className="font-[family-name:var(--font-mono)] text-[11px] tracking-[0.22em] text-white/40">
            {collection.chain.toUpperCase()} · {collection.symbol}
          </p>
          <h1 className="text-3xl font-bold text-white">{collection.name}</h1>
        </div>
      </div>

      {isUnmintedGift && pendingOnChainToken && (
        <div className="mb-6 rounded-lg border border-amber-500/40 bg-amber-500/10 px-4 py-3 flex flex-col gap-2 sm:flex-row sm:items-center sm:justify-between">
          <div>
            <p className="text-sm font-medium text-amber-200">
              #{pendingOnChainToken.tokenId} paid — on-chain mint pending
            </p>
            <p className="text-xs text-amber-200/70 mt-0.5">
              Metadata is stored permanently, but the Solana NFT still needs to be minted.
              Connect Phantom as the payer and approve the transaction (~0.002 SOL rent + fees).
            </p>
          </div>
          <button
            type="button"
            onClick={() => void completeOnChainMint(pendingOnChainToken.tokenId)}
            disabled={mintBusy}
            className="shrink-0 rounded-full bg-primary px-5 py-2 text-sm font-medium text-white hover:bg-primary/80 disabled:opacity-50"
          >
            {mintBusy ? "Minting…" : publicKey ? "Mint on-chain now" : "Connect & mint"}
          </button>
        </div>
      )}

      {collection.blindMint && !collection.revealed && (
        <div className="mb-6 rounded-lg border border-white/15 bg-white/5 px-4 py-3 text-sm text-white/60">
          Blind mint active — art reveals when the collection hits its reveal trigger or the creator reveals manually.
        </div>
      )}

      {slicePayLive === false && (
        <div className="mb-4 rounded-lg border border-amber-500/30 bg-amber-500/10 px-4 py-2 text-xs text-amber-100/90">
          SlicePay is in demo mode — add SLICEPAY_MERCHANT_ID and SLICEPAY_API_KEY to accept real payments.
        </div>
      )}

      {message && (
        <p className="mb-4 text-sm text-white/60">{message}</p>
      )}

      <div className="grid gap-8 lg:grid-cols-[1.1fr_0.9fr]">
        <div>
          <p className="font-[family-name:var(--font-mono)] text-[11px] tracking-[0.22em] text-white/40">
            {collection.chain.toUpperCase()} · {collection.symbol}
          </p>
          <h2 className="mt-2 text-4xl font-bold text-white">{collection.name}</h2>
          <p className="mt-4 max-w-xl font-[family-name:var(--font-body)] text-sm leading-6 text-white/60">
            {collection.description}
          </p>

          <div className="mt-6 flex flex-wrap gap-2">
            {socials.twitter && <SocialChip href={socials.twitter} label="X" />}
            {socials.discord && <SocialChip href={socials.discord} label="Discord" />}
            {socials.telegram && <SocialChip href={socials.telegram} label="Telegram" />}
            {socials.website && <SocialChip href={socials.website} label="Website" />}
          </div>

          <dl className="mt-8 grid grid-cols-3 gap-3">
            <Stat label="Price from" value={formatUsd(collection.payments.basePriceUsd)} />
            <Stat label="Available" value={String(remaining)} />
            <Stat label="Sold" value={String(soldCount)} />
          </dl>
        </div>

        <div className="tile p-5">
          <h2 className="text-2xl">Fee structure</h2>
          <p className="mt-2 font-[family-name:var(--font-body)] text-sm text-white/50">
            Creator split locks at launch. Crypgo marketplace fees are fixed and deducted before your split.
          </p>
          <div className="mt-5 flex h-3 overflow-hidden border border-white/15">
            <div className="bg-primary" style={{ width: `${fees.ownerPercent}%` }} />
            <div className="bg-white" style={{ width: `${fees.holdersPercent}%` }} />
            <div className="bg-[#f5c542]" style={{ width: `${fees.buybackPercent}%` }} />
          </div>
          <ul className="mt-4 space-y-3 font-[family-name:var(--font-body)] text-sm">
            <FeeRow color="bg-primary" label="Creator" percent={fees.ownerPercent} note="Your share after marketplace fees" />
            <FeeRow color="bg-white" label="Holders" percent={fees.holdersPercent} note="Shared with current holders" />
            <FeeRow color="bg-[#f5c542]" label="Buyback" percent={fees.buybackPercent} note="Treasury buybacks" />
          </ul>
          <div className="mt-4 rounded border border-white/10 bg-white/5 px-3 py-2 text-xs text-white/50">
            <p className="font-medium text-white/70">Crypgo marketplace (fixed)</p>
            <p className="mt-1">Primary: {PRIMARY_PLATFORM_FEE_PERCENT}% + {PRIMARY_TRADE_TAX_PERCENT}% trade tax ({PRIMARY_PLATFORM_TOTAL_PERCENT}% total)</p>
            <p>Secondary: {SECONDARY_PLATFORM_FEE_PERCENT}%</p>
          </div>
        </div>
      </div>

      <section className="mt-12">
        <div className="mb-5 flex items-end justify-between gap-4 flex-wrap">
          <h2 className="text-4xl">The collection</h2>
          <p className="font-[family-name:var(--font-mono)] text-xs text-white/50">
            {remaining} for sale · {soldCount} sold
          </p>
        </div>

        {collection.traitBrowserEnabled && traitFilterOptions.length > 0 && (
          <div className="mb-4 flex flex-wrap gap-2">
            {traitFilterOptions.map(({ traitType, values }) => (
              <label key={traitType} className="text-xs text-white/60">
                {traitType}
                <select
                  className="ml-1 rounded border border-white/15 bg-white/5 px-2 py-1 text-white"
                  value={traitFilters[traitType] ?? ""}
                  onChange={(e) =>
                    setTraitFilters((prev) => {
                      const next = { ...prev };
                      if (e.target.value) next[traitType] = e.target.value;
                      else delete next[traitType];
                      return next;
                    })
                  }
                >
                  <option value="">All</option>
                  {values.map((v) => (
                    <option key={v} value={v}>{v}</option>
                  ))}
                </select>
              </label>
            ))}
          </div>
        )}

        <div className="grid grid-cols-2 gap-3 sm:grid-cols-3 md:grid-cols-4 lg:grid-cols-5">
          {tokens.map((token) => {
            const sold = isTokenSold(token, collection);
            const listed = Boolean(token.listing);
            const priceLabel = listed
              ? formatUsd(token.listing!.priceUsd)
              : sold
                ? "SOLD"
                : formatUsd(nftPrice(collection, token));
            return (
              <button
                key={token.tokenId}
                type="button"
                onClick={() => {
                  setSelected(token);
                  setCheckoutPending(false);
                  setInvoiceId(null);
                  setMessage(null);
                }}
                className="tile text-left"
              >
                <div className="relative aspect-square">
                  {/* eslint-disable-next-line @next/next/no-img-element */}
                  <img
                    src={tokenImageSrc(collection, token)}
                    alt={tokenName(collection, token)}
                    className={`h-full w-full object-cover ${sold ? "grayscale" : ""}`}
                  />
                  <span
                    className={`absolute left-2 top-2 px-1.5 py-0.5 font-[family-name:var(--font-mono)] text-[10px] ${
                      sold ? "bg-white text-black" : "bg-primary text-white"
                    }`}
                  >
                    {priceLabel}
                  </span>
                </div>
                <div className="border-t border-white/15 px-2 py-2">
                  <div className="font-[family-name:var(--font-body)] text-xs font-medium">
                    #{token.tokenId}
                  </div>
                </div>
              </button>
            );
          })}
        </div>
      </section>

      {selected && (
        <div
          className="fixed inset-0 z-50 flex items-center justify-center bg-black/60 p-4"
          onClick={() => setSelected(null)}
        >
          <div
            className="tile max-h-[90vh] w-full max-w-3xl overflow-y-auto"
            onClick={(e) => e.stopPropagation()}
          >
            <div className="grid md:grid-cols-2">
              {/* eslint-disable-next-line @next/next/no-img-element */}
              <img
                src={tokenImageSrc(collection, selected)}
                alt={tokenName(collection, selected)}
                className="aspect-square w-full object-cover"
              />
              <div className="p-5">
                <div className="flex items-start justify-between gap-3">
                  <div>
                    <p className="font-[family-name:var(--font-mono)] text-[11px] text-white/40">
                      {isTokenSold(selected, collection) ? "SOLD" : "AVAILABLE"}
                    </p>
                    <h3 className="mt-1 text-3xl font-bold text-white">{tokenName(collection, selected)}</h3>
                  </div>
                  <button onClick={() => setSelected(null)} className="text-sm text-white/50">
                    Close
                  </button>
                </div>
                <p className="mt-3 text-lg font-semibold text-white">{formatUsd(nftPrice(collection, selected))}</p>
                <dl className="mt-4 grid grid-cols-2 gap-2">
                  {selected.attributes
                    .filter((a) => a.trait_type !== "Rarity Rank")
                    .map((a) => {
                      const traitP = collection.traitPricing?.[a.trait_type]?.[String(a.value)];
                      return (
                        <div key={a.trait_type} className="border border-white/10 p-2">
                          <dt className="font-[family-name:var(--font-mono)] text-[10px] tracking-[0.12em] text-white/40">
                            {a.trait_type.toUpperCase()}
                          </dt>
                          <dd className="mt-1 flex items-center justify-between gap-2 text-sm text-white">
                            <span>{String(a.value)}</span>
                            {traitP && (
                              <span className={`rounded-full px-1.5 py-0.5 text-[10px] capitalize ${
                                traitP.rarity === "epic"   ? "bg-primary/20 text-primary" :
                                traitP.rarity === "rare"   ? "bg-[#f5c542]/20 text-[#f5c542]" :
                                                             "bg-white/10 text-white/40"
                              }`}>
                                {traitP.rarity}{traitP.priceModifier > 0 ? ` +${formatUsd(traitP.priceModifier)}` : ""}
                              </span>
                            )}
                          </dd>
                        </div>
                      );
                    })}
                </dl>

                {isTokenSold(selected, collection) && (
                  <div className="mt-4 space-y-2 rounded border border-white/10 bg-white/5 px-3 py-3 text-xs">
                    {selected.owner && (
                      <div>
                        <p className="text-white/40 uppercase tracking-wider text-[10px]">Owner wallet</p>
                        <p className="mt-0.5 font-mono text-white break-all">{selected.owner}</p>
                        <p className="mt-1 text-white/40">
                          The NFT was sent to this address — check this wallet in Phantom.
                        </p>
                      </div>
                    )}
                    {selected.assetAddress && (
                      <a
                        href={`https://explorer.solana.com/address/${selected.assetAddress}${explorerClusterQuery()}`}
                        target="_blank"
                        rel="noopener noreferrer"
                        className="block text-primary hover:underline"
                      >
                        View asset on Solana Explorer ↗
                      </a>
                    )}
                    {selected.mintTxUrl && (
                      <a
                        href={selected.mintTxUrl}
                        target="_blank"
                        rel="noopener noreferrer"
                        className="block text-primary hover:underline"
                      >
                        View mint transaction ↗
                      </a>
                    )}
                  </div>
                )}

                <p className="mt-3 text-lg font-semibold text-white">
                  {selected.listing
                    ? formatUsd(selected.listing.priceUsd)
                    : formatUsd(nftPrice(collection, selected))}
                </p>

                {/* Secondary: buy listed token */}
                {collection.secondaryEnabled && selected.listing && selected.owner !== publicKey && (
                  <div className="mt-5 space-y-3">
                    <p className="text-xs text-white/50">Secondary listing</p>
                    {checkoutPending ? (
                      <>
                        <p className="text-sm text-white/60">
                          Waiting for SlicePay… this page updates automatically when payment completes.
                        </p>
                        {(isDemoCheckout || !slicePayLive) && (
                          <button
                            disabled={busy}
                            onClick={() => void confirmMint(selected)}
                            className="w-full border border-white/15 py-3 text-sm font-medium disabled:opacity-40"
                          >
                            {busy ? "Confirming…" : "Confirm purchase (demo)"}
                          </button>
                        )}
                      </>
                    ) : (
                      <button
                        disabled={busy || !collection.payments.acceptSlicePay}
                        onClick={() => void startCheckout(selected, "secondary_buy")}
                        className="w-full bg-primary py-3 text-sm font-medium text-white disabled:opacity-40"
                      >
                        {busy ? "Opening SlicePay…" : `Buy for ${formatUsd(selected.listing.priceUsd)}`}
                      </button>
                    )}
                  </div>
                )}

                {/* Secondary: owner list / unlist */}
                {collection.secondaryEnabled &&
                  isTokenSold(selected, collection) &&
                  selected.owner === publicKey && (
                  <div className="mt-5 space-y-3 border-t border-white/10 pt-4">
                    <p className="text-xs text-white/50">Your NFT — secondary market</p>
                    {selected.listing ? (
                      <>
                        <p className="text-sm text-white">Listed at {formatUsd(selected.listing.priceUsd)}</p>
                        <button
                          disabled={busy}
                          onClick={() => void unlist(selected)}
                          className="w-full border border-white/15 py-2 text-sm"
                        >
                          Remove listing
                        </button>
                      </>
                    ) : (
                      <>
                        <input
                          className="input"
                          type="number"
                          min={0}
                          step={0.01}
                          placeholder="List price (USD)"
                          value={listPrice}
                          onChange={(e) => setListPrice(e.target.value)}
                        />
                        <button
                          disabled={busy}
                          onClick={() => void listForSale(selected)}
                          className="w-full bg-white/10 py-2 text-sm text-white hover:bg-white/15"
                        >
                          List for sale
                        </button>
                      </>
                    )}
                  </div>
                )}

                {!isTokenSold(selected, collection) && collection.status === "live" && (
                  <div className="mt-5 space-y-3">
                    {collection.payments.giftMintEnabled && (
                      <input
                        className="input"
                        placeholder="Gift to wallet (optional)"
                        value={recipient}
                        onChange={(e) => setRecipient(e.target.value)}
                      />
                    )}

                    {(collection.payments.acceptSlicePay ||
                      collection.payments.acceptSol ||
                      collection.payments.acceptUsdc) && (
                      <div className="flex gap-2 text-xs">
                        {collection.payments.acceptSlicePay && (
                          <button
                            type="button"
                            onClick={() => setPaymentMethod("slicepay")}
                            className={`rounded-full px-3 py-1 ${paymentMethod === "slicepay" ? "bg-primary text-white" : "bg-white/10 text-white/60"}`}
                          >
                            SlicePay (card / USDC)
                          </button>
                        )}
                        {collection.payments.acceptSol && (
                          <button
                            type="button"
                            onClick={() => setPaymentMethod("sol")}
                            className={`rounded-full px-3 py-1 ${paymentMethod === "sol" ? "bg-primary text-white" : "bg-white/10 text-white/60"}`}
                          >
                            SOL
                          </button>
                        )}
                      </div>
                    )}

                    {paymentMethod === "sol" && collection.payments.acceptSol ? (
                      <button
                        disabled={busy}
                        onClick={() => void payWithSol(selected)}
                        className="w-full bg-primary py-3 text-sm font-medium text-primary-foreground disabled:opacity-40"
                      >
                        {busy ? "Processing…" : publicKey ? `Pay ${formatUsd(nftPrice(collection, selected))} in SOL` : "Connect wallet"}
                      </button>
                    ) : checkoutPending ? (
                      <>
                        <p className="text-sm text-white/60">
                          Waiting for SlicePay… complete payment in the popup window.
                        </p>
                        {(isDemoCheckout || slicePayLive === false) && (
                          <button
                            disabled={busy}
                            onClick={() => void confirmMint(selected)}
                            className="w-full border border-white/15 py-3 text-sm font-medium disabled:opacity-40"
                          >
                            {busy ? "Confirming…" : "Confirm mint (demo)"}
                          </button>
                        )}
                      </>
                    ) : (
                      <button
                        disabled={busy || !collection.payments.acceptSlicePay}
                        onClick={() => void startCheckout(selected, "primary_mint")}
                        className="w-full bg-primary py-3 text-sm font-medium text-primary-foreground disabled:opacity-40"
                      >
                        {busy ? "Opening SlicePay…" : publicKey ? "Pay with SlicePay" : "Connect wallet"}
                      </button>
                    )}
                  </div>
                )}
                {message && <p className="mt-3 text-sm text-white/50">{message}</p>}
              </div>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}

function SocialChip({ href, label }: { href: string; label: string }) {
  return (
    <a
      href={href}
      target="_blank"
      rel="noreferrer"
      className="border border-white/15 px-3 py-1 font-[family-name:var(--font-body)] text-xs hover:border-primary hover:text-primary"
    >
      {label}
    </a>
  );
}

function Stat({ label, value }: { label: string; value: string }) {
  return (
    <div className="tile p-3">
      <dt className="font-[family-name:var(--font-mono)] text-[10px] tracking-[0.14em] text-white/50">
        {label.toUpperCase()}
      </dt>
      <dd className="mt-1 text-xl">{value}</dd>
    </div>
  );
}

function FeeRow({
  color,
  label,
  percent,
  note,
}: {
  color: string;
  label: string;
  percent: number;
  note: string;
}) {
  return (
    <li className="flex items-start gap-3">
      <span className={`mt-1 h-3 w-3 shrink-0 ${color}`} />
      <span>
        <span className="font-medium">
          {label} · {percent}%
        </span>
        <span className="block text-xs text-white/50">{note}</span>
      </span>
    </li>
  );
}
