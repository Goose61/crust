import {
  BaseMessageSignerWalletAdapter,
  scopePollingDetectionStrategy,
  WalletConnectionError,
  WalletDisconnectedError,
  WalletName,
  WalletNotConnectedError,
  WalletNotReadyError,
  WalletPublicKeyError,
  WalletReadyState,
  WalletSignMessageError,
  WalletSignTransactionError,
} from "@solana/wallet-adapter-base";
import type { Transaction, TransactionVersion, VersionedTransaction } from "@solana/web3.js";
import { PublicKey } from "@solana/web3.js";

type BackpackProvider = {
  isBackpack?: boolean;
  publicKey?: { toBytes(): Uint8Array; toBase58(): string };
  isConnected?: boolean;
  connect: () => Promise<{ publicKey?: { toBytes(): Uint8Array } } | void>;
  disconnect: () => Promise<void>;
  signTransaction: <T extends Transaction | VersionedTransaction>(tx: T) => Promise<T>;
  signAllTransactions: <T extends Transaction | VersionedTransaction>(txs: T[]) => Promise<T[]>;
  signMessage: (message: Uint8Array) => Promise<{ signature: Uint8Array } | Uint8Array>;
  on?: (event: string, handler: () => void) => void;
  off?: (event: string, handler: () => void) => void;
};

function getBackpack(): BackpackProvider | null {
  if (typeof window === "undefined") return null;
  const w = window as unknown as { backpack?: BackpackProvider; xnft?: { solana?: BackpackProvider } };
  return w.backpack?.isBackpack ? w.backpack : w.xnft?.solana ?? w.backpack ?? null;
}

export const BackpackWalletName = "Backpack" as WalletName<"Backpack">;

/** Desktop Backpack extension — Wallet Standard also auto-detects it when installed. */
export class BackpackWalletAdapter extends BaseMessageSignerWalletAdapter {
  name = BackpackWalletName;
  url = "https://backpack.app";
  icon =
    "data:image/svg+xml;base64,PHN2ZyB4bWxucz0iaHR0cDovL3d3dy53My5vcmcvMjAwMC9zdmciIHZpZXdCb3g9IjAgMCAzMiAzMiI+PHJlY3Qgd2lkdGg9IjMyIiBoZWlnaHQ9IjMyIiByeD0iOCIgZmlsbD0iI0UzM0UzRiIvPjx0ZXh0IHg9IjE2IiB5PSIyMSIgdGV4dC1hbmNob3I9Im1pZGRsZSIgZm9udC1zaXplPSIxNCIgZm9udC1mYW1pbHk9IkFyaWFsIiBmb250LXdlaWdodD0iNzAwIiBmaWxsPSIjZmZmIj5CPC90ZXh0Pjwvc3ZnPg==";
  supportedTransactionVersions: ReadonlySet<TransactionVersion> = new Set(["legacy", 0]);

  private _connecting = false;
  private _wallet: BackpackProvider | null = null;
  private _publicKey: PublicKey | null = null;
  private _readyState: WalletReadyState =
    typeof window === "undefined" ? WalletReadyState.Unsupported : WalletReadyState.NotDetected;

  constructor() {
    super();
    if (this._readyState !== WalletReadyState.Unsupported) {
      scopePollingDetectionStrategy(() => {
        if (getBackpack()?.isBackpack || getBackpack()) {
          this._readyState = WalletReadyState.Installed;
          this.emit("readyStateChange", this._readyState);
          return true;
        }
        return false;
      });
    }
  }

  get publicKey() {
    return this._publicKey;
  }
  get connecting() {
    return this._connecting;
  }
  get readyState() {
    return this._readyState;
  }

  async connect(): Promise<void> {
    try {
      if (this.connected || this.connecting) return;
      if (this.readyState !== WalletReadyState.Installed) throw new WalletNotReadyError();
      this._connecting = true;
      const wallet = getBackpack();
      if (!wallet) throw new WalletNotReadyError();
      if (!wallet.isConnected) {
        try {
          await wallet.connect();
        } catch (error: unknown) {
          const message = error instanceof Error ? error.message : "Backpack connect failed";
          throw new WalletConnectionError(message, error instanceof Error ? error : undefined);
        }
      }
      const raw = wallet.publicKey;
      if (!raw) throw new WalletConnectionError("No public key from Backpack");
      let publicKey: PublicKey;
      try {
        publicKey = new PublicKey(raw.toBytes());
      } catch (error: unknown) {
        throw new WalletPublicKeyError(error instanceof Error ? error.message : "Invalid public key");
      }
      this._wallet = wallet;
      this._publicKey = publicKey;
      wallet.on?.("disconnect", this._disconnected);
      this.emit("connect", publicKey);
    } finally {
      this._connecting = false;
    }
  }

  async disconnect(): Promise<void> {
    const wallet = this._wallet;
    if (wallet) {
      wallet.off?.("disconnect", this._disconnected);
      this._wallet = null;
      this._publicKey = null;
      try {
        await wallet.disconnect();
      } catch {
        /* ignore */
      }
    }
    this.emit("disconnect");
  }

  async signTransaction<T extends Transaction | VersionedTransaction>(transaction: T): Promise<T> {
    const wallet = this._wallet;
    if (!wallet) throw new WalletNotConnectedError();
    try {
      return await wallet.signTransaction(transaction);
    } catch (error: unknown) {
      throw new WalletSignTransactionError(error instanceof Error ? error.message : "Sign failed");
    }
  }

  async signAllTransactions<T extends Transaction | VersionedTransaction>(transactions: T[]): Promise<T[]> {
    const wallet = this._wallet;
    if (!wallet) throw new WalletNotConnectedError();
    return wallet.signAllTransactions(transactions);
  }

  async signMessage(message: Uint8Array): Promise<Uint8Array> {
    const wallet = this._wallet;
    if (!wallet) throw new WalletNotConnectedError();
    try {
      const result = await wallet.signMessage(message);
      return result instanceof Uint8Array ? result : result.signature;
    } catch (error: unknown) {
      throw new WalletSignMessageError(error instanceof Error ? error.message : "Sign message failed");
    }
  }

  private _disconnected = () => {
    const wallet = this._wallet;
    if (!wallet) return;
    wallet.off?.("disconnect", this._disconnected);
    this._wallet = null;
    this._publicKey = null;
    this.emit("error", new WalletDisconnectedError());
    this.emit("disconnect");
  };
}
