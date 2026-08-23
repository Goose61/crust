/**
 * Server-side Metaplex Core NFT transaction builder.
 *
 * Builds a Core `create` transaction, partially signs it with the asset
 * keypair (server-side), and returns the serialized base64 string for the
 * minter's browser wallet to sign and submit.
 *
 * The user pays all Solana network fees (rent + protocol + tx fee).
 * The platform key is only used as the mint authority / update authority —
 * it does NOT pay chain fees.
 *
 * If ARWEAVE_SOLANA_KEY is not set the function returns null (demo mode).
 */

export type BuildTxResult = {
  /** Base64-encoded, partially-signed versioned transaction */
  txBase64: string;
  /** On-chain address that will be assigned to this NFT asset */
  assetAddress: string;
};

/** Lightweight Solana address validator — no network call required. */
export function isValidSolanaAddress(addr: string): boolean {
  if (!addr || addr.length < 32 || addr.length > 44) return false;
  if (!/^[1-9A-HJ-NP-Za-km-z]+$/.test(addr)) return false;
  try {
    const ALPHA = "123456789ABCDEFGHJKLMNPQRSTUVWXYZabcdefghijkmnopqrstuvwxyz";
    const bytes: number[] = [0];
    for (const char of addr) {
      const idx = ALPHA.indexOf(char);
      if (idx < 0) return false;
      let carry = idx;
      for (let i = 0; i < bytes.length; i++) {
        carry += bytes[i] * 58;
        bytes[i] = carry & 0xff;
        carry >>= 8;
      }
      while (carry > 0) { bytes.push(carry & 0xff); carry >>= 8; }
    }
    bytes.reverse();
    return bytes.length === 32;
  } catch {
    return false;
  }
}

/** Decode platform secret key — supports base58 string or JSON byte array. */
function parseSecretKey(raw: string): Uint8Array {
  const trimmed = raw.trim();
  if (trimmed.startsWith("[")) {
    const arr = JSON.parse(trimmed) as number[];
    if (!Array.isArray(arr) || arr.length !== 64) {
      throw new Error(`ARWEAVE_SOLANA_KEY JSON array must be 64 bytes; got ${arr?.length ?? 0}.`);
    }
    return new Uint8Array(arr);
  }
  const decoded = decodeBase58(trimmed);
  if (decoded.length !== 64) {
    throw new Error(
      `ARWEAVE_SOLANA_KEY decoded to ${decoded.length} bytes; expected 64.`,
    );
  }
  return decoded;
}

/** Decode a base58 string to a Uint8Array (no external dependency). */
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
    while (carry > 0) { bytes.push(carry & 0xff); carry >>= 8; }
  }
  for (let i = 0; b58[i] === "1"; i++) bytes.push(0);
  return new Uint8Array(bytes.reverse());
}

/**
 * Build a Metaplex Core NFT creation transaction.
 *
 * Architecture (per official Metaplex docs on partial signing):
 *   1. Platform keypair (ARWEAVE_SOLANA_KEY) acts as update authority.
 *   2. Asset keypair is generated server-side and partially signs here.
 *   3. User's pubkey is set as fee payer via a NoopSigner — the server
 *      does NOT sign on their behalf.
 *   4. Serialised base64 tx is returned; the browser wallet signs as
 *      fee payer and submits.
 *
 * @param params.name         NFT name (shown in wallets / explorers)
 * @param params.metadataUri  Permanent Arweave or Blob URI of metadata JSON
 * @param params.recipient    Wallet that receives the NFT
 * @param params.payer        Wallet that will pay Solana fees (the minter)
 */
export async function buildGiftTransaction(params: {
  name: string;
  metadataUri: string;
  recipient: string;
  payer: string;
}): Promise<BuildTxResult | null> {
  const rawKey = process.env.ARWEAVE_SOLANA_KEY;
  if (!rawKey) return null; // demo / staging mode

  const { getRpcUrl } = await import("./solana-config");
  const rpcUrl = getRpcUrl();

  // Dynamic imports keep ESM packages out of the client bundle
  const [umiBundle, mplCoreMod, umiCore, umiSerializers] = await Promise.all([
    import(/* webpackIgnore: true */ "@metaplex-foundation/umi-bundle-defaults"),
    import(/* webpackIgnore: true */ "@metaplex-foundation/mpl-core"),
    import(/* webpackIgnore: true */ "@metaplex-foundation/umi"),
    import(/* webpackIgnore: true */ "@metaplex-foundation/umi/serializers"),
  ]);

  const { createUmi } = umiBundle;
  const { mplCore, create } = mplCoreMod;
  const {
    keypairIdentity,
    generateSigner,
    createNoopSigner,
    publicKey: umiPublicKey,
  } = umiCore;
  const { base64 } = umiSerializers;

  // --- UMI instance ---
  const umi = createUmi(rpcUrl).use(mplCore());

  // Platform keypair is the update authority (never leaves the server)
  const secretBytes = parseSecretKey(rawKey);
  const authorityKeypair = umi.eddsa.createKeypairFromSecretKey(secretBytes);
  umi.use(keypairIdentity(authorityKeypair));

  // Asset keypair — signs the create instruction server-side
  const assetSigner = generateSigner(umi);

  // Fee payer = minter's browser wallet (NoopSigner — signs nothing here)
  // Per Metaplex docs: NoopSigner lets UMI build the tx without the payer
  // signing; the payer completes the signature in the browser.
  const payerNoop = createNoopSigner(umiPublicKey(params.payer));

  // Build and partially sign:
  //   • authorityKeypair signs as identity (update authority)
  //   • assetSigner signs its own account creation
  //   • payerNoop is a placeholder — browser wallet adds the final signature
  const tx = await create(umi, {
    asset: assetSigner,
    name: params.name,
    uri: params.metadataUri,
    owner: umiPublicKey(params.recipient),
    payer: payerNoop, // minter pays chain fees
  })
    .useV0() // versioned tx — required for Phantom signAndSendTransaction
    .setBlockhash(await umi.rpc.getLatestBlockhash())
    .buildAndSign(umi);

  // Serialize → base64 string for the frontend
  const serialized = umi.transactions.serialize(tx);
  const txBase64 = base64.deserialize(serialized)[0];

  return {
    txBase64,
    assetAddress: assetSigner.publicKey.toString(),
  };
}
