import { deleteBlob } from "@/lib/blob-storage";
import { getBlobToken } from "@/lib/blob-config";

const UPLOAD_PREFIX = "collection-uploads/";

export function isCollectionUploadZipUrl(url: string): boolean {
  return url.includes(UPLOAD_PREFIX);
}

/** Remove a temporary collection ZIP after import (success or failure). */
export async function deleteCollectionUploadZip(url: string): Promise<void> {
  if (!url || !isCollectionUploadZipUrl(url)) return;
  await deleteBlob(url);
}

/** Delete all leftover ZIPs under collection-uploads/ (failed/abandoned uploads). */
export async function purgeCollectionUploadZips(): Promise<{ deleted: number }> {
  if (!getBlobToken()) {
    return { deleted: 0 };
  }

  const { list, del } = await import("@vercel/blob");
  let deleted = 0;
  let cursor: string | undefined;

  do {
    const page = await list({ prefix: UPLOAD_PREFIX, cursor, limit: 100 });
    if (page.blobs.length > 0) {
      await del(page.blobs.map((blob) => blob.url));
      deleted += page.blobs.length;
    }
    cursor = page.hasMore ? page.cursor : undefined;
  } while (cursor);

  return { deleted };
}
