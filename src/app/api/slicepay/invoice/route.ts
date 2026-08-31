import { NextRequest, NextResponse } from "next/server";
import { rateLimit } from "@/lib/rate-limit";
import { storeInvoice, slicePayConfigured } from "@/lib/slicepay";

export async function POST(req: NextRequest) {
  const ip = req.headers.get("x-forwarded-for")?.split(",")[0] ?? "unknown";
  const rl = await rateLimit(`invoice:${ip}`, 20, 60 * 60 * 1000);
  if (!rl.allowed) {
    return NextResponse.json({ error: "Too many requests" }, { status: 429 });
  }

  const body = await req.json();
  const merchantId = process.env.SLICEPAY_MERCHANT_ID;
  const apiKey = process.env.SLICEPAY_API_KEY;
  const amountUsd = Number(body.amountUsd ?? 0);
  const orderId = String(body.orderId ?? `mint-${Date.now()}`);
  const description = String(body.description ?? "NFT mint");
  const redirectUrl = String(body.redirectUrl ?? "");
  const collectionId = body.collectionId ? String(body.collectionId) : undefined;
  const tokenId = body.tokenId != null ? Number(body.tokenId) : undefined;
  const payerWallet = body.payerWallet ? String(body.payerWallet) : undefined;
  const kind = body.kind === "secondary_buy" ? "secondary_buy" : "primary_mint";

  if (amountUsd <= 0) {
    return NextResponse.json({ error: "amountUsd must be greater than 0" }, { status: 400 });
  }

  if (merchantId && apiKey) {
    const res = await fetch("https://api.slicechain.io/api/gateway/create-invoice", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        merchantId,
        amountUsd,
        orderId,
        description,
        redirectUrl,
        apiKey,
      }),
    });
    const data = (await res.json()) as Record<string, unknown>;
    if (res.ok && data.invoiceId) {
      await storeInvoice({
        invoiceId: String(data.invoiceId),
        amountUsd,
        orderId,
        status: "waiting",
        collectionId,
        tokenId,
        payerWallet,
        kind,
      });
    }
    return NextResponse.json(
      {
        ...data,
        configured: true,
        checkoutUrl:
          data.checkoutUrl ??
          `https://pay.slicechain.io/?invoiceId=${encodeURIComponent(String(data.invoiceId ?? ""))}`,
      },
      { status: res.status },
    );
  }

  const invoiceId = `demo_${crypto.randomUUID()}`;
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
    checkoutUrl: `https://pay.slicechain.io/?invoiceId=${invoiceId}`,
    demo: true,
    configured: false,
    message:
      "SlicePay credentials not set. Demo invoice created. See .env.example for SLICEPAY_MERCHANT_ID and SLICEPAY_API_KEY.",
  });
}

/** GET — report whether SlicePay is configured (safe for client). */
export async function GET() {
  return NextResponse.json({
    configured: slicePayConfigured(),
    checkoutBase: "https://pay.slicechain.io",
  });
}
