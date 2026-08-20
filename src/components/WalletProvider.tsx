"use client";

import { createContext, useCallback, useContext, useEffect, useMemo, useState } from "react";

type WalletCtx = {
  publicKey: string | null;
  connecting: boolean;
  connect: () => Promise<void>;
  disconnect: () => void;
};

const Ctx = createContext<WalletCtx>({
  publicKey: null,
  connecting: false,
  connect: async () => {},
  disconnect: () => {},
});

type Phantom = {
  isPhantom?: boolean;
  publicKey?: { toBase58: () => string };
  connect: () => Promise<{ publicKey: { toBase58: () => string } }>;
  disconnect: () => Promise<void>;
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

  const value = useMemo(
    () => ({ publicKey, connecting, connect, disconnect }),
    [publicKey, connecting, connect, disconnect],
  );
  return <Ctx.Provider value={value}>{children}</Ctx.Provider>;
}

export function useWallet() {
  return useContext(Ctx);
}
