import type { Collection, PendingMint } from "./types";

export function isListedPublicly(collection: Collection): boolean {
  return collection.status === "live" || collection.status === "sold_out";
}

export function tokenIsCommitted(token: { owner?: string | null; reservedBy?: string | null }): boolean {
  return Boolean(token.owner || token.reservedBy);
}

function toPublicPendingMint(pendingMint: PendingMint): PendingMint {
  const { assetSecretKeyB64: _secret, ...rest } = pendingMint;
  void _secret;
  return rest;
}

/** Strip server-only fields before any collection leaves the process. */
export function toPublicCollection(collection: Collection): Collection {
  const { pendingZipUrl: _zip, pendingMint, ...rest } = collection;
  void _zip;
  return {
    ...rest,
    ...(pendingMint ? { pendingMint: toPublicPendingMint(pendingMint) } : {}),
  };
}

export function filterCollectionsForViewer(
  collections: Collection[],
  wallet?: string,
): Collection[] {
  return collections
    .filter((c) => {
      if (isListedPublicly(c)) return true;
      if (!wallet) return false;
      return (
        c.payments.creatorWallet === wallet &&
        (c.status === "draft" || c.status === "importing")
      );
    })
    .map(toPublicCollection);
}
