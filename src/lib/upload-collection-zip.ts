/** Upload a collection ZIP — uses Vercel Blob client for files >4MB (serverless body limit). */

import { readJsonResponse } from "./fetch-json";

const DIRECT_UPLOAD_MAX_BYTES = 4 * 1024 * 1024;

export async function uploadCollectionZip(file: File): Promise<{ zipUrl?: string }> {
  if (file.size <= DIRECT_UPLOAD_MAX_BYTES) {
    return {};
  }

  const { upload } = await import("@vercel/blob/client");
  const pathname = `collection-uploads/${Date.now()}-${file.name.replace(/[^\w.-]+/g, "_")}`;

  const blob = await upload(pathname, file, {
    access: "public",
    handleUploadUrl: "/api/blob/upload",
    contentType: file.type || "application/zip",
  });

  return { zipUrl: blob.url };
}

export async function postImportForm(
  endpoint: "/api/import/images" | "/api/layers/parse",
  file: File,
  fields: Record<string, string>,
): Promise<Response> {
  const { zipUrl } = await uploadCollectionZip(file);
  const form = new FormData();
  for (const [key, value] of Object.entries(fields)) {
    form.set(key, value);
  }

  if (zipUrl) {
    form.set("zipUrl", zipUrl);
    form.set("fileName", file.name);
    form.set("fileSize", String(file.size));
  } else {
    form.set("file", file);
  }

  return fetch(endpoint, { method: "POST", body: form });
}

export async function postImportJson<T>(
  endpoint: "/api/import/images" | "/api/layers/parse",
  file: File,
  fields: Record<string, string>,
): Promise<T> {
  const res = await postImportForm(endpoint, file, fields);
  const data = await readJsonResponse<T & { error?: string }>(res);
  if (!res.ok) {
    throw new Error(
      typeof data === "object" && data && "error" in data && data.error
        ? String(data.error)
        : `Upload failed (HTTP ${res.status})`,
    );
  }
  return data;
}
