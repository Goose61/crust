"use client";

import { isPaidStatus } from "@/lib/slicepay-shared";

/** Origins allowed for SlicePay checkout postMessage. */
export const SLICEPAY_ORIGINS = ["https://pay.slicechain.io"];

export function buildSlicePayReturnUrl(collectionId: string, tokenId: number): string {
  const base = `${window.location.origin}/collection/${collectionId}`;
  const params = new URLSearchParams({
    slicepay: "1",
    tokenId: String(tokenId),
  });
  return `${base}?${params.toString()}`;
}

/** Popup size from https://slicechain.io/website-pay-widget/ */
export function openSlicePayCheckout(checkoutUrl: string): Window | null {
  const popup = window.open(checkoutUrl, "slicepay", "width=480,height=820");
  if (!popup) {
    window.location.assign(checkoutUrl);
    return null;
  }
  return popup;
}

export function parseSlicePayReturnParams(search: string): {
  invoiceId: string | null;
  tokenId: number | null;
  status: string | null;
  orderId: string | null;
  tx: string | null;
} {
  const params = new URLSearchParams(search);
  const invoiceId = params.get("invoiceId") ?? params.get("invoice_id");
  const tokenIdRaw = params.get("tokenId") ?? params.get("token_id");
  const orderId = params.get("orderId") ?? params.get("order_id");
  const status = params.get("status") ?? params.get("paymentStatus");
  const tx = params.get("tx") ?? params.get("txSignature") ?? params.get("tx_signature");
  let tokenId = tokenIdRaw ? Number(tokenIdRaw) : null;
  if ((tokenId == null || Number.isNaN(tokenId)) && orderId) {
    const m = orderId.match(/(?:mint|secondary)-[^-]+-(\d+)-/);
    if (m) tokenId = Number(m[1]);
  }
  return {
    invoiceId,
    tokenId: tokenId != null && Number.isFinite(tokenId) ? tokenId : null,
    status,
    orderId,
    tx,
  };
}

export function isSlicePayPaidMessage(data: unknown): boolean {
  if (!data || typeof data !== "object") return false;
  const rec = data as Record<string, unknown>;
  if (rec.type === "slicepay:paid") return true;
  return isPaidStatus(String(rec.status ?? rec.paymentStatus ?? ""));
}

export function messageLooksPaid(data: unknown): boolean {
  return isSlicePayPaidMessage(data);
}

export function messageInvoiceId(data: unknown): string | null {
  if (!data || typeof data !== "object") return null;
  const rec = data as Record<string, unknown>;
  const id = rec.invoiceId ?? rec.invoice_id;
  return id != null ? String(id) : null;
}
