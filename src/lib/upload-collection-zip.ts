/** Upload a collection ZIP — uses Vercel Blob client for files >4MB (serverless body limit). */

import { readJsonResponse } from "./fetch-json";
import type { CollectionUploadProgressState } from "@/components/CollectionUploadProgress";

export const DIRECT_UPLOAD_MAX_BYTES = 4 * 1024 * 1024;

/** Blob/direct upload maps to 0–80%; server import finishes 80–100%. */
const UPLOAD_PHASE_MAX = 80;
const PROCESSING_START = 82;

const LARGE_UPLOAD_UNAVAILABLE =
  "Large ZIP uploads need Vercel Blob storage (BLOB_READ_WRITE_TOKEN). In Vercel: Project → Storage → connect a Blob store to this project, then redeploy. ZIPs under 4 MB can upload without it.";

const PRIVATE_STORE_PUBLIC_MISMATCH =
  "Your Vercel Blob store is private but uploads were sent as public. Redeploy the latest version, or set BLOB_STORE_ACCESS=private in Vercel env vars.";

export type UploadProgressCallback = (progress: CollectionUploadProgressState) => void;

type BlobUploadStatus = {
  configured?: boolean;
  access?: "public" | "private";
  error?: string;
};

async function getBlobUploadStatus(): Promise<BlobUploadStatus> {
  const res = await fetch("/api/blob/upload");
  return readJsonResponse<BlobUploadStatus>(res);
}

async function assertBlobUploadConfigured(): Promise<"public" | "private"> {
  const status = await getBlobUploadStatus();
  if (!status.configured) {
    throw new Error(status.error ?? LARGE_UPLOAD_UNAVAILABLE);
  }
  return status.access ?? "public";
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

  const access = await assertBlobUploadConfigured();
  emitProgress(onProgress, { phase: "uploading", percent: 2 }, file);

  const { upload } = await import("@vercel/blob/client");
  const pathname = `collection-uploads/${Date.now()}-${file.name.replace(/[^\w.-]+/g, "_")}`;

  try {
    const blob = await upload(pathname, file, {
      access,
      handleUploadUrl: "/api/blob/upload",
      contentType: file.type || "application/zip",
      multipart: file.size > 20 * 1024 * 1024,
      onUploadProgress: ({ percentage }) => {
        const scaled = Math.round((percentage / 100) * UPLOAD_PHASE_MAX);
        emitProgress(onProgress, { phase: "uploading", percent: scaled }, file);
      },
    });

    emitProgress(onProgress, { phase: "uploading", percent: UPLOAD_PHASE_MAX }, file);
    const zipUrl = access === "private"
      ? `/api/blob/file/${blob.pathname.split("/").map(encodeURIComponent).join("/")}`
      : blob.url;
    return { zipUrl };
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    if (message.includes("client token")) {
      throw new Error(LARGE_UPLOAD_UNAVAILABLE);
    }
    if (message.includes("private store") || message.includes("public access")) {
      throw new Error(PRIVATE_STORE_PUBLIC_MISMATCH);
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

export async function postImportJson<T>(
  endpoint: "/api/import/images" | "/api/layers/parse",
  file: File,
  fields: Record<string, string>,
  onProgress?: UploadProgressCallback,
): Promise<T> {
  emitProgress(onProgress, { phase: "uploading", percent: 0 }, file);
  const res = await postImportForm(endpoint, file, fields, onProgress);
  const data = await readJsonResponse<T & { error?: string }>(res);
  if (!res.ok) {
    throw new Error(
      typeof data === "object" && data && "error" in data && data.error
        ? String(data.error)
        : `Upload failed (HTTP ${res.status})`,
    );
  }
  emitProgress(onProgress, { phase: "processing", percent: 100 }, file);
  return data;
}
