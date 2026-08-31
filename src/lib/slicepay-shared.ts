export const PAID_STATUSES = new Set([
  "paid",
  "completed",
  "success",
  "confirmed",
  "succeeded",
]);

export function isPaidStatus(status: string | undefined | null): boolean {
  return PAID_STATUSES.has(String(status ?? "").toLowerCase());
}
