import type { Collection, PendingMint } from "./types";

/** Fill missing pending-mint fields from the collection token snapshot. */
export function resolvePendingMint(collection: Collection, payer: string): PendingMint {
  const pm = collection.pendingMint;
  if (!pm) {
    throw new Error("No pending mint for this collection — rebuild the mint transaction.");
  }

  const tokenId = pm.tokenId ?? collection.tokens[0]?.tokenId;
  const token =
    tokenId != null
      ? collection.tokens.find((t) => t.tokenId === tokenId)
      : collection.tokens[0];

  if (pm.name && pm.metadataUri && pm.recipient && pm.payer) {
    return { ...pm, tokenId: token?.tokenId ?? pm.tokenId };
  }

  if (!token?.metadataUri || !token.owner) {
    throw new Error("Collection is missing token metadata for mint refresh.");
  }

  return {
    ...pm,
    tokenId: token.tokenId,
    name: pm.name ?? `${collection.name} #${token.tokenId}`,
    metadataUri: pm.metadataUri ?? token.metadataUri,
    recipient: pm.recipient ?? token.owner,
    payer: pm.payer ?? payer,
  };
}
