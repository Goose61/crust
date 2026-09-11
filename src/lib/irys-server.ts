import { randomBytes } from "crypto";
import { getPlatformSecretKey } from "./platform-key";
import {
  IRYS_GATEWAY,
  IRYS_NODE_DEVNET,
  IRYS_NODE_MAINNET,
  fetchIrysAccountBalanceLamports,
  fetchIrysPriceLamports,
} from "./irys-shared";
import { getDirectRpcUrl, getSolanaNetwork, isDevnetNetwork } from "./solana-config";

type IrysSigner = {
  publicKey: Buffer;
  sign: (message: Uint8Array) => Promise<Uint8Array>;
};

type DataItemLike = {
  sign: (signer: IrysSigner) => Promise<string>;
  getRaw: () => Buffer;
};

let signerPromise: Promise<IrysSigner> | null = null;

export function isServerArweaveUploadAvailable(): boolean {
  return !!getPlatformSecretKey();
}

function irysNodeUrl(): string {
  return isDevnetNetwork(getSolanaNetwork()) ? IRYS_NODE_DEVNET : IRYS_NODE_MAINNET;
}

async function loadBundles() {
  return import("@irys/bundles");
}

async function getIrysSigner(): Promise<IrysSigner> {
  if (!signerPromise) {
    signerPromise = (async () => {
      const secret = getPlatformSecretKey();
      if (!secret) {
        throw new Error(
          "Server Arweave upload is not configured (ARWEAVE_SOLANA_KEY). Contact support.",
        );
      }
      const { Keypair } = await import("@solana/web3.js");
      const bundles = await loadBundles();
      const keypair = Keypair.fromSecretKey(secret);
      const keyBytes = Buffer.concat([Buffer.from(keypair.secretKey), keypair.publicKey.toBuffer()]);
      const bs58 = (await import("bs58")).default as { encode: (buf: Buffer) => string };
      return new bundles.HexSolanaSigner(bs58.encode(keyBytes)) as IrysSigner;
    })();
  }
  return signerPromise;
}

async function signerAddress(): Promise<string> {
  const secret = getPlatformSecretKey();
  if (!secret) throw new Error("Missing ARWEAVE_SOLANA_KEY");
  const { Keypair } = await import("@solana/web3.js");
  return Keypair.fromSecretKey(secret).publicKey.toBase58();
}

async function fetchBundlerAddress(node: string): Promise<string> {
  const res = await fetch(`${node}/info`);
  if (!res.ok) throw new Error(`Could not reach Irys (${res.status})`);
  const info = (await res.json()) as { addresses?: { solana?: string } };
  const address = info.addresses?.solana;
  if (!address) throw new Error("Irys bundler address not found");
  return address;
}

async function submitFundTxToBundler(txId: string, node: string): Promise<void> {
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
    await new Promise((r) => setTimeout(r, 2000 + attempt * 250));
  }
  throw new Error(`Bundler could not confirm fund tx ${txId}: ${lastError}`);
}

async function fundIrysAccount(bytesNeeded: number): Promise<void> {
  const node = irysNodeUrl();
  const address = await signerAddress();
  const devnet = isDevnetNetwork(getSolanaNetwork());
  const price = await fetchIrysPriceLamports(bytesNeeded, devnet);
  const balance = await fetchIrysAccountBalanceLamports(address, devnet);
  if (balance >= price) return;

  const deficit = price > balance ? price - balance : 0n;
  const toFund = deficit + deficit / 10n + 1n;
  const bundlerAddress = await fetchBundlerAddress(node);

  const { Connection, Keypair, PublicKey, SystemProgram, Transaction } = await import(
    "@solana/web3.js"
  );
  const secret = getPlatformSecretKey();
  if (!secret) throw new Error("Missing ARWEAVE_SOLANA_KEY");
  const keypair = Keypair.fromSecretKey(secret);
  const connection = new Connection(getDirectRpcUrl(getSolanaNetwork()), "confirmed");
  const { blockhash, lastValidBlockHeight } = await connection.getLatestBlockhash("confirmed");

  const tx = new Transaction({ feePayer: keypair.publicKey, blockhash, lastValidBlockHeight });
  tx.add(
    SystemProgram.transfer({
      fromPubkey: keypair.publicKey,
      toPubkey: new PublicKey(bundlerAddress),
      lamports: Number(toFund),
    }),
  );
  tx.sign(keypair);
  const sig = await connection.sendRawTransaction(tx.serialize(), {
    skipPreflight: false,
    preflightCommitment: "confirmed",
  });
  const confirmation = await connection.confirmTransaction(
    { signature: sig, blockhash, lastValidBlockHeight },
    "confirmed",
  );
  if (confirmation.value.err) {
    throw new Error("Platform Irys fund transaction failed on-chain");
  }

  await submitFundTxToBundler(sig, node);
}

async function postSignedDataItem(raw: Buffer): Promise<string> {
  const node = irysNodeUrl();
  const res = await fetch(`${node}/tx/solana`, {
    method: "POST",
    headers: { "Content-Type": "application/octet-stream" },
    body: new Uint8Array(raw),
  });

  const bodyText = await res.text();
  if (res.status === 402) {
    throw new Error(`Irys account underfunded: ${bodyText}`);
  }
  if (res.status === 201) {
    throw new Error(bodyText || "Irys rejected upload");
  }
  if (!res.ok) {
    throw new Error(`Irys upload failed (${res.status}): ${bodyText}`);
  }

  try {
    const parsed = JSON.parse(bodyText) as { id?: string; tx?: { id?: string } };
    const id = parsed.id ?? parsed.tx?.id;
    if (id) return id;
  } catch {
    // fall through — use signed item id
  }
  throw new Error("Irys upload succeeded but no transaction id was returned");
}

async function buildSignedDataItem(
  data: Buffer,
  contentType: string,
): Promise<{ item: DataItemLike; id: string }> {
  const bundles = await loadBundles();
  const signer = await getIrysSigner();
  const item = bundles.createData(data, signer as never, {
    tags: [{ name: "Content-Type", value: contentType }],
    anchor: randomBytes(32).toString("base64").slice(0, 32),
  }) as unknown as DataItemLike;
  const id = String(await item.sign(signer));
  return { item, id };
}

/** Upload to Arweave via platform Irys wallet — no browser wallet signatures. */
export async function uploadToArweaveServer(
  data: Buffer,
  contentType: string,
): Promise<string> {
  await fundIrysAccount(data.length + 512);
  const { item, id } = await buildSignedDataItem(data, contentType);
  try {
    const postedId = await postSignedDataItem(item.getRaw());
    return `${IRYS_GATEWAY}/${postedId || id}`;
  } catch (err) {
    if (id) return `${IRYS_GATEWAY}/${id}`;
    throw err;
  }
}
