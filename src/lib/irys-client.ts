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
import {
  getClientNetwork,
  getRpcUrl,
  isDevnetNetwork,
  type SolanaNetwork,
} from "./solana-config";

export { IRYS_GATEWAY };

type PhantomLike = {
  isPhantom?: boolean;
  publicKey?: { toBuffer: () => Buffer; toBase58: () => string };
  signAndSendTransaction: (
    tx: unknown,
    opts?: { skipPreflight?: boolean },
  ) => Promise<{ signature: Uint8Array | string }>;
  signTransaction?: (tx: unknown) => Promise<unknown>;
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
  const text = await res.text();
  if (!text.trim()) {
    throw new Error(`Solana RPC returned empty response (HTTP ${res.status}). Try again in a moment.`);
  }
  const json = JSON.parse(text) as { result?: T; error?: { message?: string } };
  if (json.error) throw new Error(json.error.message ?? "RPC error");
  return json.result as T;
}

async function txExistsOnNetwork(signature: string, network: SolanaNetwork): Promise<boolean> {
  try {
    const result = await rpcCall<{ value: Array<SignatureStatus | null> }>(
      getRpcUrl(network),
      "getSignatureStatuses",
      [[signature], { searchTransactionHistory: true }],
    );
    return result?.value?.[0] != null;
  } catch {
    return false;
  }
}

/** Poll until the tx is visible on-chain at least at `confirmed`. Throws if dropped. */
async function waitForTxConfirmed(
  signature: string,
  rpcUrl: string,
  expectedNetwork: SolanaNetwork,
  opts?: { maxAttempts?: number; intervalMs?: number },
): Promise<void> {
  const maxAttempts = opts?.maxAttempts ?? 60;
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
    const otherNetwork: SolanaNetwork = expectedNetwork === "mainnet" ? "devnet" : "mainnet";
    if (await txExistsOnNetwork(signature, otherNetwork)) {
      throw new Error(
        `Network mismatch: this site is on ${expectedNetwork}, but Phantom sent the transaction on ${otherNetwork}. ` +
          `In Phantom go to Settings → Developer Settings → turn ${otherNetwork === "devnet" ? "on" : "off"} Testnet Mode, then try again.`,
      );
    }
    throw new Error(
      "Fund transaction was not found on-chain — it may have been dropped (stale blockhash). " +
        "Try again and approve in Phantom immediately. Ensure Phantom matches this site's network.",
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
      `save this id and retry in a minute.`,
  );
}

async function fetchBundlerAddress(devnet: boolean): Promise<string> {
  const node = devnet ? IRYS_NODE_DEVNET : IRYS_NODE_MAINNET;
  const res = await fetch(`${node}/info`);
  if (!res.ok) throw new Error(`Could not reach Irys (${res.status})`);
  const info = (await res.json()) as { addresses?: { solana?: string } };
  const address = info.addresses?.solana;
  if (!address) throw new Error("Irys bundler address not found");
  return address;
}

/**
 * Fund the user's Irys account with a fresh blockhash — bypasses the SDK fund()
 * path which builds the tx too early (blockhash expires while Phantom popup is open).
 */
async function fundIrysAccount(params: {
  amountLamports: bigint;
  phantom: PhantomLike;
  rpcUrl: string;
  devnet: boolean;
  network: SolanaNetwork;
}): Promise<void> {
  const bundlerAddress = await fetchBundlerAddress(params.devnet);
  const {
    Connection,
    PublicKey,
    SystemProgram,
    Transaction,
  } = await import("@solana/web3.js");

  const connection = new Connection(params.rpcUrl, "confirmed");
  const payer = new PublicKey(params.phantom.publicKey!.toBase58());
  const { blockhash, lastValidBlockHeight } = await connection.getLatestBlockhash("confirmed");

  const tx = new Transaction({ feePayer: payer, blockhash, lastValidBlockHeight });
  tx.add(
    SystemProgram.transfer({
      fromPubkey: payer,
      toPubkey: new PublicKey(bundlerAddress),
      lamports: Number(params.amountLamports),
    }),
  );

  let sig: string;
  if (params.phantom.signTransaction) {
    const signed = (await params.phantom.signTransaction(tx)) as InstanceType<typeof Transaction>;
    sig = await connection.sendRawTransaction(signed.serialize(), {
      skipPreflight: false,
      preflightCommitment: "confirmed",
    });
  } else {
    const result = await params.phantom.signAndSendTransaction(tx, { skipPreflight: false });
    sig = sigToBase58(result.signature);
  }

  await waitForTxConfirmed(sig, params.rpcUrl, params.network);
  await submitFundTxToBundler(sig, params.devnet);
}

/** Minimal adapter for Irys upload message signing (not used for funding). */
export function phantomToIrysWallet(phantom: PhantomLike) {
  if (!phantom.publicKey) throw new Error("Connect Phantom first.");
  return {
    publicKey: phantom.publicKey,
    sendTransaction: async () => {
      throw new Error("Funding uses a custom flow — this should not be called.");
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
  upload: (
    data: string | Buffer,
    opts: { tags: { name: string; value: string }[] },
  ) => Promise<{ id: string }>;
};

/** Create an Irys uploader wired to the connected Phantom wallet. */
export async function createPhantomIrysUploader(
  network: SolanaNetwork,
): Promise<IrysInstance> {
  const phantom = getPhantomProvider();
  if (!phantom) throw new Error("Phantom wallet is required. Install it from phantom.app.");

  const devnet = isDevnetNetwork(network);
  const rpcUrl = getRpcUrl(network);

  const [{ WebUploader }, { WebSolana }] = await Promise.all([
    import("@irys/web-upload"),
    import("@irys/web-upload-solana"),
  ]);

  const wallet = phantomToIrysWallet(phantom);
  const builder = WebUploader(WebSolana)
    .withProvider(wallet)
    .withRpc(rpcUrl)
    .withTokenOptions({ finality: "confirmed" });

  return (devnet ? await builder.devnet().build() : await builder.mainnet().build()) as IrysInstance;
}

async function ensureFunded(
  irys: IrysInstance,
  bytes: number,
  phantom: PhantomLike,
  rpcUrl: string,
  network: SolanaNetwork,
) {
  const devnet = isDevnetNetwork(network);
  const price = await irys.getPrice(bytes);
  const balance = await irys.getBalance();
  if (!balance.lt(price)) return;
  const priceBn = BigInt(price.toString());
  const balanceBn = BigInt(balance.toString());
  const deficit = priceBn > balanceBn ? priceBn - balanceBn : 0n;
  const toFund = deficit + deficit / 10n + 1n;
  await fundIrysAccount({
    amountLamports: toFund,
    phantom,
    rpcUrl,
    devnet,
    network,
  });
}

/** Upload bytes permanently to Arweave; Phantom signs fund tx + upload message. */
export async function uploadWithPhantom(
  irys: IrysInstance,
  data: Uint8Array,
  contentType: string,
  phantom: PhantomLike,
  rpcUrl: string,
  network: SolanaNetwork,
): Promise<string> {
  await ensureFunded(irys, data.length, phantom, rpcUrl, network);
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
  network?: SolanaNetwork;
  onStage?: (stage: "funding" | "uploading") => void;
}): Promise<{ imageUri: string; metadataUri: string }> {
  const network = params.network ?? (await getClientNetwork());
  const confirmRpc = getRpcUrl(network);
  const phantom = getPhantomProvider();
  if (!phantom?.publicKey) throw new Error("Connect Phantom first.");

  const irys = await createPhantomIrysUploader(network);

  params.onStage?.("funding");
  const imageUri = await uploadWithPhantom(
    irys,
    params.imageBytes,
    params.imageContentType,
    phantom,
    confirmRpc,
    network,
  );
  params.onStage?.("uploading");
  const metadataUri = await uploadWithPhantom(
    irys,
    new TextEncoder().encode(params.buildMetadata(imageUri)),
    "application/json",
    phantom,
    confirmRpc,
    network,
  );

  return { imageUri, metadataUri };
}

export function networkLabel(network: SolanaNetwork): string {
  return network === "mainnet" ? "Mainnet" : "Devnet";
}

export function phantomNetworkHint(network: SolanaNetwork): string {
  return network === "mainnet"
    ? "In Phantom: Settings → Developer Settings → turn OFF Testnet Mode"
    : "In Phantom: Settings → Developer Settings → turn ON Testnet Mode";
}
