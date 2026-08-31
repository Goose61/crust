import { handleUpload, type HandleUploadBody } from "@vercel/blob/client";
import { NextResponse } from "next/server";
import {
  ZIP_CONTENT_TYPES,
  getBlobToken,
  resolveBlobAccess,
} from "@/lib/blob-config";

export const runtime = "nodejs";
export const maxDuration = 60;

const BLOB_NOT_CONFIGURED =
  "Large ZIP uploads need Vercel Blob storage. In the Vercel dashboard: Project → Storage → connect a Blob store, then redeploy.";

/** Quick check before starting a client-side blob upload. */
export async function GET(): Promise<NextResponse> {
  const token = getBlobToken();
  if (!token) {
    return NextResponse.json({
      configured: false,
      directUploadMaxBytes: 4 * 1024 * 1024,
      error: BLOB_NOT_CONFIGURED,
    });
  }

  const access = await resolveBlobAccess(token);
  return NextResponse.json({
    configured: true,
    access,
    directUploadMaxBytes: 4 * 1024 * 1024,
  });
}

/** Client-direct ZIP uploads (bypasses the ~4.5MB serverless request body limit). */
export async function POST(request: Request): Promise<NextResponse> {
  const token = getBlobToken();
  if (!token) {
    return NextResponse.json({ error: BLOB_NOT_CONFIGURED }, { status: 503 });
  }

  const access = await resolveBlobAccess(token);

  try {
    const body = (await request.json()) as HandleUploadBody;
    const jsonResponse = await handleUpload({
      body,
      request,
      token,
      onBeforeGenerateToken: async () => ({
        allowedContentTypes: ZIP_CONTENT_TYPES,
        maximumSizeInBytes: 500 * 1024 * 1024,
        addRandomSuffix: true,
        validUntil: Date.now() + 2 * 60 * 60 * 1000,
      }),
      onUploadCompleted: async () => {
        // Collection import runs in a separate API call after upload.
      },
    });
    return NextResponse.json({ ...jsonResponse, access });
  } catch (err) {
    console.error("[POST /api/blob/upload]", err);
    const message = err instanceof Error ? err.message : "Upload token failed";
    return NextResponse.json({ error: message }, { status: 400 });
  }
}
