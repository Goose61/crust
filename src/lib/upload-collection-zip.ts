/** Upload a collection ZIP — uses Vercel Blob client for files >4MB (serverless body limit). */

import { readJsonResponse } from "./fetch-json";
import type { CollectionUploadProgressState } from "@/components/CollectionUploadProgress";
import type { Collection } from "@/lib/types";

export const DIRECT_UPLOAD_MAX_BYTES = 4 * 1024 * 1024;

/** Blob/direct upload maps to 0–80%; server import finishes 80–100%. */
const UPLOAD_PHASE_MAX = 80;
const PROCESSING_START = 82;

const LARGE_UPLOAD_UNAVAILABLE =
  "Large ZIP uploads need a public Vercel Blob store (BLOB_READ_WRITE_TOKEN). In Vercel: Project → Storage → create a Blob store with Public access, connect it, then redeploy.";

const PRIVATE_STORE_MISMATCH =
  "Your Vercel Blob store is private, but this app requires a public store for NFT images. Create a new Blob store with Public access in Vercel → Storage, connect it to this project, update BLOB_READ_WRITE_TOKEN, and redeploy.";

export type UploadProgressCallback = (progress: CollectionUploadProgressState) => void;

type BlobUploadStatus = {
  configured?: boolean;
  error?: string;
};

async function assertBlobUploadConfigured(): Promise<void> {
  const res = await fetch("/api/blob/upload");
  const status = await readJsonResponse<BlobUploadStatus>(res);
  if (!status.configured) {
    throw new Error(status.error ?? LARGE_UPLOAD_UNAVAILABLE);
  }
}

function emitProgress(
  onProgress: UploadProgressCallback | undefined,
  partial: Omit<CollectionUploadProgressState, "fileName" | "fileSize">,
  file: File,
) {
  onProgress?.({
    fileName: file.name,
    fileSize: file.size,
    ...partial,
  });
}

export async function uploadCollectionZip(
  file: File,
  onProgress?: UploadProgressCallback,
): Promise<{ zipUrl?: string }> {
  if (file.size <= DIRECT_UPLOAD_MAX_BYTES) {
    emitProgress(onProgress, { phase: "uploading", percent: 5 }, file);
    return {};
  }

  await assertBlobUploadConfigured();
  emitProgress(onProgress, { phase: "uploading", percent: 2 }, file);

  const { upload } = await import("@vercel/blob/client");
  const pathname = `collection-uploads/${Date.now()}-${file.name.replace(/[^\w.-]+/g, "_")}`;

  try {
    const blob = await upload(pathname, file, {
      access: "public",
      handleUploadUrl: "/api/blob/upload",
      contentType: file.type || "application/zip",
      multipart: file.size > 20 * 1024 * 1024,
      onUploadProgress: ({ percentage }) => {
        const scaled = Math.round((percentage / 100) * UPLOAD_PHASE_MAX);
        emitProgress(onProgress, { phase: "uploading", percent: scaled }, file);
      },
    });

    emitProgress(onProgress, { phase: "uploading", percent: UPLOAD_PHASE_MAX }, file);
    return { zipUrl: blob.url };
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    if (message.includes("client token")) {
      throw new Error(LARGE_UPLOAD_UNAVAILABLE);
    }
    if (message.includes("private store") || message.includes("public access")) {
      throw new Error(PRIVATE_STORE_MISMATCH);
    }
    throw err;
  }
}

function postFormWithUploadProgress(
  endpoint: string,
  form: FormData,
  file: File,
  onProgress?: UploadProgressCallback,
): Promise<Response> {
  return new Promise((resolve, reject) => {
    const xhr = new XMLHttpRequest();
    xhr.open("POST", endpoint);
    xhr.responseType = "text";

    xhr.upload.onprogress = (event) => {
      if (!event.lengthComputable) return;
      const scaled = Math.round((event.loaded / event.total) * UPLOAD_PHASE_MAX);
      emitProgress(onProgress, { phase: "uploading", percent: scaled }, file);
    };

    xhr.onload = () => {
      resolve(
        new Response(xhr.responseText, {
          status: xhr.status,
          statusText: xhr.statusText,
          headers: { "Content-Type": "application/json" },
        }),
      );
    };

    xhr.onerror = () => reject(new Error("Network error during ZIP upload"));
    xhr.onabort = () => reject(new Error("ZIP upload cancelled"));
    xhr.send(form);
  });
}

export async function postImportForm(
  endpoint: "/api/import/images" | "/api/layers/parse",
  file: File,
  fields: Record<string, string>,
  onProgress?: UploadProgressCallback,
): Promise<Response> {
  const { zipUrl } = await uploadCollectionZip(file, onProgress);
  const form = new FormData();
  for (const [key, value] of Object.entries(fields)) {
    form.set(key, value);
  }

  if (zipUrl) {
    form.set("zipUrl", zipUrl);
    form.set("fileName", file.name);
    form.set("fileSize", String(file.size));
    emitProgress(onProgress, { phase: "processing", percent: PROCESSING_START }, file);
    return fetch(endpoint, { method: "POST", body: form });
  }

  form.set("file", file);
  emitProgress(onProgress, { phase: "uploading", percent: 0 }, file);
  const res = await postFormWithUploadProgress(endpoint, form, file, onProgress);
  emitProgress(onProgress, { phase: "processing", percent: PROCESSING_START }, file);
  return res;
}

async function startImportProcess(collectionId: string): Promise<void> {
  const res = await fetch("/api/import/images/process", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ collectionId }),
  });
  const data = await readJsonResponse<{ error?: string; started?: boolean }>(res);
  if (!res.ok && res.status !== 202) {
    throw new Error(data.error ?? `Import process failed (HTTP ${res.status})`);
  }
}

async function pollImportUntilReady(
  collectionId: string,
  file: File,
  onProgress?: UploadProgressCallback,
): Promise<Collection> {
  const started = Date.now();
  const maxMs = 25 * 60 * 1000;

  while (Date.now() - started < maxMs) {
    await new Promise((resolve) => setTimeout(resolve, 2000));
    const res = await fetch(`/api/collections/${collectionId}`);
    const data = await readJsonResponse<{ collection: Collection; error?: string }>(res);
    if (!res.ok) {
      throw new Error(data.error ?? "Failed to check import status");
    }

    const collection = data.collection;
    if (collection.importProgress?.error) {
      throw new Error(collection.importProgress.error);
    }

    if (collection.status === "draft" && collection.tokens.length > 0) {
      emitProgress(onProgress, { phase: "processing", percent: 100 }, file);
      return collection;
    }

    if (collection.status === "importing" && collection.importProgress) {
      const { done, total } = collection.importProgress;
      const pct =
        total > 0
          ? PROCESSING_START + Math.round((done / total) * (100 - PROCESSING_START))
          : PROCESSING_START;
      emitProgress(
        onProgress,
        {
          phase: "processing",
          percent: pct,
          detail: total > 0 ? `${done} / ${total}` : undefined,
        },
        file,
      );
    }
  }

  throw new Error(
    "Import is still running — check your dashboard in a minute or try again if it failed.",
  );
}

export async function postImportJson<T>(
  endpoint: "/api/import/images" | "/api/layers/parse",
  file: File,
  fields: Record<string, string>,
  onProgress?: UploadProgressCallback,
): Promise<T> {
  emitProgress(onProgress, { phase: "uploading", percent: 0 }, file);
  const res = await postImportForm(endpoint, file, fields, onProgress);
  const data = await readJsonResponse<
    T & { error?: string; importing?: boolean; collection?: Collection }
  >(res);
  if (!res.ok) {
    throw new Error(
      typeof data === "object" && data && "error" in data && data.error
        ? String(data.error)
        : `Upload failed (HTTP ${res.status})`,
    );
  }

  if (
    endpoint === "/api/import/images" &&
    data.importing &&
    data.collection?.id
  ) {
    await startImportProcess(data.collection.id);

    const collection = await pollImportUntilReady(data.collection.id, file, onProgress);
    return { ...data, collection } as T;
  }

  emitProgress(onProgress, { phase: "processing", percent: 100 }, file);
  return data;
}
