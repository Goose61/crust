import { buildTokenMetadataJson } from "@/lib/metadata-builders";
import { buildAuthHeaders } from "@/lib/wallet-auth-client";
import { readJsonResponse } from "@/lib/fetch-json";
import type { Collection, GeneratedToken, LayerCatalog, MetadataCreator, RoyaltySplit } from "@/lib/types";

export const TOKEN_IMPORT_BATCH_SIZE = 75;

export function newClientCollectionId(): string {
  return crypto.randomUUID();
}

export async function postImportDraft(
  wallet: string,
  body: {
    id?: string;
    mode: "ready" | "layers";
    name: string;
    description?: string;
    tokens?: GeneratedToken[];
    layers?: LayerCatalog[];
    stackOrder?: string[];
    sidecarJsonCount?: number;
    supply?: number;
  },
  authHeaders?: Record<string, string>,
): Promise<Collection> {
  const headers = {
    "Content-Type": "application/json",
    ...(authHeaders ?? (await buildAuthHeaders(wallet))),
  };
  const res = await fetch("/api/collections/import-draft", {
    method: "POST",
    headers,
    body: JSON.stringify(body),
  });
  const data = await readJsonResponse<{ collection: Collection; error?: string }>(res);
  if (!res.ok) throw new Error(data.error || "Could not save draft");
  return data.collection;
}

export async function importTokenBatch(
  wallet: string,
  collectionId: string,
  tokens: GeneratedToken[],
  options: {
    finalize?: boolean;
    sidecarJsonCount?: number;
    authHeaders?: Record<string, string>;
  } = {},
): Promise<Collection> {
  const headers = {
    "Content-Type": "application/json",
    ...(options.authHeaders ?? (await buildAuthHeaders(wallet))),
  };
  const res = await fetch(`/api/collections/${collectionId}/import-tokens`, {
    method: "POST",
    headers,
    body: JSON.stringify({
      tokens,
      finalize: options.finalize,
      sidecarJsonCount: options.sidecarJsonCount,
    }),
  });
  const data = await readJsonResponse<{ collection: Collection; error?: string }>(res);
  if (!res.ok) throw new Error(data.error || "Could not save token batch");
  return data.collection;
}

/** Create draft stub then upload tokens in batches (avoids Vercel body-size limits). */
export async function postImportDraftWithTokens(
  wallet: string,
  params: {
    id: string;
    name: string;
    tokens: GeneratedToken[];
    sidecarJsonCount: number;
    onBatchProgress?: (done: number, total: number) => void;
  },
  authHeaders?: Record<string, string>,
): Promise<Collection> {
  const headers = authHeaders ?? (await buildAuthHeaders(wallet));
  let col = await postImportDraft(
    wallet,
    {
      id: params.id,
      mode: "ready",
      name: params.name,
      supply: params.tokens.length,
      sidecarJsonCount: params.sidecarJsonCount,
    },
    headers,
  );

  const total = params.tokens.length;
  for (let i = 0; i < total; i += TOKEN_IMPORT_BATCH_SIZE) {
    const batch = params.tokens.slice(i, i + TOKEN_IMPORT_BATCH_SIZE);
    const finalize = i + batch.length >= total;
    col = await importTokenBatch(wallet, params.id, batch, {
      finalize,
      sidecarJsonCount: params.sidecarJsonCount,
      authHeaders: headers,
    });
    params.onBatchProgress?.(Math.min(i + batch.length, total), total);
  }
  return col;
}

export async function patchCollectionUris(
  wallet: string,
  collectionId: string,
  payload: {
    tokens: { tokenId: number; imageUri: string; metadataUri: string }[];
    logoUrl?: string;
    irysPublished?: boolean;
  },
  authHeaders?: Record<string, string>,
): Promise<Collection> {
  const headers = {
    "Content-Type": "application/json",
    ...(authHeaders ?? (await buildAuthHeaders(wallet))),
  };
  const res = await fetch(`/api/collections/${collectionId}/uris`, {
    method: "PATCH",
    headers,
    body: JSON.stringify(payload),
  });
  const data = await readJsonResponse<{ collection: Collection; error?: string }>(res);
  if (!res.ok) throw new Error(data.error || "Could not save Arweave URIs");
  return data.collection;
}

export function buildTokenMetadataForUpload(
  collection: Collection,
  token: GeneratedToken,
  imageUri: string,
  royaltyBps: number,
  royaltySplit: RoyaltySplit,
  royaltyCreators?: MetadataCreator[],
): string {
  const name = collection.nameTemplate
    .replace("{name}", collection.name)
    .replace("{id}", String(token.tokenId));
  return JSON.stringify(
    buildTokenMetadataJson({
      name,
      symbol: collection.symbol,
      description: collection.description,
      sellerFeeBps: royaltyBps,
      image: imageUri,
      attributes: token.attributes,
      creatorWallet: collection.payments.creatorWallet,
      royaltySplit,
      royaltyCreators,
    }),
    null,
    2,
  );
}

export async function fetchStorageEstimate(
  wallet: string,
  collectionId: string,
  totalBytes: number,
  authHeaders?: Record<string, string>,
): Promise<{ lamports: string; sol: number }> {
  const headers = authHeaders ?? (await buildAuthHeaders(wallet));
  const res = await fetch(
    `/api/collections/${collectionId}/storage-estimate?totalBytes=${totalBytes}`,
    { headers },
  );
  const data = await readJsonResponse<{
    lamports: string;
    sol: number;
    error?: string;
  }>(res);
  if (!res.ok) throw new Error(data.error || "Could not estimate storage");
  return { lamports: data.lamports, sol: data.sol };
}
