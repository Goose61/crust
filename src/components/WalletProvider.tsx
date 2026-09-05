"use client";

import { createContext, useCallback, useContext, useEffect, useMemo, useState } from "react";
import { useConnection, useWallet as useAdapterWallet } from "@solana/wallet-adapter-react";
import { readJsonResponse } from "@/lib/fetch-json";
import { WalletConnectModal } from "@/components/WalletConnectModal";
import { setActiveWallet } from "@/lib/wallet-session";
import { getRpcUrl, getSolanaNetwork, isDevnetNetwork } from "@/lib/solana-config";

type WalletCtx = {
  publicKey: string | null;
  connecting: boolean;
  isPhantom: boolean;
  connect: () => Promise<void>;
  disconnect: () => void;
  /**
   * Wallet-first multi-signer mint: prepare (fresh blockhash + simulate) →
   * signTransaction → server co-sign → submit.
   */
  signMintTx: (collectionId: string, network?: string) => Promise<string>;
  /** @deprecated Use signMintTx for gift mints (wallet-first signing order). */
  signAndSendTx: (txBase64: string) => Promise<string>;
};

const Ctx = createContext<WalletCtx>({
  publicKey: null,
  connecting: false,
  isPhantom: false,
  connect: async () => {},
  disconnect: () => {},
  signMintTx: async () => {
    throw new Error("Wallet not connected");
  },
  signAndSendTx: async () => {
    throw new Error("Wallet not connected");
  },
});

export function rpcUrl(): string {
  return getRpcUrl();
}

export function networkName(): string {
  return getSolanaNetwork();
}

export function isDevnet(): boolean {
  return isDevnetNetwork();
}

export function WalletProvider({ children }: { children: React.ReactNode }) {
  const { connection } = useConnection();
  const {
    publicKey: adapterPublicKey,
    connected,
    connecting: adapterConnecting,
    disconnect: adapterDisconnect,
    signTransaction,
    signMessage,
    sendTransaction,
    wallet,
  } = useAdapterWallet();
  const [connectModalOpen, setConnectModalOpen] = useState(false);

  const publicKey = adapterPublicKey ? adapterPublicKey.toBase58() : null;

  useEffect(() => {
    if (!connected || !adapterPublicKey || !signTransaction || !signMessage || !sendTransaction) {
      setActiveWallet(null);
      return;
    }
    setActiveWallet({
      name: wallet?.adapter.name ?? "wallet",
      publicKey: adapterPublicKey,
      signMessage: async (message) => {
        const signature = await signMessage(message);
        return { signature };
      },
      signTransaction: (tx) => signTransaction(tx as Parameters<typeof signTransaction>[0]),
      signAndSendTransaction: async (tx, opts) => {
        const signature = await sendTransaction(tx as Parameters<typeof sendTransaction>[0], connection, {
          skipPreflight: opts?.skipPreflight,
        });
        return { signature };
      },
    });
    return () => setActiveWallet(null);
  }, [
    connected,
    adapterPublicKey,
    signTransaction,
    signMessage,
    sendTransaction,
    wallet,
    connection,
  ]);

  const connect = useCallback(async () => {
    if (connected) return;
    setConnectModalOpen(true);
  }, [connected]);

  const disconnect = useCallback(() => {
    setActiveWallet(null);
    void adapterDisconnect();
  }, [adapterDisconnect]);

  const signMintTx = useCallback(
    async (collectionId: string, network?: string): Promise<string> => {
      if (!publicKey) throw new Error("Wallet not connected.");
      if (!signTransaction) {
        throw new Error("This wallet cannot sign transactions. Try Phantom, Solflare, Backpack, or MetaMask.");
      }

      const prep = await fetch("/api/gift/prepare-sign", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ collectionId, payer: publicKey, network }),
      });
      const prepData = await readJsonResponse<{ txBase64?: string; error?: string }>(prep);
      if (!prep.ok || !prepData.txBase64) {
        throw new Error(prepData.error ?? "Failed to prepare transaction for signing");
      }

      const { VersionedTransaction } = await import("@solana/web3.js");
      const tx = VersionedTransaction.deserialize(Buffer.from(prepData.txBase64, "base64"));

      const signed = (await signTransaction(tx)) as InstanceType<typeof VersionedTransaction>;
      const signedB64 = Buffer.from(signed.serialize()).toString("base64");

      const res = await fetch("/api/gift/cosign", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ collectionId, signedTxBase64: signedB64, network }),
      });
      const data = await readJsonResponse<{ txSignature?: string; error?: string }>(res);
      if (!res.ok) throw new Error(data.error ?? "Co-sign failed");
      if (!data.txSignature) throw new Error("No transaction signature returned");
      return data.txSignature;
    },
    [publicKey, signTransaction],
  );

  const signAndSendTx = useCallback(
    async (txBase64: string): Promise<string> => {
      if (!sendTransaction) throw new Error("Connect a wallet to continue.");
      const { VersionedTransaction, Transaction } = await import("@solana/web3.js");
      const bytes = Buffer.from(txBase64, "base64");
      let tx: InstanceType<typeof VersionedTransaction> | InstanceType<typeof Transaction>;
      try {
        tx = VersionedTransaction.deserialize(bytes);
      } catch {
        tx = Transaction.from(bytes);
      }
      return sendTransaction(tx, connection, { skipPreflight: true });
    },
    [sendTransaction, connection],
  );

  const value = useMemo(
    () => ({
      publicKey,
      connecting: adapterConnecting,
      isPhantom: connected,
      connect,
      disconnect,
      signMintTx,
      signAndSendTx,
    }),
    [publicKey, adapterConnecting, connected, connect, disconnect, signMintTx, signAndSendTx],
  );

  return (
    <Ctx.Provider value={value}>
      {children}
      <WalletConnectModal open={connectModalOpen} onOpenChange={setConnectModalOpen} />
    </Ctx.Provider>
  );
}

export function useWallet() {
  return useContext(Ctx);
}
