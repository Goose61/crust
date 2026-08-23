/**
 * Irys / Arweave upload helpers.
 *
 * Uses the platform key (ARWEAVE_SOLANA_KEY) so the platform absorbs storage
 * cost (~$0.001 per typical NFT image). The minter only pays Solana chain fees.
 *
 * Lazy-funding: checks current Irys balance before uploading and tops it up
 * just enough for each upload so the platform wallet is never over-committed.
 */

export const IRYS_NODE_MAINNET = "https://uploader.irys.xyz";
export const IRYS_NODE_DEVNET = "https://devnet.irys.xyz";
export const IRYS_GATEWAY = "https://gateway.irys.xyz";

function irysNode(): string {
  return process.env.SOLANA_RPC_URL?.includes("devnet")
    ? IRYS_NODE_DEVNET
    : IRYS_NODE_MAINNET;
}

/**
 * Fetch the upload cost in lamports for a given number of bytes.
 * Uses the Irys REST pricing endpoint — no SDK required.
 * Returns 0 on network error so callers can fall back gracefully.
 */
export async function getIrysPrice(bytes: number): Promise<bigint> {
  try {
    const res = await fetch(`${irysNode()}/price/solana/${bytes}`, {
      // short timeout so the estimate endpoint stays snappy
      signal: AbortSignal.timeout(4_000),
    });
    if (!res.ok) return BigInt(0);
    const text = await res.text();
    return BigInt(text.trim());
  } catch {
    return BigInt(0);
  }
}

/**
 * Upload a buffer to Arweave via Irys and return the permanent gateway URL.
 *
 * Lazy-funding pattern (from official Irys docs):
 *   1. Get price for the data size
 *   2. Check current balance
 *   3. Fund only the deficit (price − balance), multiplied by 1.1 as buffer
 *   4. Upload
 *
 * Falls back to Vercel Blob if ARWEAVE_SOLANA_KEY is not configured.
 */
export async function uploadToIrys(
  buf: Buffer,
  contentType: string,
): Promise<string | null> {
  const key = process.env.ARWEAVE_SOLANA_KEY;
  if (!key) return null;

  const rpcUrl =
    process.env.SOLANA_RPC_URL ?? "https://api.mainnet-beta.solana.com";
  const node = irysNode();

  // Dynamic imports — keeps these heavy packages out of the client bundle
  const [uploadMod, solanaMod] = await Promise.all([
    import(/* webpackIgnore: true */ "@irys/upload"),
    import(/* webpackIgnore: true */ "@irys/upload-solana"),
  ]);

  const { Uploader } = uploadMod;
  const Solana = solanaMod.Solana ?? solanaMod.default;

  const irys = await Uploader(Solana)
    .withWallet(key)
    .withRpc(rpcUrl)
    // Point to the correct node
    .withIrys({ url: node });

  // Lazy-fund: only top up when balance is insufficient
  const price = await irys.getPrice(buf.length);
  const balance = await irys.getBalance();
  if (balance.lt(price)) {
    // Overfund slightly (×1.1) to absorb minor price fluctuations
    const deficit = price.minus(balance).multipliedBy(1.1).integerValue();
    await irys.fund(deficit);
  }

  const receipt = await irys.upload(buf, {
    tags: [{ name: "Content-Type", value: contentType }],
  });

  return `${IRYS_GATEWAY}/${receipt.id}`;
}
