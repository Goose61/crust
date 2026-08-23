"use client";

import { useState } from "react";
import { Keypair } from "@solana/web3.js";
import { secretKeyToBase58 } from "@/lib/irys-client";

export type NewWallet = {
  publicKey: string;
  secretKeyB58: string;
  keypairJson: number[];
};

type Props = {
  open: boolean;
  onClose: () => void;
  onUse: (wallet: NewWallet) => void;
};

export function CreateWalletModal({ open, onClose, onUse }: Props) {
  const [wallet, setWallet] = useState<NewWallet | null>(null);
  const [saved, setSaved] = useState(false);
  const [copied, setCopied] = useState<"pub" | "sec" | null>(null);

  if (!open) return null;

  function generate() {
    const kp = Keypair.generate();
    setWallet({
      publicKey: kp.publicKey.toBase58(),
      secretKeyB58: secretKeyToBase58(kp.secretKey),
      keypairJson: Array.from(kp.secretKey),
    });
    setSaved(false);
    setCopied(null);
  }

  function downloadKeypair() {
    if (!wallet) return;
    const blob = new Blob([JSON.stringify(wallet.keypairJson)], { type: "application/json" });
    const url = URL.createObjectURL(blob);
    const a = document.createElement("a");
    a.href = url;
    a.download = `solana-wallet-${wallet.publicKey.slice(0, 8)}.json`;
    a.click();
    URL.revokeObjectURL(url);
  }

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/70 p-4">
      <div className="w-full max-w-md rounded-2xl border border-white/15 bg-[#111] p-6 text-white shadow-xl">
        <h2 className="text-xl font-semibold">Create recipient wallet</h2>
        <p className="mt-2 text-sm text-white/50 leading-relaxed">
          Generates a new Solana keypair in your browser. Save the private key before
          closing this dialog. Anyone with the private key controls the wallet.
        </p>

        {!wallet ? (
          <button
            type="button"
            onClick={generate}
            className="mt-6 w-full rounded bg-primary py-3 text-sm font-medium text-primary-foreground"
          >
            Generate new wallet
          </button>
        ) : (
          <div className="mt-5 space-y-4">
            <div className="rounded border border-white/10 bg-white/5 p-3">
              <p className="text-[10px] uppercase tracking-wider text-white/40 mb-1">Public address</p>
              <p className="font-mono text-xs break-all">{wallet.publicKey}</p>
              <button
                type="button"
                className="mt-2 text-xs text-primary hover:underline"
                onClick={() => {
                  void navigator.clipboard.writeText(wallet.publicKey);
                  setCopied("pub");
                }}
              >
                {copied === "pub" ? "Copied" : "Copy address"}
              </button>
            </div>

            <div className="rounded border border-yellow-500/30 bg-yellow-500/10 p-3">
              <p className="text-[10px] uppercase tracking-wider text-yellow-400/80 mb-1">
                Private key (save this)
              </p>
              <p className="font-mono text-xs break-all text-yellow-100/90">{wallet.secretKeyB58}</p>
              <div className="mt-2 flex gap-3">
                <button
                  type="button"
                  className="text-xs text-yellow-300 hover:underline"
                  onClick={() => {
                    void navigator.clipboard.writeText(wallet.secretKeyB58);
                    setCopied("sec");
                  }}
                >
                  {copied === "sec" ? "Copied" : "Copy private key"}
                </button>
                <button
                  type="button"
                  className="text-xs text-yellow-300 hover:underline"
                  onClick={downloadKeypair}
                >
                  Download JSON
                </button>
              </div>
            </div>

            <label className="flex items-start gap-2 text-sm text-white/70">
              <input
                type="checkbox"
                checked={saved}
                onChange={(e) => setSaved(e.target.checked)}
                className="mt-0.5"
              />
              I saved the private key in a safe place
            </label>
          </div>
        )}

        <div className="mt-6 flex gap-3">
          <button
            type="button"
            onClick={() => { setWallet(null); setSaved(false); onClose(); }}
            className="flex-1 rounded border border-white/15 py-2.5 text-sm text-white/60 hover:text-white"
          >
            Cancel
          </button>
          {wallet && (
            <button
              type="button"
              disabled={!saved}
              onClick={() => { onUse(wallet); setWallet(null); setSaved(false); onClose(); }}
              className="flex-1 rounded bg-primary py-2.5 text-sm font-medium text-primary-foreground disabled:opacity-40"
            >
              Use as recipient
            </button>
          )}
        </div>
      </div>
    </div>
  );
}
