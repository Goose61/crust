import type { BlobAccessType } from "@vercel/blob";

const ZIP_CONTENT_TYPES = [
  "application/zip",
  "application/x-zip-compressed",
  "application/octet-stream",
];

let cachedAccess: BlobAccessType | null = null;

export function getBlobToken(): string | undefined {
  return process.env.BLOB_READ_WRITE_TOKEN?.trim() || undefined;
}

export function getBlobAccessFromEnv(): BlobAccessType | null {
  const value = process.env.BLOB_STORE_ACCESS?.trim().toLowerCase();
  if (value === "public" || value === "private") return value;
  return null;
}

/** Probe the connected store once when BLOB_STORE_ACCESS is unset. */
export async function resolveBlobAccess(token = getBlobToken()): Promise<BlobAccessType> {
  const fromEnv = getBlobAccessFromEnv();
  if (fromEnv) return fromEnv;
  if (cachedAccess) return cachedAccess;
  if (!token) return "public";

  cachedAccess = await detectStoreAccess(token);
  return cachedAccess;
}

async function detectStoreAccess(token: string): Promise<BlobAccessType> {
  try {
    const { generateClientTokenFromReadWriteToken } = await import("@vercel/blob/client");
    const clientToken = await generateClientTokenFromReadWriteToken({
      token,
      pathname: ".probe/access-check",
      addRandomSuffix: true,
      allowedContentTypes: ZIP_CONTENT_TYPES,
      maximumSizeInBytes: 1024,
    });

    const res = await fetch(
      `https://blob.vercel-storage.com/mpu?${new URLSearchParams({ pathname: ".probe/access-check" })}`,
      {
        method: "POST",
        headers: {
          authorization: `Bearer ${clientToken}`,
          "x-mpu-action": "create",
          "x-content-type": "application/octet-stream",
          "x-vercel-blob-access": "public",
        },
      },
    );

    if (res.ok) return "public";

    const body = await res.text();
    if (body.includes("private store") && body.includes("public access")) {
      return "private";
    }
    if (body.includes("public store") && body.includes("private access")) {
      return "public";
    }
  } catch {
    // Fall back to public if probing fails.
  }
  return "public";
}

/** Public URL for a blob pathname — CDN for public stores, app proxy for private. */
export function blobPublicUrl(pathname: string, access: BlobAccessType): string {
  if (access === "public") {
    return `https://blob.vercel-storage.com/${pathname}`;
  }
  const relative = `/api/blob/file/${pathname.split("/").map(encodeURIComponent).join("/")}`;
  const origin =
    process.env.NEXT_PUBLIC_SITE_URL?.trim() ||
    process.env.ALLOWED_ORIGINS?.split(",")[0]?.trim();
  return origin ? `${origin}${relative}` : relative;
}

export function isBlobStorageUrl(url: string): boolean {
  return url.includes("blob.vercel-storage.com");
}

export { ZIP_CONTENT_TYPES };
