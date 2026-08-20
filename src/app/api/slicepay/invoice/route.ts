import { NextRequest, NextResponse } from "next/server";
import { rateLimit } from "@/lib/rate-limit";

const invoices = new Map<
  string,
  { amountUsd: number; orderId: string; status: string; createdAt: number }
>();

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
    const data = await res.json();
    return NextResponse.json(data, { status: res.status });
  }

  const invoiceId = `demo_${crypto.randomUUID()}`;
  invoices.set(invoiceId, {
    amountUsd,
    orderId,
    status: "waiting",
    createdAt: Date.now(),
  });
  return NextResponse.json({
    invoiceId,
    checkoutUrl: `https://pay.slicechain.io/?invoiceId=${invoiceId}`,
    demo: true,
    message:
      "SlicePay credentials not set. Demo invoice created. Add SLICEPAY_MERCHANT_ID and SLICEPAY_API_KEY to go live.",
  });
}
