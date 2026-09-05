"use client";

import { useEffect, useMemo, type ReactNode } from "react";
import {
  ConnectionProvider,
  WalletProvider as AdapterWalletProvider,
} from "@solana/wallet-adapter-react";
import { PhantomWalletAdapter } from "@solana/wallet-adapter-phantom";
import { SolflareWalletAdapter } from "@solana/wallet-adapter-solflare";
import { WalletError } from "@solana/wallet-adapter-base";
import { createSolanaClient } from "@metamask/connect-solana";
import { BackpackWalletAdapter } from "@/lib/backpack-wallet-adapter";
import { getRpcUrl, SOLANA_RPC_DEVNET, SOLANA_RPC_MAINNET } from "@/lib/solana-config";

/**
 * Solana Wallet Adapter + MetaMask Connect Solana (Wallet Standard).
 * @see https://docs.metamask.io/metamask-connect/solana/guides/use-wallet-adapter/
 * @see https://docs.solflare.com/solflare/technical/integrate-solflare
 */
export function SolanaAdapterProvider({ children }: { children: ReactNode }) {
  const endpoint = useMemo(() => getRpcUrl(), []);
  const wallets = useMemo(
    () => [new PhantomWalletAdapter(), new SolflareWalletAdapter(), new BackpackWalletAdapter()],
    [],
  );

  useEffect(() => {
    void createSolanaClient({
      dapp: {
        name: "Crust",
        url: window.location.origin,
      },
      api: {
        supportedNetworks: {
          mainnet:
            process.env.NEXT_PUBLIC_SOLANA_RPC_URL_MAINNET ?? SOLANA_RPC_MAINNET,
          devnet:
            process.env.NEXT_PUBLIC_SOLANA_RPC_URL_DEVNET ?? SOLANA_RPC_DEVNET,
        },
      },
    }).catch((err) => {
      console.warn("[wallet] MetaMask Solana client failed to register", err);
    });
  }, []);

  return (
    <ConnectionProvider endpoint={endpoint}>
      <AdapterWalletProvider
        wallets={wallets}
        autoConnect
        onError={(error: WalletError) => {
          if (error.name === "WalletNotReadyError" || error.name === "WalletNotConnectedError") {
            return;
          }
          console.warn("[wallet]", error.message);
        }}
      >
        {children}
      </AdapterWalletProvider>
    </ConnectionProvider>
  );
}
