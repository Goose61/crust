import { buildAuthHeaders } from "@/lib/wallet-auth-client";
import { readJsonResponse } from "@/lib/fetch-json";
import type { Collection } from "@/lib/types";

export async function uploadCollectionLogo(
  collectionId: string,
  file: File,
  wallet: string,
): Promise<{ logoUrl: string; collection?: Collection }> {
  const headers = await buildAuthHeaders(wallet);
  const form = new FormData();
  form.append("file", file);
  const res = await fetch(`/api/collections/${encodeURIComponent(collectionId)}/logo`, {
    method: "POST",
    headers,
    body: form,
  });
  const data = await readJsonResponse<{
    logoUrl?: string;
    collection?: Collection;
    error?: string;
  }>(res);
  if (!res.ok || !data.logoUrl) {
    throw new Error(data.error ?? "Could not upload logo");
  }
  return { logoUrl: data.logoUrl, collection: data.collection };
}
