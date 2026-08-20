import { NextRequest, NextResponse } from "next/server";

type Params = { params: Promise<{ invoiceId: string }> };

export async function GET(_req: NextRequest, { params }: Params) {
  const { invoiceId } = await params;
  if (process.env.SLICEPAY_MERCHANT_ID) {
    const res = await fetch(
      `https://api.slicechain.io/api/gateway/payment-status/${invoiceId}`,
    );
    const data = await res.json();
    return NextResponse.json(data, { status: res.status });
  }
  return NextResponse.json({
    invoiceId,
    status: "waiting",
    demo: true,
  });
}
