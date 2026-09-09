"use client";

import { useEffect, useMemo, useState } from "react";
import QRCode from "react-qr-code";
import { useWallet } from "@solana/wallet-adapter-react";
import { WalletReadyState, type WalletName } from "@solana/wallet-adapter-base";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import {
  WALLET_OPTIONS,
  buildWalletBrowseUrl,
  isMobileDevice,
  type WalletOptionId,
} from "@/lib/connect-wallets";

type Props = {
  open: boolean;
  onOpenChange: (open: boolean) => void;
};

export function WalletConnectModal({ open, onOpenChange }: Props) {
  const { wallets, select, connect, disconnect, connecting, connected, wallet } = useWallet();
  const [qrWallet, setQrWallet] = useState<WalletOptionId>("phantom");
  const [pickedWallet, setPickedWallet] = useState<WalletName | null>(null);
  const [error, setError] = useState<string | null>(null);
  const mobile = useMemo(() => isMobileDevice(), [open]);
  const pageUrl = useMemo(() => {
    if (typeof window === "undefined") return "";
    return window.location.href;
  }, [open]);

  useEffect(() => {
    if (!open) {
      setPickedWallet(null);
      setError(null);
    }
  }, [open]);

  useEffect(() => {
    if (connected && open) {
      setPickedWallet(null);
      setError(null);
      onOpenChange(false);
    }
  }, [connected, open, onOpenChange]);

  useEffect(() => {
    if (!open || !pickedWallet) return;
    if (wallet?.adapter.name !== pickedWallet) return;

    let cancelled = false;
    void (async () => {
      try {
        await connect();
      } catch (err) {
        if (cancelled) return;
        const message =
          err instanceof Error ? err.message : "Could not connect to that wallet.";
        setError(message);
        setPickedWallet(null);
        try {
          await disconnect();
        } catch {
          /* ignore */
        }
      }
    })();

    return () => {
      cancelled = true;
    };
  }, [open, pickedWallet, wallet?.adapter.name, connect, disconnect]);

  function matchWallet(adapterNames: string[]) {
    return wallets.find((w) => adapterNames.includes(w.adapter.name));
  }

  function canConnect(adapterNames: string[]) {
    const w = matchWallet(adapterNames);
    if (!w) return false;
    return (
      w.readyState === WalletReadyState.Installed ||
      w.readyState === WalletReadyState.Loadable
    );
  }

  function pick(id: WalletOptionId, adapterNames: string[], installUrl: string) {
    if (connecting || pickedWallet) return;

    setError(null);
    const w = matchWallet(adapterNames);
    if (w && (w.readyState === WalletReadyState.Installed || w.readyState === WalletReadyState.Loadable)) {
      const name = w.adapter.name as WalletName;
      setPickedWallet(name);
      select(name);
      return;
    }
    if (mobile && pageUrl) {
      window.location.href = buildWalletBrowseUrl(id, pageUrl);
      return;
    }
    window.open(installUrl, "_blank", "noopener,noreferrer");
  }

  function handleOpenChange(next: boolean) {
    if (!next && (connecting || pickedWallet)) {
      setPickedWallet(null);
      void disconnect();
    }
    onOpenChange(next);
  }

  const qrUrl = pageUrl ? buildWalletBrowseUrl(qrWallet, pageUrl) : "";
  const qrLabel = WALLET_OPTIONS.find((o) => o.id === qrWallet)?.name ?? "wallet";
  const busy = connecting || Boolean(pickedWallet);

  return (
    <Dialog open={open} onOpenChange={handleOpenChange}>
      <DialogContent className="border-white/15 bg-[#0a0908] text-white sm:max-w-md">
        <DialogHeader>
          <DialogTitle>Connect wallet</DialogTitle>
          <DialogDescription className="text-white/60">
            {busy
              ? "Approve the connection in your wallet extension…"
              : mobile
                ? "Open this site in a wallet app, or connect if you are already inside one."
                : "Choose a Solana wallet to sign in and approve transactions."}
          </DialogDescription>
        </DialogHeader>

        {error && (
          <div className="rounded-lg border border-red-500/40 bg-red-500/10 px-3 py-2 text-xs text-red-300">
            {error}
          </div>
        )}

        <div className="grid grid-cols-1 gap-2">
          {WALLET_OPTIONS.map((opt) => {
            const w = matchWallet(opt.adapterNames);
            const ready = canConnect(opt.adapterNames);
            const hint = busy && pickedWallet && w?.adapter.name === pickedWallet
              ? "Waiting for approval…"
              : ready
                ? "Detected — tap to connect"
                : mobile
                  ? "Open in app"
                  : "Install extension";
            return (
              <button
                key={opt.id}
                type="button"
                disabled={busy}
                onClick={() => pick(opt.id, opt.adapterNames, opt.installUrl)}
                className="flex items-center gap-3 rounded-xl border border-white/10 bg-white/5 px-3 py-2.5 text-left hover:border-white/25 hover:bg-white/10 disabled:cursor-not-allowed disabled:opacity-50"
              >
                <span
                  className="flex h-9 w-9 shrink-0 items-center justify-center overflow-hidden rounded-lg"
                  style={{ background: `${opt.accent}22` }}
                >
                  {w?.adapter.icon ? (
                    // eslint-disable-next-line @next/next/no-img-element
                    <img src={w.adapter.icon} alt="" className="h-7 w-7" />
                  ) : (
                    <span className="text-sm font-bold" style={{ color: opt.accent }}>
                      {opt.name.slice(0, 1)}
                    </span>
                  )}
                </span>
                <span className="min-w-0 flex-1">
                  <span className="block text-sm font-medium text-white">{opt.name}</span>
                  <span className="block text-xs text-white/45">{hint}</span>
                </span>
              </button>
            );
          })}
        </div>

        {!mobile && (
          <div className="rounded-lg border border-white/10 bg-white/5 p-4">
            <p className="mb-1 text-sm font-medium text-white">On your phone?</p>
            <p className="mb-3 text-xs text-white/50">
              Scan with your camera to open this page inside {qrLabel}&apos;s in-app browser.
            </p>
            <div className="mb-3 flex flex-wrap gap-1.5">
              {WALLET_OPTIONS.map((opt) => (
                <button
                  key={opt.id}
                  type="button"
                  disabled={busy}
                  onClick={() => setQrWallet(opt.id)}
                  className={`rounded-full px-2.5 py-1 text-[11px] disabled:opacity-50 ${
                    qrWallet === opt.id
                      ? "bg-primary text-white"
                      : "bg-white/10 text-white/60 hover:text-white"
                  }`}
                >
                  {opt.name}
                </button>
              ))}
            </div>
            <div className="flex justify-center">
              <div className="rounded-xl bg-white p-3">
                {qrUrl ? (
                  <QRCode value={qrUrl} size={120} level="M" />
                ) : (
                  <div className="h-[120px] w-[120px]" />
                )}
              </div>
            </div>
          </div>
        )}
      </DialogContent>
    </Dialog>
  );
}
