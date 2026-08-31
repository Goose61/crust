"use client";

import { isPaidStatus } from "@/lib/slicepay-shared";

export const SLICEPAY_ORIGINS = ["https://pay.slicechain.io", "https://slicechain.io"];

export function buildSlicePayReturnUrl(collectionId: string, tokenId: number): string {
  const base = `${window.location.origin}/collection/${collectionId}`;
  const params = new URLSearchParams({
    slicepay: "1",
    tokenId: String(tokenId),
  });
  return `${base}?${params.toString()}`;
}

export function openSlicePayCheckout(checkoutUrl: string): Window | null {
  return window.open(
    checkoutUrl,
    "slicepay_checkout",
    "width=520,height=720,scrollbars=yes,resizable=yes",
  );
}

export function parseSlicePayReturnParams(search: string): {
  invoiceId: string | null;
  tokenId: number | null;
  status: string | null;
} {
  const params = new URLSearchParams(search);
  const invoiceId = params.get("invoiceId") ?? params.get("invoice_id");
  const tokenIdRaw = params.get("tokenId") ?? params.get("token_id");
  const status = params.get("status") ?? params.get("paymentStatus");
  return {
    invoiceId,
    tokenId: tokenIdRaw ? Number(tokenIdRaw) : null,
    status,
  };
}

export function messageLooksPaid(data: unknown): boolean {
  if (!data || typeof data !== "object") return false;
  const rec = data as Record<string, unknown>;
  const status = String(rec.status ?? rec.paymentStatus ?? "");
  return isPaidStatus(status);
}

export function messageInvoiceId(data: unknown): string | null {
  if (!data || typeof data !== "object") return null;
  const rec = data as Record<string, unknown>;
  const id = rec.invoiceId ?? rec.invoice_id;
  return id != null ? String(id) : null;
}
