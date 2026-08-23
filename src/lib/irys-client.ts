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

/** Minimal adapter expected by @irys/web-upload-solana injected signer. */
export function phantomToIrysWallet(phantom: PhantomLike) {
  if (!phantom.publicKey) throw new Error("Connect Phantom first.");
  return {
    publicKey: phantom.publicKey,
    sendTransaction: async (
      tx: unknown,
      connection: { confirmTransaction?: unknown },
      opts?: { skipPreflight?: boolean },
    ) => {
      void connection;
      const result = await phantom.signAndSendTransaction(tx, {
        skipPreflight: opts?.skipPreflight ?? true,
      });
      if (typeof result.signature === "string") return result.signature;
      // Irys expects a base58 tx id string
      const ALPHA = "123456789ABCDEFGHJKLMNPQRSTUVWXYZabcdefghijkmnopqrstuvwxyz";
      const bytes = result.signature;
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
  const builder = WebUploader(WebSolana).withProvider(wallet).withRpc(rpcUrl);
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
