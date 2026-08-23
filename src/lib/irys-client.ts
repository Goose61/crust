/**
 * Client-side Irys / Arweave upload helpers.
 *
 * The minter pays all storage costs. Browser wallets never expose a private
 * key, so we:
 *   1. Generate a short-lived ephemeral keypair in the browser
 *   2. Have the minter transfer SOL to it via Phantom
 *   3. Use the ephemeral key with @irys/web-upload to fund + upload
 *
 * Reference: https://docs.irys.xyz/onchain-storage/fund (lazy-funding pattern)
 */

import { IRYS_GATEWAY } from "./irys-shared";

export { IRYS_GATEWAY };

/** Encode a 64-byte Solana secret key as base58 (Irys wallet format). */
export function secretKeyToBase58(secretKey: Uint8Array): string {
  const ALPHA = "123456789ABCDEFGHJKLMNPQRSTUVWXYZabcdefghijkmnopqrstuvwxyz";
  let zeros = 0;
  while (zeros < secretKey.length && secretKey[zeros] === 0) zeros++;
  const digits: number[] = [0];
  for (let i = zeros; i < secretKey.length; i++) {
    let carry = secretKey[i];
    for (let j = 0; j < digits.length; j++) {
      carry += digits[j] << 8;
      digits[j] = carry % 58;
      carry = Math.floor(carry / 58);
    }
    while (carry > 0) { digits.push(carry % 58); carry = Math.floor(carry / 58); }
  }
  return "1".repeat(zeros) + digits.reverse().map((d) => ALPHA[d]).join("");
}

type WebIrys = {
  getPrice: (bytes: number) => Promise<{ toString(): string }>;
  getBalance: () => Promise<{ toString(): string; lt: (v: unknown) => boolean }>;
  fund: (amount: unknown) => Promise<unknown>;
  upload: (
    data: string | Buffer | Uint8Array,
    opts: { tags: { name: string; value: string }[] },
  ) => Promise<{ id: string }>;
};

/** Build an Irys web uploader backed by an ephemeral base58 secret key. */
export async function createBrowserIrysUploader(
  secretKeyB58: string,
  rpcUrl: string,
  devnet: boolean,
): Promise<WebIrys> {
  const [{ WebUploader }, { Solana }] = await Promise.all([
    import("@irys/web-upload"),
    import("@irys/upload-solana"),
  ]);

  const builder = WebUploader(Solana)
    .withProvider(secretKeyB58)
    .withRpc(rpcUrl);

  const irys = devnet ? await builder.devnet().build() : await builder.mainnet().build();
  return irys as unknown as WebIrys;
}

/**
 * Lazy-fund the Irys node (if needed) then upload.
 * The ephemeral wallet must already hold enough SOL on-chain to cover funding.
 */
export async function fundAndUpload(
  irys: WebIrys,
  data: Uint8Array,
  contentType: string,
): Promise<string> {
  const price = await irys.getPrice(data.length);
  const balance = await irys.getBalance();

  if (balance.lt(price)) {
    const priceBn = BigInt(price.toString());
    const balanceBn = BigInt(balance.toString());
    const deficit = priceBn > balanceBn ? priceBn - balanceBn : 0n;
    // 10% buffer to absorb minor price fluctuations
    const toFund = deficit + deficit / 10n + 1n;
    await irys.fund(toFund.toString());
  }

  const receipt = await irys.upload(Buffer.from(data), {
    tags: [{ name: "Content-Type", value: contentType }],
  });
  return `${IRYS_GATEWAY}/${receipt.id}`;
}

/**
 * Upload gift image then metadata JSON to Arweave (single Irys session).
 */
export async function uploadGiftPair(params: {
  imageBytes: Uint8Array;
  imageContentType: string;
  metadataJson: string;
  secretKeyB58: string;
  rpcUrl: string;
  devnet: boolean;
}): Promise<{ imageUri: string; metadataUri: string }> {
  const irys = await createBrowserIrysUploader(
    params.secretKeyB58,
    params.rpcUrl,
    params.devnet,
  );

  const imageUri = await fundAndUpload(irys, params.imageBytes, params.imageContentType);
  const metadataUri = await fundAndUpload(
    irys,
    new TextEncoder().encode(params.metadataJson),
    "application/json",
  );

  return { imageUri, metadataUri };
}

/** Lamports the minter should send to the ephemeral wallet before uploading. */
export function ephemeralFundingLamports(
  imageLamports: bigint,
  metaLamports: bigint,
): bigint {
  const storage = imageLamports + metaLamports;
  // Buffer: 15% + 20 000 lamports for Irys fund tx fees on-chain
  return storage + storage / 6n + 20_000n;
}
