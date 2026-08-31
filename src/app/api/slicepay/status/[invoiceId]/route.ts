import { NextRequest, NextResponse } from "next/server";
import {
  fetchSlicePayStatus,
  isPaidStatus,
  syncInvoiceStatus,
} from "@/lib/slicepay";

type Params = { params: Promise<{ invoiceId: string }> };

export async function GET(_req: NextRequest, { params }: Params) {
  const { invoiceId } = await params;
  const synced = await syncInvoiceStatus(invoiceId);
  if (synced) {
    return NextResponse.json({
      invoiceId,
      status: synced.status,
      amountUsd: synced.amountUsd,
      orderId: synced.orderId,
      collectionId: synced.collectionId,
      tokenId: synced.tokenId,
      paid: isPaidStatus(synced.status),
      demo: !process.env.SLICEPAY_MERCHANT_ID,
    });
  }

  if (process.env.SLICEPAY_MERCHANT_ID) {
    try {
      const remote = await fetchSlicePayStatus(invoiceId);
      return NextResponse.json({
        invoiceId,
        status: remote.status,
        amountUsd: remote.amountUsd,
        paid: isPaidStatus(remote.status),
      });
    } catch {
      return NextResponse.json({ error: "not found" }, { status: 404 });
    }
  }

  return NextResponse.json({
    invoiceId,
    status: "waiting",
    demo: true,
    paid: false,
  });
}
