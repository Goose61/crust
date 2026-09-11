import { getDb } from "./db";
import { getPlatformPublicKey } from "./platform-key";
import { getSolanaNetwork } from "./solana-config";
import { consumeSolSignature, verifySolPayment } from "./verify-payment";

type CollectionArweavePayment = {
  collectionId: string;
  signature: string;
  minSol: number;
  paidAt: Date;
};

export function isServerBulkArweaveAvailable(): boolean {
  return !!getPlatformPublicKey();
}

export async function isCollectionArweaveStoragePaid(collectionId: string): Promise<boolean> {
  const db = await getDb();
  const col = db.collection<CollectionArweavePayment>("collection_arweave_payments");
  const existing = await col.findOne({ collectionId });
  return !!existing;
}

/** Verify a one-time SOL storage payment, or accept an already-recorded payment for this collection. */
export async function assertCollectionArweaveStoragePaid(params: {
  collectionId: string;
  paymentSignature?: string;
  minSol: number;
}): Promise<void> {
  const db = await getDb();
  const col = db.collection<CollectionArweavePayment>("collection_arweave_payments");
  await col.createIndex({ collectionId: 1 }, { unique: true, background: true });

  const existing = await col.findOne({ collectionId: params.collectionId });
  if (existing) return;

  const platform = getPlatformPublicKey();
  if (!platform) {
    throw new Error("Bulk Arweave upload is not available on this deployment.");
  }

  const signature = params.paymentSignature?.trim();
  if (!signature) {
    throw new Error("Approve the one-time storage payment in your wallet first.");
  }

  const verified = await verifySolPayment(
    signature,
    platform,
    params.minSol,
    getSolanaNetwork(),
  );
  if (!verified.ok) {
    throw new Error(verified.error ?? "Storage payment could not be verified");
  }

  const consumed = await consumeSolSignature(signature);
  if (!consumed.ok) {
    throw new Error(consumed.error ?? "Storage payment already used");
  }

  await col.insertOne({
    collectionId: params.collectionId,
    signature,
    minSol: params.minSol,
    paidAt: new Date(),
  });
}
