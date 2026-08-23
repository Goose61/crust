"use client";

import { createContext, useCallback, useContext, useEffect, useMemo, useState } from "react";
import { getPhantomProvider } from "@/lib/irys-client";
import { PhantomConnectModal } from "@/components/PhantomConnectModal";
import { getRpcUrl, isDevnetNetwork } from "@/lib/solana-config";

type WalletCtx = {
  publicKey: string | null;
  connecting: boolean;
  isPhantom: boolean;
  connect: () => Promise<void>;
  disconnect: () => void;
  /** Sign a partially-signed Metaplex Core tx in Phantom and broadcast. */
  signAndSendTx: (txBase64: string) => Promise<string>;
};

const Ctx = createContext<WalletCtx>({
  publicKey: null,
  connecting: false,
  isPhantom: false,
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
  signAndSendTransaction: (
    tx: unknown,
    options?: { skipPreflight?: boolean },
  ) => Promise<PhantomResult>;
};

function getProvider(): Phantom | null {
  const p = getPhantomProvider() as Phantom | null;
  return p?.isPhantom ? p : null;
}

function sigToBase58(sig: Uint8Array | string): string {
  if (typeof sig === "string") return sig;
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
  let result = "";
  for (let i = 0; i < bytes8.length && bytes8[i] === 0; i++) result += "1";
  return result + digits.reverse().map((d) => ALPHA[d]).join("");
}

export function rpcUrl(): string {
  return getRpcUrl();
}

export function isDevnet(): boolean {
  return isDevnetNetwork();
}

export function WalletProvider({ children }: { children: React.ReactNode }) {
  const [publicKey, setPublicKey] = useState<string | null>(null);
  const [connecting, setConnecting] = useState(false);
  const [connectModalOpen, setConnectModalOpen] = useState(false);

  useEffect(() => {
    const p = getProvider();
    if (p?.publicKey) setPublicKey(p.publicKey.toBase58());
  }, []);

  const connect = useCallback(async () => {
    const p = getProvider();
    if (p) {
      setConnecting(true);
      try {
        const res = await p.connect();
        setPublicKey(res.publicKey.toBase58());
      } finally {
        setConnecting(false);
      }
      return;
    }
    // No Phantom extension detected — always show the modal.
    // Never navigate away with window.location.href because that loses form state.
    setConnectModalOpen(true);
  }, []);

  const disconnect = useCallback(() => {
    const p = getProvider();
    void p?.disconnect();
    setPublicKey(null);
  }, []);

  const signAndSendTx = useCallback(async (txBase64: string): Promise<string> => {
    const p = getProvider();
    if (!p) throw new Error("Connect Phantom to continue.");
    const { VersionedTransaction } = await import("@solana/web3.js");
    const tx = VersionedTransaction.deserialize(Buffer.from(txBase64, "base64"));
    const result = await p.signAndSendTransaction(tx);
    return sigToBase58(result.signature);
  }, []);

  const value = useMemo(
    () => ({
      publicKey,
      connecting,
      isPhantom: !!getProvider(),
      connect,
      disconnect,
      signAndSendTx,
    }),
    [publicKey, connecting, connect, disconnect, signAndSendTx],
  );

  return (
    <Ctx.Provider value={value}>
      {children}
      <PhantomConnectModal open={connectModalOpen} onOpenChange={setConnectModalOpen} />
    </Ctx.Provider>
  );
}

export function useWallet() {
  return useContext(Ctx);
}
