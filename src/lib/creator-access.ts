export function isLaunchedCreatorCollection(
  collection: { status?: string; payments?: { creatorWallet?: string } },
  wallet: string | null | undefined,
): boolean {
  if (!wallet) return false;
  if (collection.payments?.creatorWallet !== wallet) return false;
  return collection.status === "live" || collection.status === "sold_out";
}
