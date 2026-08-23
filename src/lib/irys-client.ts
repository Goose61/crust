/**
 * Client-side Irys uploads using the connected Phantom wallet.
 *
 * Uses @irys/web-upload-solana which routes fund transactions and upload
 * signatures through the injected wallet — no private keys in the app.
 *
 * @see https://www.npmjs.com/package/@irys/web-upload-solana
 */

import { IRYS_GATEWAY } from "./irys-shared";

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

/** Minimal shape of the Solana Connection the Irys SDK passes to sendTransaction. */
type IrysConnection = {
  getSignatureStatuses?: (
    sigs: string[],
  ) => Promise<{ value: Array<{ confirmationStatus?: string; err?: unknown } | null> }>;
  [k: string]: unknown;
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

/** Minimal adapter expected by @irys/web-upload-solana injected signer. */
export function phantomToIrysWallet(phantom: PhantomLike) {
  if (!phantom.publicKey) throw new Error("Connect Phantom first.");
  return {
    publicKey: phantom.publicKey,
    sendTransaction: async (
      tx: unknown,
      connection: IrysConnection,
      opts?: { skipPreflight?: boolean },
    ) => {
      const result = await phantom.signAndSendTransaction(tx, {
        skipPreflight: opts?.skipPreflight ?? true,
      });
      const sig = sigToBase58(result.signature);

      // Irys calls confirmationPoll() then getTransaction(txId, {commitment:"finalized"})
      // after sendTransaction returns. On mainnet, finalization takes 30–90 s, but the
      // Irys internal poll only waits 30 s — so it times out and submitTransaction fails
      // with "Confirmed tx not found". We must wait for "finalized" here so that Irys
      // finds the transaction immediately when it checks.
      if (connection.getSignatureStatuses) {
        for (let attempt = 0; attempt < 90; attempt++) {
          await new Promise<void>((r) => setTimeout(r, 2000));
          try {
            const res = await connection.getSignatureStatuses!([sig]);
            const status = res?.value?.[0];
            if (status?.err) {
              throw new Error(`Fund transaction failed: ${JSON.stringify(status.err)}`);
            }
            const cs = status?.confirmationStatus;
            // Wait for finalized (not just confirmed) — mainnet can take 60–90 s.
            if (cs === "finalized") break;
          } catch (e) {
            if (e instanceof Error && e.message.startsWith("Fund transaction failed")) throw e;
            // transient RPC error — keep polling
          }
        }
      }

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
export async function createPhantomIrysUploader(
  rpcUrl: string,
  devnet: boolean,
): Promise<IrysInstance> {
  const phantom = getPhantomProvider();
  if (!phantom) throw new Error("Phantom wallet is required. Install it from phantom.app.");

  const [{ WebUploader }, { WebSolana }] = await Promise.all([
    import("@irys/web-upload"),
    import("@irys/web-upload-solana"),
  ]);

  const wallet = phantomToIrysWallet(phantom);
  // Use "confirmed" finality for the SDK's internal confirmationPoll / getTransaction checks.
  // Our sendTransaction adapter already waits for "finalized" before returning, so by the time
  // the SDK polls the chain the tx is guaranteed to be at least confirmed — this prevents
  // the SDK's 30-second poll from timing out before finalization on mainnet.
  const builder = WebUploader(WebSolana)
    .withProvider(wallet)
    .withRpc(rpcUrl)
    .withTokenOptions({ finality: "confirmed" });
  return (devnet ? await builder.devnet().build() : await builder.mainnet().build()) as IrysInstance;
}

async function ensureFunded(irys: IrysInstance, bytes: number) {
  const price = await irys.getPrice(bytes);
  const balance = await irys.getBalance();
  if (!balance.lt(price)) return;
  const priceBn = BigInt(price.toString());
  const balanceBn = BigInt(balance.toString());
  const deficit = priceBn > balanceBn ? priceBn - balanceBn : 0n;
  const toFund = deficit + deficit / 10n + 1n;
  await irys.fund(toFund.toString());
}

/** Upload bytes permanently to Arweave; Phantom signs fund tx + upload message. */
export async function uploadWithPhantom(
  irys: IrysInstance,
  data: Uint8Array,
  contentType: string,
): Promise<string> {
  await ensureFunded(irys, data.length);
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
  rpcUrl: string;
  devnet: boolean;
}): Promise<{ imageUri: string; metadataUri: string }> {
  const irys = await createPhantomIrysUploader(params.rpcUrl, params.devnet);

  const imageUri = await uploadWithPhantom(irys, params.imageBytes, params.imageContentType);
  const metadataUri = await uploadWithPhantom(
    irys,
    new TextEncoder().encode(params.buildMetadata(imageUri)),
    "application/json",
  );

  return { imageUri, metadataUri };
}
