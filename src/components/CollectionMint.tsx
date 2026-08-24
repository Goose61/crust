"use client";

import { useMemo, useState } from "react";
import type { Collection, GeneratedToken } from "@/lib/types";
import { useWallet, networkName } from "./WalletProvider";
import { explorerClusterQuery } from "@/lib/solana-config";
import { formatUsd, isTokenSold, nftPrice, tokenImageSrc, tokenName } from "@/lib/collection-ui";
import { readJsonResponse } from "@/lib/fetch-json";

export function CollectionMint({ initial }: { initial: Collection }) {
  const { publicKey, connect, signMintTx } = useWallet();
  const [collection, setCollection] = useState(initial);
  const [selected, setSelected] = useState<GeneratedToken | null>(null);
  const [recipient, setRecipient] = useState("");
  const [checkoutUrl, setCheckoutUrl] = useState<string | null>(null);
  const [message, setMessage] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  const tokens = useMemo(
    () => [...collection.tokens].sort((a, b) => a.tokenId - b.tokenId),
    [collection.tokens],
  );
  const soldCount = tokens.filter((t) => isTokenSold(t, collection)).length;
  const remaining = Math.max(0, collection.supply - soldCount);
  const fees = collection.fees;
  const socials = collection.socials ?? {};

  const [mintBusy, setMintBusy] = useState(false);

  const isUnmintedGift =
    collection.payments.giftMintEnabled &&
    collection.supply === 1 &&
    !collection.tokens.some((t) => t.mintTxUrl);

  async function completeOnChainMint() {
    if (!publicKey) {
      await connect();
      return;
    }
    setMintBusy(true);
    setMessage(null);
    try {
      const res = await fetch("/api/gift/mint", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          collectionId: collection.id,
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

      setMessage("Approve the mint in Phantom…");
      const txSignature = await signMintTx(collection.id, networkName());

      const confirm = await fetch("/api/gift/mint", {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ collectionId: collection.id, txSignature, network: networkName() }),
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

  async function startCheckout(token: GeneratedToken) {
    if (!publicKey) {
      await connect();
      return;
    }
    setBusy(true);
    setMessage(null);
    try {
      const inv = await fetch("/api/slicepay/invoice", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          amountUsd: collection.payments.basePriceUsd,
          orderId: `mint-${collection.id}-${token.tokenId}-${Date.now()}`,
          description: tokenName(collection, token),
          redirectUrl: window.location.href,
        }),
      }).then((r) => r.json());
      if (inv.checkoutUrl) setCheckoutUrl(inv.checkoutUrl);
      if (inv.demo) {
        setMessage("Demo checkout: confirm below to record the mint on this marketplace.");
      }
    } catch (e) {
      setMessage(e instanceof Error ? e.message : "Checkout failed");
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
      const res = await fetch(`/api/collections/${collection.id}`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          action: "mint",
          payer: publicKey,
          recipient: collection.payments.giftMintEnabled && recipient ? recipient : publicKey,
          qty: 1,
          tokenId: token.tokenId,
          method: "slicepay",
        }),
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error);
      setCollection(data.collection);
      setMessage(`Minted #${data.mintedTokenIds.join(", ")} → ${data.recipient}`);
      setCheckoutUrl(null);
      setSelected(null);
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

      {isUnmintedGift && (
        <div className="mb-6 rounded-lg border border-amber-500/40 bg-amber-500/10 px-4 py-3 flex flex-col gap-2 sm:flex-row sm:items-center sm:justify-between">
          <div>
            <p className="text-sm font-medium text-amber-200">Stored on Arweave — not minted on-chain yet</p>
            <p className="text-xs text-amber-200/70 mt-0.5">
              The image and metadata are permanent, but the Solana NFT was never created.
              Connect Phantom, then mint to send it to the recipient wallet.
            </p>
          </div>
          <button
            type="button"
            onClick={() => void completeOnChainMint()}
            disabled={mintBusy}
            className="shrink-0 rounded-full bg-primary px-5 py-2 text-sm font-medium text-white hover:bg-primary/80 disabled:opacity-50"
          >
            {mintBusy ? "Minting…" : publicKey ? "Mint on-chain now" : "Connect & mint"}
          </button>
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
            Locked at launch. Every mint splits across these four buckets.
          </p>
          <div className="mt-5 flex h-3 overflow-hidden border border-white/15">
            <div className="bg-primary" style={{ width: `${fees.ownerPercent}%` }} />
            <div className="bg-white" style={{ width: `${fees.holdersPercent}%` }} />
            <div className="bg-[#f5c542]" style={{ width: `${fees.buybackPercent}%` }} />
            <div className="bg-[#6b3e2a]" style={{ width: `${fees.platformPercent}%` }} />
          </div>
          <ul className="mt-4 space-y-3 font-[family-name:var(--font-body)] text-sm">
            <FeeRow color="bg-primary" label="Creator" percent={fees.ownerPercent} note="Paid to the collection owner" />
            <FeeRow color="bg-white" label="Holders" percent={fees.holdersPercent} note="Shared with current holders" />
            <FeeRow color="bg-[#f5c542]" label="Buyback" percent={fees.buybackPercent} note="Treasury buybacks" />
            <FeeRow color="bg-[#6b3e2a]" label="Platform" percent={fees.platformPercent} note="Marketplace operations" />
          </ul>
        </div>
      </div>

      <section className="mt-12">
        <div className="mb-5 flex items-end justify-between">
          <h2 className="text-4xl">The collection</h2>
          <p className="font-[family-name:var(--font-mono)] text-xs text-white/50">
            {remaining} for sale · {soldCount} sold
          </p>
        </div>
        <div className="grid grid-cols-2 gap-3 sm:grid-cols-3 md:grid-cols-4 lg:grid-cols-5">
          {tokens.map((token) => {
            const sold = isTokenSold(token, collection);
            return (
              <button
                key={token.tokenId}
                type="button"
                onClick={() => {
                  setSelected(token);
                  setCheckoutUrl(null);
                  setMessage(null);
                }}
                className="tile text-left"
              >
                <div className="relative aspect-square">
                  {/* eslint-disable-next-line @next/next/no-img-element */}
                  <img
                    src={tokenImageSrc(collection.id, token)}
                    alt={tokenName(collection, token)}
                    className={`h-full w-full object-cover ${sold ? "grayscale" : ""}`}
                  />
                  <span
                    className={`absolute left-2 top-2 px-1.5 py-0.5 font-[family-name:var(--font-mono)] text-[10px] ${
                      sold ? "bg-white text-black" : "bg-primary text-white"
                    }`}
                  >
                    {sold ? "SOLD" : formatUsd(nftPrice(collection, token))}
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
                src={tokenImageSrc(collection.id, selected)}
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
                    {!checkoutUrl ? (
                      <button
                        disabled={busy}
                        onClick={() => void startCheckout(selected)}
                        className="w-full bg-primary py-3 text-sm font-medium text-primary-foreground disabled:opacity-40"
                      >
                        {busy ? "Opening checkout…" : publicKey ? "Checkout with SlicePay" : "Connect wallet"}
                      </button>
                    ) : (
                      <>
                        <iframe
                          title="SlicePay checkout"
                          src={checkoutUrl}
                          className="h-[420px] w-full border border-white/15 bg-white/5"
                        />
                        <button
                          disabled={busy}
                          onClick={() => void confirmMint(selected)}
                          className="w-full border border-white/15 py-3 text-sm font-medium disabled:opacity-40"
                        >
                          {busy ? "Confirming…" : "Confirm mint"}
                        </button>
                      </>
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
