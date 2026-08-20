/**
 * Unified file storage layer.
 *
 * Production (BLOB_READ_WRITE_TOKEN set):  uses Vercel Blob — public CDN URLs.
 * Development (no token):                  writes to data/staging/ and returns
 *                                          /api/assets-blob/<pathname> URLs.
 *
 * All callers receive a stable public URL regardless of environment.
 */

import { mkdir, writeFile, readFile } from "fs/promises";
import path from "path";
import { STAGING_DIR } from "./paths";

function hasBlobToken() {
  return !!process.env.BLOB_READ_WRITE_TOKEN;
}

/** Upload a buffer and return a public URL. */
export async function uploadBlob(
  pathname: string,
  buffer: Buffer,
  contentType: string,
): Promise<string> {
  if (hasBlobToken()) {
    const { put } = await import("@vercel/blob");
    const blob = await put(pathname, buffer, {
      access: "public",
      contentType,
    });
    return blob.url;
  }

  // Local dev fallback
  const localPath = path.join(STAGING_DIR, pathname);
  await mkdir(path.dirname(localPath), { recursive: true });
  await writeFile(localPath, buffer);
  return `/api/assets-blob/${pathname}`;
}

/** Upload a UTF-8 string (JSON, etc.) and return a public URL. */
export async function uploadBlobText(
  pathname: string,
  text: string,
  contentType = "application/json",
): Promise<string> {
  return uploadBlob(pathname, Buffer.from(text, "utf8"), contentType);
}

/** Download a blob URL to a local /tmp path and return the local path.
 *  If the URL is already a local /api path, reads from data/staging instead. */
export async function downloadBlobToTmp(
  url: string,
  tmpPath: string,
): Promise<string> {
  await mkdir(path.dirname(tmpPath), { recursive: true });
  if (url.startsWith("/api/assets-blob/")) {
    const rel = url.slice("/api/assets-blob/".length);
    const src = path.join(STAGING_DIR, rel);
    const buf = await readFile(src);
    await writeFile(tmpPath, buf);
    return tmpPath;
  }
  const res = await fetch(url);
  if (!res.ok) throw new Error(`Failed to download blob ${url}: ${res.status}`);
  const buf = Buffer.from(await res.arrayBuffer());
  await writeFile(tmpPath, buf);
  return tmpPath;
}

/** Delete a blob URL (no-op in dev). */
export async function deleteBlob(url: string): Promise<void> {
  if (!hasBlobToken()) return;
  if (!url.startsWith("http")) return;
  const { del } = await import("@vercel/blob");
  await del(url);
}
