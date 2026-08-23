/**
 * Server-side Metaplex Core NFT minting helper.
 *
 * Uses ARWEAVE_SOLANA_KEY (base58 64-byte keypair) as the minting authority.
 * Mints directly to the recipient wallet in a single transaction.
 *
 * If ARWEAVE_SOLANA_KEY is not set this returns null (demo / staging mode).
 */

export type MintResult = {
  assetAddress: string;
  txSignature: string;
  explorerUrl: string;
  network: "mainnet-beta" | "devnet";
};

/** Decode a base58 string into raw bytes (no external dependency). */
function decodeBase58(b58: string): Uint8Array {
  const ALPHA = "123456789ABCDEFGHJKLMNPQRSTUVWXYZabcdefghijkmnopqrstuvwxyz";
  const bytes: number[] = [0];
  for (const char of b58) {
    const idx = ALPHA.indexOf(char);
    if (idx < 0) throw new Error(`Invalid base58 character: "${char}"`);
    let carry = idx;
    for (let i = 0; i < bytes.length; i++) {
      carry += bytes[i] * 58;
      bytes[i] = carry & 0xff;
      carry >>= 8;
    }
    while (carry > 0) {
      bytes.push(carry & 0xff);
      carry >>= 8;
    }
  }
  // Leading '1's → leading zero bytes
  for (let i = 0; b58[i] === "1"; i++) bytes.push(0);
  return new Uint8Array(bytes.reverse());
}

/** Encode raw bytes as a base58 string (for tx signature display). */
function encodeBase58(bytes: Uint8Array): string {
  const ALPHA = "123456789ABCDEFGHJKLMNPQRSTUVWXYZabcdefghijkmnopqrstuvwxyz";
  const digits: number[] = [0];
  for (const byte of bytes) {
    let carry = byte;
    for (let i = 0; i < digits.length; i++) {
      carry += digits[i] << 8;
      digits[i] = carry % 58;
      carry = Math.floor(carry / 58);
    }
    while (carry > 0) {
      digits.push(carry % 58);
      carry = Math.floor(carry / 58);
    }
  }
  let result = "";
  for (let i = 0; i < bytes.length && bytes[i] === 0; i++) result += "1";
  return result + digits.reverse().map((d) => ALPHA[d]).join("");
}

/**
 * Mint a Metaplex Core NFT directly to `recipient`.
 *
 * @param name       NFT name shown in wallets / explorers
 * @param metadataUri Permanent URI of the off-chain metadata JSON (Arweave / Blob)
 * @param recipient  Solana wallet address of the intended owner
 * @returns MintResult on success, null when the platform key is not configured
 */
export async function mintGiftNft(params: {
  name: string;
  metadataUri: string;
  recipient: string;
}): Promise<MintResult | null> {
  const rawKey = process.env.ARWEAVE_SOLANA_KEY;
  if (!rawKey) return null; // demo / staging mode — no on-chain action

  const rpcUrl =
    process.env.SOLANA_RPC_URL ?? "https://api.mainnet-beta.solana.com";
  const network: MintResult["network"] = rpcUrl.includes("devnet")
    ? "devnet"
    : "mainnet-beta";

  // Dynamic imports — keeps these heavy ESM packages out of the client bundle
  const [umiBundle, mplCoreMod, umiCore] = await Promise.all([
    import(/* webpackIgnore: true */ "@metaplex-foundation/umi-bundle-defaults"),
    import(/* webpackIgnore: true */ "@metaplex-foundation/mpl-core"),
    import(/* webpackIgnore: true */ "@metaplex-foundation/umi"),
  ]);

  const { createUmi } = umiBundle;
  const { mplCore, create } = mplCoreMod;
  const { keypairIdentity, generateSigner, publicKey: umiPublicKey } = umiCore;

  // Build UMI instance
  const umi = createUmi(rpcUrl).use(mplCore());

  // Load creator keypair from base58 private key
  const secretBytes = decodeBase58(rawKey);
  if (secretBytes.length !== 64) {
    throw new Error(
      `ARWEAVE_SOLANA_KEY decoded to ${secretBytes.length} bytes; expected 64. ` +
        "Re-run setup-arweave-key.mjs to regenerate it.",
    );
  }
  const creatorKeypair = umi.eddsa.createKeypairFromSecretKey(secretBytes);
  umi.use(keypairIdentity(creatorKeypair));

  // Generate a fresh keypair for the asset account
  const assetSigner = generateSigner(umi);

  // Create the Core NFT asset, minting directly to recipient
  const tx = await create(umi, {
    asset: assetSigner,
    name: params.name,
    uri: params.metadataUri,
    owner: umiPublicKey(params.recipient),
  }).sendAndConfirm(umi, {
    confirm: { commitment: "confirmed" },
  });

  const sig = encodeBase58(tx.signature);
  const cluster = network === "devnet" ? "?cluster=devnet" : "";
  const explorerUrl = `https://explorer.solana.com/tx/${sig}${cluster}`;

  return {
    assetAddress: assetSigner.publicKey.toString(),
    txSignature: sig,
    explorerUrl,
    network,
  };
}

/**
 * Lightweight Solana address validator — no network call needed.
 * A valid address is a 32-byte value encoded as base58 (32–44 chars).
 */
export function isValidSolanaAddress(addr: string): boolean {
  if (!addr || addr.length < 32 || addr.length > 44) return false;
  const VALID = /^[1-9A-HJ-NP-Za-km-z]+$/;
  if (!VALID.test(addr)) return false;
  try {
    const bytes = decodeBase58(addr);
    return bytes.length === 32;
  } catch {
    return false;
  }
}
