"use client";

import { createContext, useCallback, useContext, useEffect, useMemo, useState } from "react";

type WalletCtx = {
  publicKey: string | null;
  connecting: boolean;
  connect: () => Promise<void>;
  disconnect: () => void;
  /**
   * Sign a partially-signed transaction (base64) with the connected wallet
   * and broadcast it. Returns the transaction signature string.
   * Throws if the wallet is not connected or the user rejects.
   */
  signAndSendTx: (txBase64: string) => Promise<string>;
};

const Ctx = createContext<WalletCtx>({
  publicKey: null,
  connecting: false,
  connect: async () => {},
  disconnect: () => {},
  signAndSendTx: async () => { throw new Error("Wallet not connected"); },
});

type PhantomResult = { signature: Uint8Array | string };

type Phantom = {
  isPhantom?: boolean;
  publicKey?: { toBase58: () => string };
  connect: () => Promise<{ publicKey: { toBase58: () => string } }>;
  disconnect: () => Promise<void>;
  /** Signs and submits a VersionedTransaction, returns the signature */
  signAndSendTransaction: (
    tx: unknown,
    options?: { skipPreflight?: boolean },
  ) => Promise<PhantomResult>;
};

function getProvider(): Phantom | null {
  if (typeof window === "undefined") return null;
  const w = window as unknown as { solana?: Phantom; phantom?: { solana?: Phantom } };
  return w.solana?.isPhantom ? w.solana : w.phantom?.solana ?? w.solana ?? null;
}

export function WalletProvider({ children }: { children: React.ReactNode }) {
  const [publicKey, setPublicKey] = useState<string | null>(null);
  const [connecting, setConnecting] = useState(false);

  useEffect(() => {
    const p = getProvider();
    if (p?.publicKey) setPublicKey(p.publicKey.toBase58());
  }, []);

  const connect = useCallback(async () => {
    const p = getProvider();
    if (!p) {
      window.open("https://phantom.app/", "_blank");
      return;
    }
    setConnecting(true);
    try {
      const res = await p.connect();
      setPublicKey(res.publicKey.toBase58());
    } finally {
      setConnecting(false);
    }
  }, []);

  const disconnect = useCallback(() => {
    const p = getProvider();
    void p?.disconnect();
    setPublicKey(null);
  }, []);

  /**
   * Deserialize a base64-encoded partially-signed UMI/Metaplex Core
   * transaction, have Phantom add the fee-payer signature, and broadcast it.
   *
   * Uses @solana/web3.js VersionedTransaction (lazy import — avoids bundling
   * web3.js during SSR / non-wallet pages).
   */
  const signAndSendTx = useCallback(async (txBase64: string): Promise<string> => {
    const p = getProvider();
    if (!p) throw new Error("No wallet found. Install Phantom to continue.");

    // Lazy import to keep web3.js out of the initial bundle
    const { VersionedTransaction } = await import("@solana/web3.js");

    const bytes = Buffer.from(txBase64, "base64");
    const tx = VersionedTransaction.deserialize(bytes);

    // Phantom signs as fee payer (adds its signature) and broadcasts
    const result = await p.signAndSendTransaction(tx);

    // Phantom returns signature as Uint8Array or base58 string depending on version
    const sig = result.signature;
    if (typeof sig === "string") return sig;

    // Convert Uint8Array → base58 string
    const ALPHA = "123456789ABCDEFGHJKLMNPQRSTUVWXYZabcdefghijkmnopqrstuvwxyz";
    const bytes8 = sig as Uint8Array;
    const digits: number[] = [0];
    for (const byte of bytes8) {
      let carry = byte;
      for (let i = 0; i < digits.length; i++) {
        carry += digits[i] << 8;
        digits[i] = carry % 58;
        carry = Math.floor(carry / 58);
      }
      while (carry > 0) { digits.push(carry % 58); carry = Math.floor(carry / 58); }
    }
    let result58 = "";
    for (let i = 0; i < bytes8.length && bytes8[i] === 0; i++) result58 += "1";
    return result58 + digits.reverse().map((d) => ALPHA[d]).join("");
  }, []);

  const value = useMemo(
    () => ({ publicKey, connecting, connect, disconnect, signAndSendTx }),
    [publicKey, connecting, connect, disconnect, signAndSendTx],
  );

  return <Ctx.Provider value={value}>{children}</Ctx.Provider>;
}

export function useWallet() {
  return useContext(Ctx);
}
