import { Connection, LAMPORTS_PER_SOL, PublicKey } from "@solana/web3.js";
import { getDb } from "./db";
import { getDirectRpcUrl, type SolanaNetwork } from "./solana-config";

type SpentSolSignature = {
  signature: string;
  spentAt: Date;
};

/** Verify a SOL transfer to the creator wallet meets the minimum amount. */
export async function verifySolPayment(
  signature: string,
  recipient: string,
  minSol: number,
  network: SolanaNetwork,
): Promise<{ ok: boolean; error?: string }> {
  if (!signature || !recipient) return { ok: false, error: "Missing payment proof" };
  const minLamports = Math.floor(minSol * LAMPORTS_PER_SOL * 0.98); // 2% slippage tolerance

  try {
    const connection = new Connection(getDirectRpcUrl(network), "confirmed");
    const tx = await connection.getParsedTransaction(signature, {
      maxSupportedTransactionVersion: 0,
    });
    if (!tx?.meta || tx.meta.err) {
      return { ok: false, error: "Transaction failed or not found" };
    }

    const recipientPk = new PublicKey(recipient);
    const accountKeys = tx.transaction.message.accountKeys.map((k) => k.pubkey.toBase58());
    const recipientIdx = accountKeys.indexOf(recipientPk.toBase58());
    if (recipientIdx < 0) {
      return { ok: false, error: "Recipient not in transaction" };
    }

    const pre = tx.meta.preBalances[recipientIdx] ?? 0;
    const post = tx.meta.postBalances[recipientIdx] ?? 0;
    const received = post - pre;
    if (received < minLamports) {
      return { ok: false, error: "Insufficient SOL received" };
    }
    return { ok: true };
  } catch (e) {
    const msg = e instanceof Error ? e.message : "Payment verification failed";
    return { ok: false, error: msg };
  }
}

/** Record a SOL payment signature as spent. Returns false if it was already used. */
export async function consumeSolSignature(
  signature: string,
): Promise<{ ok: boolean; error?: string }> {
  if (!signature) return { ok: false, error: "Missing payment proof" };
  const db = await getDb();
  const col = db.collection<SpentSolSignature>("spent_sol_signatures");
  await col.createIndex({ signature: 1 }, { unique: true, background: true });
  try {
    await col.insertOne({ signature, spentAt: new Date() });
    return { ok: true };
  } catch (e) {
    const msg = e instanceof Error ? e.message : "";
    if (msg.includes("E11000") || msg.toLowerCase().includes("duplicate")) {
      return { ok: false, error: "SOL payment already used" };
    }
    throw e;
  }
}
