import { getDb } from "./db";
import { getPlatformWalletBalance } from "./platform-wallet-balance";
import { getPlatformPublicKey } from "./platform-key";
import { STORAGE_PAYMENT_MULTIPLIER } from "./storage-cost-constants";
import { getSolanaNetwork, type SolanaNetwork } from "./solana-config";
import { consumeSolSignature, verifySolPayment } from "./verify-payment";

type CollectionArweavePayment = {
  collectionId: string;
  signature: string;
  minSol: number;
  paidAt: Date;
  network: SolanaNetwork;
  /** Platform → Irys bundler fund tx (one per collection). */
  irysFundSignature?: string;
};

export async function getCollectionArweavePayment(
  collectionId: string,
): Promise<CollectionArweavePayment | null> {
  const db = await getDb();
  const col = db.collection<CollectionArweavePayment>("collection_arweave_payments");
  return col.findOne({ collectionId });
}

export async function getPaymentNetworkForCollection(
  collectionId: string,
): Promise<SolanaNetwork> {
  const payment = await getCollectionArweavePayment(collectionId);
  return payment?.network ?? getSolanaNetwork();
}

export async function markCollectionIrysFunded(
  collectionId: string,
  irysFundSignature: string,
): Promise<void> {
  const db = await getDb();
  const col = db.collection<CollectionArweavePayment>("collection_arweave_payments");
  await col.updateOne({ collectionId }, { $set: { irysFundSignature } });
}

export function isServerBulkArweaveAvailable(): boolean {
  return !!getPlatformPublicKey();
}

function minPaymentLamports(minSol: number): number {
  return Math.floor(minSol * 1e9 * 0.98 * STORAGE_PAYMENT_MULTIPLIER);
}

async function platformHasStorageFunds(
  network: SolanaNetwork,
  minSol: number,
): Promise<boolean> {
  const bal = await getPlatformWalletBalance(network);
  if (!bal) return false;
  return bal.onChainLamports >= BigInt(minPaymentLamports(minSol));
}

export async function isCollectionArweaveStoragePaid(collectionId: string): Promise<boolean> {
  const existing = await getCollectionArweavePayment(collectionId);
  if (!existing) return false;

  const serverNetwork = getSolanaNetwork();
  const paymentNetwork = existing.network ?? serverNetwork;
  if (paymentNetwork !== serverNetwork) return false;

  return platformHasStorageFunds(serverNetwork, existing.minSol);
}

/** Verify a one-time SOL storage payment, or accept an already-recorded payment for this collection. */
export async function assertCollectionArweaveStoragePaid(params: {
  collectionId: string;
  paymentSignature?: string;
  minSol: number;
  network?: SolanaNetwork;
}): Promise<void> {
  const db = await getDb();
  const col = db.collection<CollectionArweavePayment>("collection_arweave_payments");
  await col.createIndex({ collectionId: 1 }, { unique: true, background: true });

  const serverNetwork = params.network ?? getSolanaNetwork();
  const platform = getPlatformPublicKey();
  if (!platform) {
    throw new Error("Bulk upload is not available on this deployment.");
  }

  const existing = await col.findOne({ collectionId: params.collectionId });
  const signature = params.paymentSignature?.trim();

  if (existing) {
    const paidOn = existing.network ?? serverNetwork;
    if (paidOn !== serverNetwork) {
      if (!signature) {
        throw new Error(
          `Storage was paid on ${paidOn}, but this site runs on ${serverNetwork}. ` +
            `Switch Phantom to ${serverNetwork}, pay again at Go Live, or set SOLANA_NETWORK=${paidOn} on the server.`,
        );
      }
    } else if (await platformHasStorageFunds(serverNetwork, existing.minSol)) {
      return;
    } else if (!signature) {
      const bal = await getPlatformWalletBalance(serverNetwork);
      throw new Error(
        `Storage payment is recorded, but the platform wallet (${platform}) only has ` +
          `~${bal?.onChainSol.toFixed(4) ?? "0"} SOL on ${serverNetwork} ` +
          `(need ~${(minPaymentLamports(params.minSol) / 1e9).toFixed(4)} SOL). ` +
          `Your creator wallet balance is separate — pay storage again at Go Live so SOL reaches ${platform} on ${serverNetwork}.`,
      );
    }
  } else if (!signature) {
    throw new Error("Approve the one-time storage payment in your wallet first.");
  }

  if (!signature) {
    throw new Error("Approve the one-time storage payment in your wallet first.");
  }

  const verified = await verifySolPayment(signature, platform, params.minSol, serverNetwork);
  if (!verified.ok) {
    throw new Error(
      verified.error ??
        `Storage payment could not be verified on ${serverNetwork}. ` +
          `Ensure Phantom is on ${serverNetwork} and you sent SOL to ${platform}.`,
    );
  }

  const consumed = await consumeSolSignature(signature);
  if (!consumed.ok) {
    throw new Error(consumed.error ?? "Storage payment already used");
  }

  const record: CollectionArweavePayment = {
    collectionId: params.collectionId,
    signature,
    minSol: params.minSol,
    paidAt: new Date(),
    network: serverNetwork,
  };

  if (existing) {
    await col.replaceOne({ collectionId: params.collectionId }, record);
  } else {
    await col.insertOne(record);
  }
}
