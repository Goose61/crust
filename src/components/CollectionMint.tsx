"use client";

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { useSearchParams } from "next/navigation";
import type { Collection, GeneratedToken } from "@/lib/types";
import { useWallet, networkName } from "./WalletProvider";
import { explorerClusterQuery } from "@/lib/solana-config";
import { isGiftBundle } from "@/lib/gift-bundle";
import { formatUsd, formatUsdAmount, formatUsdAndSol, formatSol, usdToSol, filterTokensByTrait, filterTokensByStatus, filterTokensBySearch, filterTokensByRarity, sortTokens, isTokenSold, nftPrice, tokenAskPrice, tokenImageSrc, tokenName, uniqueTraitFilters, logoImageSrc, COLLECTION_GRID_PAGE_SIZE, type TokenSort, type TokenStatusFilter, type OverallRarityFilter } from "@/lib/collection-ui";
import { OVERALL_RARITY_CLASS, OVERALL_RARITY_LABEL, OVERALL_RARITY_ORDER, rarityRankByTokenId, tokenOverallRarity, tokenRarityRank } from "@/lib/rarity";
import { collectionMarketStats } from "@/lib/collection-stats";
import { CollectionSocialLinks } from "@/components/CollectionSocialLinks";
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
  const [statusFilter, setStatusFilter] = useState<TokenStatusFilter>("all");
  const [sort, setSort] = useState<TokenSort>("id_asc");
  const [search, setSearch] = useState("");
  const [rarityFilter, setRarityFilter] = useState<OverallRarityFilter>("all");
  const [solUsd, setSolUsd] = useState<number | null>(null);
  const [visibleCount, setVisibleCount] = useState(COLLECTION_GRID_PAGE_SIZE);
  const [message, setMessage] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const pendingTokenRef = useRef<GeneratedToken | null>(null);
  const returnHandledRef = useRef(false);

  const rarityRanks = useMemo(
    () => rarityRankByTokenId(collection.tokens),
    [collection.tokens],
  );
  const tokens = useMemo(() => {
    const searched = filterTokensBySearch(collection.tokens, collection, search);
    const byStatus = filterTokensByStatus(searched, collection, statusFilter);
    const byRarity = filterTokensByRarity(byStatus, collection, rarityFilter, rarityRanks);
    const byTrait = filterTokensByTrait(byRarity, collection, traitFilters);
    return sortTokens(byTrait, collection, sort, rarityRanks);
  }, [collection, traitFilters, statusFilter, sort, search, rarityFilter, rarityRanks]);
  const traitFilterOptions = useMemo(
    () => uniqueTraitFilters(collection),
    [collection],
  );
  const stats = useMemo(() => collectionMarketStats(collection), [collection]);
  const soldCount = stats.sold;
  const remaining = stats.available;
  const visibleTokens = tokens.slice(0, visibleCount);
  const logoSrc = logoImageSrc(collection);
  const fees = collection.fees;
  const socials = collection.socials ?? {};

  const [mintBusy, setMintBusy] = useState(false);

  useEffect(() => {
    setVisibleCount(COLLECTION_GRID_PAGE_SIZE);
  }, [search, statusFilter, sort, traitFilters, rarityFilter]);

  useEffect(() => {
    let cancelled = false;
    void fetch("/api/quotes?usd=1")
      .then((r) => r.json())
      .then((data: { quote?: { solUsd?: number } }) => {
        if (!cancelled && data.quote?.solUsd) setSolUsd(data.quote.solUsd);
      })
      .catch(() => {});
    return () => {
      cancelled = true;
    };
  }, []);

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
      if (!SLICEPAY_ORIGINS.includes(event.origin)) return;
      if (!messageLooksPaid(event.data)) return;
      const rec = event.data && typeof event.data === "object" ? (event.data as Record<string, unknown>) : {};
      const id = messageInvoiceId(event.data) ?? (rec.invoiceId != null ? String(rec.invoiceId) : null) ?? invoiceId;
      const token = pendingTokenRef.current ?? selected;
      if (!id || !token) return;
      setInvoiceId(id);
      void completeSlicePayFlow(token, id, checkoutKind);
    };
    window.addEventListener("message", handler);
    return () => window.removeEventListener("message", handler);
  }, [invoiceId, selected, checkoutKind, completeSlicePayFlow]);

  useEffect(() => {
    if (returnHandledRef.current) return;
    const { invoiceId: retId, tokenId, status } = parseSlicePayReturnParams(searchParams.toString());
    if (!retId) return;
    if (!searchParams.get("slicepay") && !isPaidStatus(status) && !searchParams.get("invoiceId")) return;
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

      setMessage("Approve the mint in your wallet…");
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
        setMessage("Minted on-chain! Check your wallet or Solana Explorer.");
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
      } else {
        throw new Error("SlicePay did not return a checkout URL");
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
    <div className="relative overflow-hidden">
      <div
        aria-hidden
        className="pointer-events-none absolute inset-x-0 top-0 h-[26rem] bg-[radial-gradient(ellipse_at_top,rgba(226,60,47,0.14),transparent_58%)]"
      />
    <div className="container relative mx-auto max-w-6xl px-4 py-6 sm:py-10">
      {isUnmintedGift && pendingOnChainToken && (
        <div className="mb-6 rounded-lg border border-amber-500/40 bg-amber-500/10 px-4 py-3 flex flex-col gap-2 sm:flex-row sm:items-center sm:justify-between">
          <div>
            <p className="text-sm font-medium text-amber-200">
              #{pendingOnChainToken.tokenId} paid — on-chain mint pending
            </p>
            <p className="text-xs text-amber-200/70 mt-0.5">
              Metadata is stored permanently, but the Solana NFT still needs to be minted.
            Connect your wallet as the payer and approve the transaction (~0.002 SOL rent + fees).
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
          SlicePay checkout is not live — check the merchant ID on the server.
        </div>
      )}

      {message && (
        <p className="mb-4 text-sm text-white/60">{message}</p>
      )}

      <div className="overflow-hidden rounded-3xl border border-white/12 bg-card">
        <div className="grid gap-0 lg:grid-cols-[1.15fr_0.85fr]">
        <div className="p-4 sm:p-8">
          <div className="flex flex-col items-center gap-4 text-center sm:flex-row sm:items-start sm:gap-5 sm:text-left">
            <div className="collection-logo-frame mb-0 h-28 w-28 shrink-0 rounded-2xl p-1.5 sm:h-32 sm:w-32">
              {logoSrc ? (
                // eslint-disable-next-line @next/next/no-img-element
                <img
                  src={logoSrc}
                  alt={collection.name}
                  className="collection-logo"
                />
              ) : (
                <div className="flex h-full w-full items-center justify-center text-2xl font-bold text-white/30">
                  {collection.name.slice(0, 2).toUpperCase()}
                </div>
              )}
            </div>
            <div className="min-w-0">
              <p className="font-[family-name:var(--font-mono)] text-[11px] tracking-[0.22em] text-white/40">
                {collection.chain.toUpperCase()} · {collection.symbol}
              </p>
              <h1 className="mt-2 break-words text-3xl font-bold tracking-tight text-white sm:text-5xl">{collection.name}</h1>
              <div className="mt-4">
                <CollectionSocialLinks socials={socials} />
              </div>
            </div>
          </div>
          <p className="mt-5 max-w-xl font-[family-name:var(--font-body)] text-sm leading-6 text-white/60">
            {collection.description}
          </p>

          <dl className="mt-8 grid grid-cols-2 gap-3 sm:grid-cols-3">
            <Stat label="Floor" value={formatUsdAndSol(stats.floorUsd, solUsd)} tip="Lowest listing, or cheapest remaining mint price" />
            <Stat label="Volume" value={formatUsdAmount(stats.volumeUsd)} tip="All-time primary + secondary sales" />
            <Stat label="Market cap" value={formatUsdAmount(stats.marketCapUsd)} tip="Floor × total supply" />
            <Stat label="Price from" value={formatUsdAndSol(collection.payments.basePriceUsd, solUsd)} />
            <Stat label="Available" value={String(remaining)} />
            <Stat label="Sold" value={String(soldCount)} />
          </dl>
        </div>

        <div className="border-t border-white/10 p-4 sm:p-8 lg:border-l lg:border-t-0">
          <h2 className="text-2xl">Fee structure</h2>
          <p className="mt-2 font-[family-name:var(--font-body)] text-sm text-white/50">
            Creator split locks at launch. Ginger marketplace fees are fixed and deducted before your split.
          </p>
          <div className="mt-5 flex h-3 overflow-hidden rounded-full border border-white/15">
            <div className="bg-primary" style={{ width: `${fees.ownerPercent}%` }} />
            <div className="bg-white" style={{ width: `${fees.holdersPercent}%` }} />
            <div className="bg-[#f5c542]" style={{ width: `${fees.buybackPercent}%` }} />
          </div>
          <ul className="mt-4 space-y-3 font-[family-name:var(--font-body)] text-sm">
            <FeeRow color="bg-primary" label="Creator" percent={fees.ownerPercent} note="Your share after marketplace fees" />
            <FeeRow color="bg-white" label="Holders" percent={fees.holdersPercent} note="Shared with current holders" />
            <FeeRow color="bg-[#f5c542]" label="Buyback" percent={fees.buybackPercent} note="Treasury buybacks" />
          </ul>
          <div className="mt-4 rounded-xl border border-white/10 bg-white/5 px-3 py-2 text-xs text-white/50">
            <p className="font-medium text-white/70">Ginger marketplace (fixed)</p>
            <p className="mt-1">Primary: {PRIMARY_PLATFORM_FEE_PERCENT}% + {PRIMARY_TRADE_TAX_PERCENT}% trade tax ({PRIMARY_PLATFORM_TOTAL_PERCENT}% total)</p>
            <p>Secondary: {SECONDARY_PLATFORM_FEE_PERCENT}%</p>
          </div>
        </div>
        </div>
      </div>

      <section className="mt-12">
        <div className="mb-5 flex flex-col items-start justify-between gap-3 sm:flex-row sm:flex-wrap sm:items-end">
          <h2 className="text-3xl sm:text-4xl">The collection</h2>
          <p className="font-[family-name:var(--font-mono)] text-xs text-white/50">
            {tokens.length} shown · {remaining} for sale · {soldCount} sold
          </p>
        </div>

        <div className="sticky top-[calc(var(--nav-h)+10px)] z-20 mb-5 rounded-2xl border border-white/10 bg-background/85 p-3 backdrop-blur-md">
          <div className="flex flex-col gap-3 lg:flex-row lg:items-center">
            <input
              className="input lg:max-w-xs"
              placeholder="Search # or name"
              value={search}
              onChange={(e) => setSearch(e.target.value)}
            />
            <div className="flex flex-wrap gap-1.5">
              {(["all", "for_sale", "sold", "listed"] as const).map((value) => (
                <button
                  key={value}
                  type="button"
                  onClick={() => setStatusFilter(value)}
                  className={`rounded-full px-3 py-1.5 text-xs capitalize transition ${
                    statusFilter === value
                      ? "bg-primary text-white"
                      : "border border-white/12 bg-white/5 text-white/60 hover:text-white"
                  }`}
                >
                  {value === "for_sale" ? "For sale" : value}
                </button>
              ))}
            </div>
            <label className="flex w-full items-center gap-2 text-xs text-white/50 sm:w-auto">
              Rarity
              <select
                className="min-w-0 flex-1 rounded-lg border border-white/12 bg-white/5 px-2 py-1.5 text-white sm:flex-none"
                value={rarityFilter}
                onChange={(e) => setRarityFilter(e.target.value as OverallRarityFilter)}
              >
                <option value="all">All rarities</option>
                {OVERALL_RARITY_ORDER.map((value) => (
                  <option key={value} value={value}>
                    {OVERALL_RARITY_LABEL[value]}
                  </option>
                ))}
              </select>
            </label>
            <label className="flex w-full items-center gap-2 text-xs text-white/50 sm:ml-auto sm:w-auto">
              Sort
              <select
                className="min-w-0 flex-1 rounded-lg border border-white/12 bg-white/5 px-2 py-1.5 text-white sm:flex-none"
                value={sort}
                onChange={(e) => setSort(e.target.value as TokenSort)}
              >
                <option value="id_asc">Token ID</option>
                <option value="price_asc">Price: low to high</option>
                <option value="price_desc">Price: high to low</option>
                <option value="rarity_asc">Rarity: rarest first</option>
                <option value="rarity_desc">Rarity: most common first</option>
              </select>
            </label>
          </div>
          {traitFilterOptions.length > 0 && (
            <div className="mt-3 flex flex-wrap gap-2 border-t border-white/8 pt-3">
              {traitFilterOptions.map(({ traitType, values }) => (
                <label key={traitType} className="text-xs text-white/60">
                  {traitType}
                  <select
                    className="ml-1 rounded-lg border border-white/12 bg-white/5 px-2 py-1 text-white"
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
        </div>

        {tokens.length === 0 ? (
          <p className="rounded-2xl border border-white/10 bg-white/5 px-4 py-8 text-center text-sm text-white/50">
            No NFTs match those filters.
          </p>
        ) : (
          <>
        <div className="grid grid-cols-2 gap-2.5 sm:grid-cols-3 sm:gap-3 md:grid-cols-4 lg:grid-cols-5">
          {visibleTokens.map((token, index) => {
            const sold = isTokenSold(token, collection);
            const listed = Boolean(token.listing);
            const priceUsd = tokenAskPrice(collection, token);
            const rarity = tokenOverallRarity(
              token,
              collection.supply || collection.tokens.length,
              rarityRanks,
            );
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
                className="nft-card group text-left"
              >
                <div className="relative aspect-square overflow-hidden">
                  {/* eslint-disable-next-line @next/next/no-img-element */}
                  <img
                    src={tokenImageSrc(collection, token)}
                    alt={tokenName(collection, token)}
                    loading={index < 8 ? "eager" : "lazy"}
                    decoding="async"
                    className={`h-full w-full object-cover transition duration-500 ${sold ? "grayscale" : "group-hover:scale-[1.04]"}`}
                  />
                  <span
                    className={`absolute left-2.5 top-2.5 rounded-full px-2 py-0.5 font-[family-name:var(--font-mono)] text-[10px] ${
                      sold && !listed ? "bg-white text-black" : "bg-primary text-white"
                    }`}
                  >
                    {sold && !listed ? "SOLD" : formatUsd(priceUsd)}
                  </span>
                  <span
                    className={`absolute right-2.5 top-2.5 rounded-full px-2 py-0.5 text-[10px] font-semibold capitalize ${OVERALL_RARITY_CLASS[rarity]}`}
                  >
                    {OVERALL_RARITY_LABEL[rarity]}
                  </span>
                </div>
                <div className="border-t border-white/10 px-3 py-2.5">
                  <div className="truncate text-sm font-medium text-white">
                    {tokenName(collection, token)}
                  </div>
                  <div className="mt-0.5 font-[family-name:var(--font-mono)] text-[10px] tracking-[0.12em] text-white/40">
                    #{token.tokenId}
                    {!(sold && !listed) && solUsd && priceUsd > 0 ? ` · ${formatSol(usdToSol(priceUsd, solUsd))}` : ""}
                  </div>
                </div>
              </button>
            );
          })}
        </div>
        {visibleCount < tokens.length && (
          <div className="mt-6 flex justify-center">
            <button
              type="button"
              onClick={() => setVisibleCount((n) => n + COLLECTION_GRID_PAGE_SIZE)}
              className="rounded-full border border-white/15 bg-white/5 px-5 py-2 text-sm text-white/80 hover:border-white/30 hover:text-white"
            >
              Load more · {tokens.length - visibleCount} remaining
            </button>
          </div>
        )}
          </>
        )}
      </section>

      {selected && (
        <div
          className="fixed inset-0 z-50 flex items-end justify-center bg-black/60 p-0 sm:items-center sm:p-4"
          onClick={() => setSelected(null)}
        >
          <div
            className="tile max-h-[92vh] w-full max-w-3xl overflow-y-auto rounded-t-3xl border border-white/15 bg-[#161311] shadow-2xl sm:rounded-3xl"
            onClick={(e) => e.stopPropagation()}
          >
            <div className="grid md:grid-cols-2">
              {/* eslint-disable-next-line @next/next/no-img-element */}
              <img
                src={tokenImageSrc(collection, selected)}
                alt={tokenName(collection, selected)}
                className="aspect-square w-full object-cover"
              />
              <div className="bg-[#161311] p-5">
                <div className="flex items-start justify-between gap-3">
                  <div>
                    <p className="font-[family-name:var(--font-mono)] text-[11px] text-white/40">
                      {isTokenSold(selected, collection) ? "SOLD" : "AVAILABLE"}
                    </p>
                    <h3 className="mt-1 break-words text-2xl font-bold text-white sm:text-3xl">{tokenName(collection, selected)}</h3>
                    {(() => {
                      const rarity = tokenOverallRarity(
                        selected,
                        collection.supply || collection.tokens.length,
                        rarityRanks,
                      );
                      const rank = rarityRanks.get(selected.tokenId) ?? tokenRarityRank(selected);
                      return (
                        <div className="mt-2 flex flex-wrap items-center gap-2">
                          <span className={`rounded-full px-2.5 py-0.5 text-[11px] font-semibold capitalize ${OVERALL_RARITY_CLASS[rarity]}`}>
                            {OVERALL_RARITY_LABEL[rarity]}
                          </span>
                          {rank != null && (
                            <span className="text-xs text-white/45">
                              Rank {rank}/{collection.supply || collection.tokens.length}
                            </span>
                          )}
                        </div>
                      );
                    })()}
                  </div>
                  <button onClick={() => setSelected(null)} className="text-sm text-white/50">
                    Close
                  </button>
                </div>
                <p className="mt-3 text-lg font-semibold text-white">
                  {formatUsdAndSol(tokenAskPrice(collection, selected), solUsd)}
                </p>
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
                  {formatUsdAndSol(tokenAskPrice(collection, selected), solUsd)}
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
                        {busy ? "Opening SlicePay…" : `Buy for ${formatUsdAndSol(selected.listing.priceUsd, solUsd)}`}
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
                        <p className="text-sm text-white">Listed at {formatUsdAndSol(selected.listing.priceUsd, solUsd)}</p>
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
                        {busy ? "Processing…" : publicKey ? `Pay ${formatUsdAndSol(nftPrice(collection, selected), solUsd)}` : "Connect wallet"}
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
    </div>
  );
}

function Stat({ label, value, tip }: { label: string; value: string; tip?: string }) {
  return (
    <div className="rounded-2xl border border-white/10 bg-white/5 p-3" title={tip}>
      <dt className="font-[family-name:var(--font-mono)] text-[10px] tracking-[0.14em] text-white/50">
        {label.toUpperCase()}
      </dt>
      <dd className="mt-1 text-xl text-white">{value}</dd>
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
