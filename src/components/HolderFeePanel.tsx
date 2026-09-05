"use client";

import { useCallback, useEffect, useState } from "react";
import type { FeeLedger } from "@/lib/types";
import { useWallet } from "./WalletProvider";
import { formatUsd } from "@/lib/collection-ui";
import { buildAuthHeaders } from "@/lib/wallet-auth-client";

type FeeStatus = {
  feeLedger: FeeLedger | null;
  feeClaimsOpen: boolean;
  treasuryBuybackActive: boolean;
  buybackTokenCa: string | null;
  claimPreview: {
    wallet: string;
    heldCount: number;
    claimableUsd: number;
    alreadyClaimedUsd: number;
  } | null;
};

export function HolderFeePanel({ collectionId }: { collectionId: string }) {
  const { publicKey, connect } = useWallet();
  const [status, setStatus] = useState<FeeStatus | null>(null);
  const [message, setMessage] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  const load = useCallback(async () => {
    const res = await fetch(`/api/collections/${collectionId}`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ action: "fee_status", wallet: publicKey ?? "" }),
    });
    const data = await res.json();
    if (res.ok) setStatus(data);
  }, [collectionId, publicKey]);

  useEffect(() => {
    void load();
  }, [load]);

  async function claim() {
    if (!publicKey) {
      await connect();
      return;
    }
    setBusy(true);
    setMessage(null);
    try {
      const res = await fetch(`/api/collections/${collectionId}`, {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          ...(await buildAuthHeaders(publicKey)),
        },
        body: JSON.stringify({ action: "claim_fees" }),
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error);
      setMessage(`Claimed ${formatUsd(data.claimedUsd)} — payout processed off-chain.`);
      await load();
    } catch (e) {
      setMessage(e instanceof Error ? e.message : "Claim failed");
    } finally {
      setBusy(false);
    }
  }

  const ledger = status?.feeLedger;

  return (
    <section className="mt-10 space-y-6">
      <div>
        <h2 className="text-xl font-semibold text-white">Treasury & rewards</h2>
        <p className="mt-1 text-xs text-white/40">
          Holder and buyback treasuries accrue on every primary mint and secondary sale.
        </p>
      </div>

      {ledger && (
        <dl className="grid grid-cols-2 gap-3 sm:grid-cols-4">
          <TreasuryStat label="Holder pool" value={formatUsd(ledger.holderTreasuryUsd)} />
          <TreasuryStat label="Buyback pool" value={formatUsd(ledger.buybackTreasuryUsd)} />
          <TreasuryStat label="Platform" value={formatUsd(ledger.platformTreasuryUsd)} />
          <TreasuryStat label="Creator accrued" value={formatUsd(ledger.ownerAccruedUsd)} />
        </dl>
      )}

      {status?.buybackTokenCa && (
        <div className="rounded border border-[#f5c542]/30 bg-[#f5c542]/5 px-3 py-2 text-xs">
          <p className="text-[#f5c542] font-medium">Buyback token CA</p>
          <p className="mt-1 font-mono text-white/80 break-all">{status.buybackTokenCa}</p>
        </div>
      )}

      {status?.feeClaimsOpen && status.claimPreview && (
        <div className="rounded border border-white/10 p-4">
          <h3 className="text-sm font-medium text-white">Holder fee claim</h3>
          {status.claimPreview.heldCount > 0 ? (
            <>
              <p className="mt-2 text-sm text-white/60">
                You hold {status.claimPreview.heldCount} NFT
                {status.claimPreview.heldCount !== 1 ? "s" : ""} in the last distribution snapshot.
              </p>
              <p className="mt-1 text-lg font-semibold text-white">
                Claimable: {formatUsd(status.claimPreview.claimableUsd)}
              </p>
              {status.claimPreview.alreadyClaimedUsd > 0 && (
                <p className="text-xs text-white/40">
                  Already claimed: {formatUsd(status.claimPreview.alreadyClaimedUsd)}
                </p>
              )}
              <button
                type="button"
                disabled={busy || status.claimPreview.claimableUsd <= 0}
                onClick={() => void claim()}
                className="mt-3 rounded-full bg-primary px-5 py-2 text-sm font-medium text-white disabled:opacity-50"
              >
                {busy ? "Claiming…" : publicKey ? "Claim holder share" : "Connect & claim"}
              </button>
            </>
          ) : (
            <p className="mt-2 text-sm text-white/50">
              Connect a wallet that held NFTs when the last fee distribution round opened.
            </p>
          )}
        </div>
      )}

      {status?.treasuryBuybackActive && ledger && ledger.buybacks.length > 0 && (
        <div>
          <h3 className="text-sm font-medium text-white">Buyback history</h3>
          <ul className="mt-2 space-y-2 text-xs">
            {ledger.buybacks.map((b, i) => (
              <li key={`${b.at}-${i}`} className="rounded border border-white/10 px-3 py-2 font-mono text-white/70">
                #{b.tokenId} · {formatUsd(b.priceUsd)} · {new Date(b.at).toLocaleString()}
              </li>
            ))}
          </ul>
        </div>
      )}

      {message && <p className="text-sm text-white/60">{message}</p>}
    </section>
  );
}

function TreasuryStat({ label, value }: { label: string; value: string }) {
  return (
    <div className="rounded border border-white/10 p-3">
      <dt className="text-[10px] uppercase tracking-wider text-white/40">{label}</dt>
      <dd className="mt-1 text-lg font-semibold text-white">{value}</dd>
    </div>
  );
}
