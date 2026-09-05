/**
 * Active Solana wallet used outside React (auth headers, Irys uploads).
 * WalletProvider writes this when a wallet connects.
 */

export type ActiveWallet = {
  name: string;
  publicKey: { toBase58: () => string; toBuffer: () => Buffer };
  signMessage: (
    message: Uint8Array,
    display?: string,
  ) => Promise<{ signature: Uint8Array }>;
  signTransaction: (tx: unknown) => Promise<unknown>;
  signAndSendTransaction: (
    tx: unknown,
    opts?: { skipPreflight?: boolean },
  ) => Promise<{ signature: string }>;
};

let active: ActiveWallet | null = null;

export function setActiveWallet(wallet: ActiveWallet | null) {
  active = wallet;
}

export function getActiveWallet(): ActiveWallet | null {
  return active;
}
