import { NextRequest, NextResponse } from "next/server";
import {
  getStoredInvoice,
  isPaidStatus,
  markInvoicePaid,
  slicePayWebhookSecret,
  syncInvoiceStatus,
} from "@/lib/slicepay";

/**
 * SlicePay payment notification webhook.
 * Set SLICEPAY_WEBHOOK_SECRET and configure this URL in the SlicePay merchant dashboard:
 *   https://your-domain.com/api/slicepay/webhook
 */
export async function POST(req: NextRequest) {
  const secret = slicePayWebhookSecret();
  const headerSecret = req.headers.get("x-slicepay-secret") ?? req.headers.get("x-webhook-secret");
  if (secret && headerSecret !== secret) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  const body = (await req.json()) as {
    invoiceId?: string;
    status?: string;
    orderId?: string;
  };
  const invoiceId = String(body.invoiceId ?? "");
  if (!invoiceId) {
    return NextResponse.json({ error: "invoiceId required" }, { status: 400 });
  }

  const stored = await getStoredInvoice(invoiceId);
  if (!stored) {
    return NextResponse.json({ error: "Unknown invoice" }, { status: 404 });
  }

  if (isPaidStatus(body.status)) {
    await markInvoicePaid(invoiceId);
    return NextResponse.json({ ok: true, invoiceId, status: "paid" });
  }

  await syncInvoiceStatus(invoiceId);
  return NextResponse.json({ ok: true, invoiceId, status: body.status ?? "received" });
}
