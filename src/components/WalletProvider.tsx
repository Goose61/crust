"use client";

import { createContext, useCallback, useContext, useEffect, useMemo, useState } from "react";

type WalletCtx = {
  publicKey: string | null;
  connecting: boolean;
  connect: () => Promise<void>;
  disconnect: () => void;
  /** Sign a partially-signed Metaplex Core tx and broadcast. Returns signature. */
  signAndSendTx: (txBase64: string) => Promise<string>;
  /** Transfer SOL from connected wallet to another address. Returns signature. */
  transferSol: (toAddress: string, lamports: number | bigint) => Promise<string>;
};

const Ctx = createContext<WalletCtx>({
  publicKey: null,
  connecting: false,
  connect: async () => {},
  disconnect: () => {},
  signAndSendTx: async () => { throw new Error("Wallet not connected"); },
  transferSol: async () => { throw new Error("Wallet not connected"); },
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
  if (typeof window === "undefined") return null;
  const w = window as unknown as { solana?: Phantom; phantom?: { solana?: Phantom } };
  return w.solana?.isPhantom ? w.solana : w.phantom?.solana ?? w.solana ?? null;
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
  return (
    process.env.NEXT_PUBLIC_SOLANA_RPC_URL ??
    "https://api.mainnet-beta.solana.com"
  );
}

export function isDevnet(): boolean {
  return rpcUrl().includes("devnet");
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

  const signAndSendTx = useCallback(async (txBase64: string): Promise<string> => {
    const p = getProvider();
    if (!p) throw new Error("No wallet found. Install Phantom to continue.");
    const { VersionedTransaction } = await import("@solana/web3.js");
    const tx = VersionedTransaction.deserialize(Buffer.from(txBase64, "base64"));
    const result = await p.signAndSendTransaction(tx);
    return sigToBase58(result.signature);
  }, []);

  const transferSol = useCallback(async (toAddress: string, lamports: number | bigint): Promise<string> => {
    const p = getProvider();
    if (!p?.publicKey) throw new Error("Connect your wallet first.");
    const { Connection, PublicKey, SystemProgram, Transaction } = await import("@solana/web3.js");
    const connection = new Connection(rpcUrl(), "confirmed");
    const from = new PublicKey(p.publicKey.toBase58());
    const to = new PublicKey(toAddress);
    const { blockhash, lastValidBlockHeight } = await connection.getLatestBlockhash();
    const tx = new Transaction({
      feePayer: from,
      blockhash,
      lastValidBlockHeight,
    }).add(
      SystemProgram.transfer({
        fromPubkey: from,
        toPubkey: to,
        lamports: typeof lamports === "bigint" ? Number(lamports) : lamports,
      }),
    );
    const result = await p.signAndSendTransaction(tx);
    return sigToBase58(result.signature);
  }, []);

  const value = useMemo(
    () => ({ publicKey, connecting, connect, disconnect, signAndSendTx, transferSol }),
    [publicKey, connecting, connect, disconnect, signAndSendTx, transferSol],
  );

  return <Ctx.Provider value={value}>{children}</Ctx.Provider>;
}

export function useWallet() {
  return useContext(Ctx);
}
