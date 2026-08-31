import { handleUpload, type HandleUploadBody } from "@vercel/blob/client";
import { NextResponse } from "next/server";

export const runtime = "nodejs";
export const maxDuration = 60;

const BLOB_NOT_CONFIGURED =
  "Large ZIP uploads need Vercel Blob storage. In the Vercel dashboard: Project → Storage → Create/Connect Blob Store, then redeploy so BLOB_READ_WRITE_TOKEN is available in Production.";

function blobToken(): string | undefined {
  return process.env.BLOB_READ_WRITE_TOKEN?.trim() || undefined;
}

/** Quick check before starting a client-side blob upload. */
export async function GET(): Promise<NextResponse> {
  const configured = !!blobToken();
  return NextResponse.json({
    configured,
    directUploadMaxBytes: 4 * 1024 * 1024,
    ...(configured ? {} : { error: BLOB_NOT_CONFIGURED }),
  });
}

/** Client-direct ZIP uploads (bypasses the ~4.5MB serverless request body limit). */
export async function POST(request: Request): Promise<NextResponse> {
  const token = blobToken();
  if (!token) {
    return NextResponse.json({ error: BLOB_NOT_CONFIGURED }, { status: 503 });
  }

  try {
    const body = (await request.json()) as HandleUploadBody;
    const jsonResponse = await handleUpload({
      body,
      request,
      token,
      onBeforeGenerateToken: async () => ({
        allowedContentTypes: [
          "application/zip",
          "application/x-zip-compressed",
          "application/octet-stream",
        ],
        maximumSizeInBytes: 500 * 1024 * 1024,
        addRandomSuffix: true,
      }),
      onUploadCompleted: async () => {
        // Collection import runs in a separate API call after upload.
      },
    });
    return NextResponse.json(jsonResponse);
  } catch (err) {
    console.error("[POST /api/blob/upload]", err);
    const message = err instanceof Error ? err.message : "Upload token failed";
    return NextResponse.json({ error: message }, { status: 400 });
  }
}
