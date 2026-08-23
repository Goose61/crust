/**
 * Client-side Irys uploads using the connected Phantom wallet.
 *
 * Uses @irys/web-upload-solana which routes fund transactions and upload
 * signatures through the injected wallet — no private keys in the app.
 *
 * @see https://www.npmjs.com/package/@irys/web-upload-solana
 */

import {
  IRYS_GATEWAY,
  IRYS_NODE_DEVNET,
  IRYS_NODE_MAINNET,
} from "./irys-shared";
import { getDirectRpcUrl, getSolanaNetwork, isDevnetNetwork } from "./solana-config";

export { IRYS_GATEWAY };

type PhantomLike = {
  isPhantom?: boolean;
  publicKey?: { toBuffer: () => Buffer; toBase58: () => string };
  signAndSendTransaction: (
    tx: unknown,
    opts?: { skipPreflight?: boolean },
  ) => Promise<{ signature: Uint8Array | string }>;
  signMessage: (
    message: Uint8Array,
    display?: string,
  ) => Promise<{ signature: Uint8Array }>;
};

function sigToBase58(sig: Uint8Array | string): string {
  if (typeof sig === "string") return sig;
  const ALPHA = "123456789ABCDEFGHJKLMNPQRSTUVWXYZabcdefghijkmnopqrstuvwxyz";
  const bytes = sig as Uint8Array;
  const digits: number[] = [0];
  for (const byte of bytes) {
    let carry = byte;
    for (let i = 0; i < digits.length; i++) {
      carry += digits[i] << 8;
      digits[i] = carry % 58;
      carry = Math.floor(carry / 58);
    }
    while (carry > 0) { digits.push(carry % 58); carry = Math.floor(carry / 58); }
  }
  let r = "";
  for (let i = 0; i < bytes.length && bytes[i] === 0; i++) r += "1";
  return r + digits.reverse().map((d) => ALPHA[d]).join("");
}

type SignatureStatus = {
  err?: unknown;
  confirmationStatus?: string;
};

async function rpcCall<T>(rpcUrl: string, method: string, params: unknown[]): Promise<T> {
  const res = await fetch(rpcUrl, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ jsonrpc: "2.0", id: 1, method, params }),
  });
  const json = (await res.json()) as { result?: T; error?: { message?: string } };
  if (json.error) throw new Error(json.error.message ?? "RPC error");
  return json.result as T;
}

/** Poll until the tx is visible on-chain at least at `confirmed`. Throws if dropped. */
async function waitForTxConfirmed(
  signature: string,
  rpcUrl: string,
  opts?: { maxAttempts?: number; intervalMs?: number },
): Promise<void> {
  const maxAttempts = opts?.maxAttempts ?? 90;
  const intervalMs = opts?.intervalMs ?? 2000;
  let lastStatus: SignatureStatus | null | undefined;

  for (let attempt = 0; attempt < maxAttempts; attempt++) {
    const result = await rpcCall<{ value: Array<SignatureStatus | null> }>(
      rpcUrl,
      "getSignatureStatuses",
      [[signature], { searchTransactionHistory: true }],
    );
    const status = result?.value?.[0];
    lastStatus = status;

    if (status?.err) {
      throw new Error(`Fund transaction failed on-chain: ${JSON.stringify(status.err)}`);
    }
    const cs = status?.confirmationStatus;
    if (cs === "confirmed" || cs === "finalized") return;

    await new Promise<void>((r) => setTimeout(r, intervalMs));
  }

  if (!lastStatus) {
    throw new Error(
      "Fund transaction was not found on-chain — it may have been dropped. " +
        "Approve quickly in Phantom and try again. Make sure Phantom is on the same network as this site.",
    );
  }
  throw new Error("Fund transaction confirmation timed out. Check Solana Explorer, then try again.");
}

/** Retry posting a fund tx to the Irys bundler until it accepts it. */
async function submitFundTxToBundler(txId: string, devnet: boolean): Promise<void> {
  const node = devnet ? IRYS_NODE_DEVNET : IRYS_NODE_MAINNET;
  let lastError = "";

  for (let attempt = 0; attempt < 40; attempt++) {
    const res = await fetch(`${node}/account/balance/solana`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ tx_id: txId }),
    });
    if (res.status === 200 || res.status === 202) return;

    lastError = await res.text();
    const retryable =
      lastError.includes("Confirmed tx not found") ||
      lastError.includes("not found") ||
      res.status === 400 ||
      res.status === 502 ||
      res.status === 503;
    if (!retryable) {
      throw new Error(`Bundler rejected fund tx: ${res.status} ${lastError}`);
    }
    await new Promise<void>((r) => setTimeout(r, 2000 + attempt * 250));
  }

  throw new Error(
    `Bundler could not confirm fund tx ${txId}. Your SOL may still have been sent — ` +
      `save this id and retry in a minute, or contact support.`,
  );
}

/** Minimal adapter expected by @irys/web-upload-solana injected signer. */
export function phantomToIrysWallet(phantom: PhantomLike, confirmRpcUrl: string) {
  if (!phantom.publicKey) throw new Error("Connect Phantom first.");
  return {
    publicKey: phantom.publicKey,
    sendTransaction: async (
      tx: unknown,
      _connection: unknown,
      opts?: { skipPreflight?: boolean },
    ) => {
      const result = await phantom.signAndSendTransaction(tx, {
        skipPreflight: opts?.skipPreflight ?? true,
      });
      const sig = sigToBase58(result.signature);

      // Phantom broadcasts via its own RPC; poll our direct cluster RPC until the
      // tx is confirmed before Irys posts to the bundler (which only retries ~5 s).
      await waitForTxConfirmed(sig, confirmRpcUrl);
      return sig;
    },
    signMessage: async (message: Uint8Array) => {
      const { signature } = await phantom.signMessage(message, "utf8");
      return signature;
    },
  };
}

export function getPhantomProvider(): PhantomLike | null {
  if (typeof window === "undefined") return null;
  const w = window as unknown as { solana?: PhantomLike; phantom?: { solana?: PhantomLike } };
  const p = w.solana?.isPhantom ? w.solana : w.phantom?.solana ?? w.solana ?? null;
  return p?.isPhantom ? p : null;
}

type IrysInstance = {
  getPrice: (bytes: number) => Promise<{ toString(): string }>;
  getBalance: () => Promise<{ toString(): string; lt: (v: unknown) => boolean }>;
  fund: (amount: unknown) => Promise<unknown>;
  upload: (
    data: string | Buffer,
    opts: { tags: { name: string; value: string }[] },
  ) => Promise<{ id: string }>;
};

/** Create an Irys uploader wired to the connected Phantom wallet. */
export async function createPhantomIrysUploader(devnet?: boolean): Promise<IrysInstance> {
  const phantom = getPhantomProvider();
  if (!phantom) throw new Error("Phantom wallet is required. Install it from phantom.app.");

  const network = getSolanaNetwork();
  const isDevnet = devnet ?? isDevnetNetwork(network);
  // Irys SDK needs a real RPC endpoint (not our browser proxy) for blockhash + fee estimation.
  const directRpc = getDirectRpcUrl(isDevnet ? "devnet" : "mainnet");

  const [{ WebUploader }, { WebSolana }] = await Promise.all([
    import("@irys/web-upload"),
    import("@irys/web-upload-solana"),
  ]);

  const wallet = phantomToIrysWallet(phantom, directRpc);
  const builder = WebUploader(WebSolana)
    .withProvider(wallet)
    .withRpc(directRpc)
    .withTokenOptions({ finality: "confirmed" });

  return (isDevnet ? await builder.devnet().build() : await builder.mainnet().build()) as IrysInstance;
}

const FUND_TX_RE = /failed to post funding tx - ([1-9A-HJ-NP-Za-km-z]+)/;

async function fundWithRetry(
  irys: IrysInstance,
  amount: string,
  confirmRpcUrl: string,
  devnet: boolean,
): Promise<void> {
  try {
    await irys.fund(amount);
  } catch (e) {
    const msg = e instanceof Error ? e.message : String(e);
    const match = msg.match(FUND_TX_RE);
    if (!match) throw e;

    const txId = match[1]!;
    // SDK gave up too early — wait until chain + bundler both see the tx.
    await waitForTxConfirmed(txId, confirmRpcUrl);
    await submitFundTxToBundler(txId, devnet);
  }
}

async function ensureFunded(
  irys: IrysInstance,
  bytes: number,
  confirmRpcUrl: string,
  devnet: boolean,
) {
  const price = await irys.getPrice(bytes);
  const balance = await irys.getBalance();
  if (!balance.lt(price)) return;
  const priceBn = BigInt(price.toString());
  const balanceBn = BigInt(balance.toString());
  const deficit = priceBn > balanceBn ? priceBn - balanceBn : 0n;
  const toFund = deficit + deficit / 10n + 1n;
  await fundWithRetry(irys, toFund.toString(), confirmRpcUrl, devnet);
}

/** Upload bytes permanently to Arweave; Phantom signs fund tx + upload message. */
export async function uploadWithPhantom(
  irys: IrysInstance,
  data: Uint8Array,
  contentType: string,
  confirmRpcUrl: string,
  devnet: boolean,
): Promise<string> {
  await ensureFunded(irys, data.length, confirmRpcUrl, devnet);
  const receipt = await irys.upload(Buffer.from(data), {
    tags: [{ name: "Content-Type", value: contentType }],
  });
  return `${IRYS_GATEWAY}/${receipt.id}`;
}

/** Upload gift image then metadata using one Phantom-connected Irys session. */
export async function uploadGiftWithPhantom(params: {
  imageBytes: Uint8Array;
  imageContentType: string;
  buildMetadata: (imageUri: string) => string;
  devnet?: boolean;
}): Promise<{ imageUri: string; metadataUri: string }> {
  const network = getSolanaNetwork();
  const devnet = params.devnet ?? isDevnetNetwork(network);
  const confirmRpc = getDirectRpcUrl(devnet ? "devnet" : "mainnet");
  const irys = await createPhantomIrysUploader(devnet);

  const imageUri = await uploadWithPhantom(
    irys,
    params.imageBytes,
    params.imageContentType,
    confirmRpc,
    devnet,
  );
  const metadataUri = await uploadWithPhantom(
    irys,
    new TextEncoder().encode(params.buildMetadata(imageUri)),
    "application/json",
    confirmRpc,
    devnet,
  );

  return { imageUri, metadataUri };
}
