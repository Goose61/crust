/**
 * SlicePay hosted checkout — https://slicechain.io/website-pay-widget/
 *
 * merchantId is public (it is passed on checkout URLs and embed tags).
 * apiKey is optional and must stay server-side.
 */

export const SLICEPAY_CHECKOUT_ORIGIN = "https://pay.slicechain.io";
export const SLICEPAY_API_BASE = "https://api.slicechain.io/api/gateway";
export const SLICEPAY_EMBED_SCRIPT = "https://pay.slicechain.io/embed.js";

/** Ginger SlicePay business `_id` (dashboard / API). Override with SLICEPAY_MERCHANT_ID. */
export const SLICEPAY_DEFAULT_MERCHANT_ID = "6aac0279fa934d1d2f844cf4";

export function getSlicePayMerchantId(): string {
  return process.env.SLICEPAY_MERCHANT_ID?.trim() || SLICEPAY_DEFAULT_MERCHANT_ID;
}

export function getSlicePayApiKey(): string | undefined {
  return process.env.SLICEPAY_API_KEY?.trim() || undefined;
}

export function slicePayConfigured(): boolean {
  return getSlicePayMerchantId().length > 0;
}

export function slicePayCheckoutInvoiceUrl(invoiceId: string): string {
  const url = new URL(SLICEPAY_CHECKOUT_ORIGIN);
  url.searchParams.set("invoiceId", invoiceId);
  return url.toString();
}

/** Option B — hosted URL with cart params (amount can be edited in the browser). */
export function slicePayHostedCheckoutUrl(params: {
  merchantId: string;
  amountUsd: number;
  orderId: string;
  description: string;
  redirectUrl: string;
}): string {
  const url = new URL(SLICEPAY_CHECKOUT_ORIGIN);
  url.searchParams.set("merchantId", params.merchantId);
  url.searchParams.set("amount", params.amountUsd.toFixed(2));
  url.searchParams.set("orderId", params.orderId);
  if (params.description) url.searchParams.set("description", params.description.slice(0, 500));
  if (params.redirectUrl) url.searchParams.set("redirect", params.redirectUrl);
  return url.toString();
}

export function extractSlicePayInvoiceId(data: Record<string, unknown>): string | null {
  const nested = data.invoice;
  const nestedId =
    nested && typeof nested === "object"
      ? (nested as Record<string, unknown>).id ?? (nested as Record<string, unknown>).invoiceId
      : undefined;
  const id = data.invoiceId ?? data.publicInvoiceId ?? data.id ?? nestedId;
  return id != null && String(id).length > 0 ? String(id) : null;
}
