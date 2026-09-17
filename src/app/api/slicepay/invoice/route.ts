import { NextRequest, NextResponse } from "next/server";
import { rateLimit } from "@/lib/rate-limit";
import { storeInvoice, slicePayConfigured } from "@/lib/slicepay";
import {
  extractSlicePayInvoiceId,
  getSlicePayApiKey,
  getSlicePayMerchantId,
  SLICEPAY_API_BASE,
  slicePayCheckoutInvoiceUrl,
  slicePayHostedCheckoutUrl,
} from "@/lib/slicepay-config";

export async function POST(req: NextRequest) {
  const ip = req.headers.get("x-forwarded-for")?.split(",")[0] ?? "unknown";
  const rl = await rateLimit(`invoice:${ip}`, 20, 60 * 60 * 1000);
  if (!rl.allowed) {
    return NextResponse.json({ error: "Too many requests" }, { status: 429 });
  }

  const body = await req.json();
  const merchantId = getSlicePayMerchantId();
  const apiKey = getSlicePayApiKey();
  const amountUsd = Number(body.amountUsd ?? 0);
  const orderId = String(body.orderId ?? `mint-${Date.now()}`).slice(0, 128);
  const description = String(body.description ?? "NFT mint").slice(0, 500);
  const redirectUrl = String(body.redirectUrl ?? "");
  const collectionId = body.collectionId ? String(body.collectionId) : undefined;
  const tokenId = body.tokenId != null ? Number(body.tokenId) : undefined;
  const payerWallet = body.payerWallet ? String(body.payerWallet) : undefined;
  const kind = body.kind === "secondary_buy" ? "secondary_buy" : "primary_mint";

  if (!(amountUsd >= 0.01)) {
    return NextResponse.json({ error: "amountUsd must be at least $0.01" }, { status: 400 });
  }
  if (!merchantId) {
    return NextResponse.json({ error: "SlicePay merchant ID is not configured" }, { status: 503 });
  }

  const hostedUrl = slicePayHostedCheckoutUrl({
    merchantId,
    amountUsd,
    orderId,
    description,
    redirectUrl,
  });

  const invoicePayload: Record<string, unknown> = {
    merchantId,
    amountUsd,
    amount: amountUsd,
    orderId,
    description,
    redirectUrl,
  };
  if (apiKey) invoicePayload.apiKey = apiKey;

  try {
    const headers: Record<string, string> = { "Content-Type": "application/json" };
    if (apiKey) headers.Authorization = `Bearer ${apiKey}`;
    const res = await fetch(`${SLICEPAY_API_BASE}/create-invoice`, {
      method: "POST",
      headers,
      body: JSON.stringify(invoicePayload),
    });
    const data = (await res.json().catch(() => ({}))) as Record<string, unknown>;
    const invoiceId = extractSlicePayInvoiceId(data);
    if (res.ok && invoiceId) {
      await storeInvoice({
        invoiceId,
        amountUsd,
        orderId,
        status: "waiting",
        collectionId,
        tokenId,
        payerWallet,
        kind,
      });
      return NextResponse.json({
        invoiceId,
        configured: true,
        checkoutUrl:
          typeof data.checkoutUrl === "string" && data.checkoutUrl
            ? data.checkoutUrl
            : slicePayCheckoutInvoiceUrl(invoiceId),
      });
    }
    console.error("[slicepay] create-invoice failed, using hosted checkout", res.status, data);
  } catch (err) {
    console.error("[slicepay] create-invoice error, using hosted checkout", err);
  }

  await storeInvoice({
    invoiceId: `order:${orderId}`,
    amountUsd,
    orderId,
    status: "waiting",
    collectionId,
    tokenId,
    payerWallet,
    kind,
  });

  return NextResponse.json({
    orderId,
    configured: true,
    checkoutUrl: hostedUrl,
  });
}

/** GET — report whether SlicePay is configured (safe for client). */
export async function GET() {
  return NextResponse.json({
    configured: slicePayConfigured(),
    checkoutBase: "https://pay.slicechain.io",
  });
}
