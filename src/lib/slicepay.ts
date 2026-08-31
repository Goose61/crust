import { getDb } from "./db";
import { isPaidStatus, PAID_STATUSES } from "./slicepay-shared";

export { isPaidStatus, PAID_STATUSES };

export type StoredInvoice = {
  invoiceId: string;
  amountUsd: number;
  orderId: string;
  status: string;
  collectionId?: string;
  tokenId?: number;
  payerWallet?: string;
  kind?: "primary_mint" | "secondary_buy";
  createdAt: Date;
  expiresAt: Date;
};

export async function storeInvoice(data: {
  invoiceId: string;
  amountUsd: number;
  orderId: string;
  status?: string;
  collectionId?: string;
  tokenId?: number;
  payerWallet?: string;
  kind?: StoredInvoice["kind"];
}): Promise<void> {
  const db = await getDb();
  const col = db.collection<StoredInvoice>("invoices");
  await col.createIndex({ invoiceId: 1 }, { unique: true, background: true });
  await col.createIndex({ expiresAt: 1 }, { expireAfterSeconds: 0, background: true });
  const now = Date.now();
  await col.updateOne(
    { invoiceId: data.invoiceId },
    {
      $set: {
        invoiceId: data.invoiceId,
        amountUsd: data.amountUsd,
        orderId: data.orderId,
        status: data.status ?? "waiting",
        collectionId: data.collectionId,
        tokenId: data.tokenId,
        payerWallet: data.payerWallet,
        kind: data.kind ?? "primary_mint",
        createdAt: new Date(now),
        expiresAt: new Date(now + 24 * 60 * 60 * 1000),
      },
    },
    { upsert: true },
  );
}

export async function getStoredInvoice(invoiceId: string): Promise<StoredInvoice | null> {
  const db = await getDb();
  const col = db.collection<StoredInvoice>("invoices");
  return col.findOne({ invoiceId });
}

export async function markInvoicePaid(invoiceId: string): Promise<void> {
  const db = await getDb();
  const col = db.collection<StoredInvoice>("invoices");
  await col.updateOne({ invoiceId }, { $set: { status: "paid" } });
}

export async function fetchSlicePayStatus(invoiceId: string): Promise<{
  status: string;
  amountUsd?: number;
  raw: Record<string, unknown>;
}> {
  const merchantId = process.env.SLICEPAY_MERCHANT_ID;
  if (!merchantId) {
    const stored = await getStoredInvoice(invoiceId);
    return {
      status: stored?.status ?? "waiting",
      amountUsd: stored?.amountUsd,
      raw: { demo: true },
    };
  }

  const res = await fetch(
    `https://api.slicechain.io/api/gateway/payment-status/${encodeURIComponent(invoiceId)}`,
  );
  if (!res.ok) {
    throw new Error("Could not fetch payment status");
  }
  const data = (await res.json()) as Record<string, unknown>;
  const status = String(data.status ?? data.paymentStatus ?? "waiting");
  const amountUsd =
    data.amountUsd != null
      ? Number(data.amountUsd)
      : data.amount != null
        ? Number(data.amount)
        : undefined;
  return { status, amountUsd, raw: data };
}

export async function verifySlicePayInvoice(
  invoiceId: string,
  expectedAmountUsd: number,
  expectedOrderPrefix: string,
): Promise<{ ok: boolean; error?: string }> {
  if (!invoiceId) return { ok: false, error: "invoiceId required" };

  const stored = await getStoredInvoice(invoiceId);
  if (stored) {
    if (!stored.orderId.startsWith(expectedOrderPrefix)) {
      return { ok: false, error: "Invoice order mismatch" };
    }
    if (Math.abs(stored.amountUsd - expectedAmountUsd) > 0.01) {
      return { ok: false, error: "Invoice amount mismatch" };
    }
    if (isPaidStatus(stored.status)) return { ok: true };
  }

  const merchantId = process.env.SLICEPAY_MERCHANT_ID;
  if (!merchantId) {
    if (!invoiceId.startsWith("demo_")) {
      return { ok: false, error: "Payment provider not configured" };
    }
    if (!stored) return { ok: false, error: "Unknown demo invoice" };
    await markInvoicePaid(invoiceId);
    return { ok: true };
  }

  try {
    const remote = await fetchSlicePayStatus(invoiceId);
    if (!isPaidStatus(remote.status)) {
      return { ok: false, error: "Payment not completed" };
    }
    if (
      remote.amountUsd != null &&
      Math.abs(Number(remote.amountUsd) - expectedAmountUsd) > 0.01
    ) {
      return { ok: false, error: "Paid amount mismatch" };
    }
    await markInvoicePaid(invoiceId);
    return { ok: true };
  } catch {
    return { ok: false, error: "Could not verify payment status" };
  }
}

export async function syncInvoiceStatus(invoiceId: string): Promise<StoredInvoice | null> {
  const stored = await getStoredInvoice(invoiceId);
  if (!stored) return null;
  if (isPaidStatus(stored.status)) return stored;

  try {
    const remote = await fetchSlicePayStatus(invoiceId);
    if (isPaidStatus(remote.status)) {
      await markInvoicePaid(invoiceId);
      return { ...stored, status: "paid" };
    }
    return { ...stored, status: remote.status };
  } catch {
    return stored;
  }
}

export function slicePayConfigured(): boolean {
  return !!(process.env.SLICEPAY_MERCHANT_ID && process.env.SLICEPAY_API_KEY);
}

export function slicePayWebhookSecret(): string | undefined {
  return process.env.SLICEPAY_WEBHOOK_SECRET;
}
