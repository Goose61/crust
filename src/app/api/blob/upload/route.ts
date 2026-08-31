import { handleUpload, type HandleUploadBody } from "@vercel/blob/client";
import { NextResponse } from "next/server";
import { ZIP_CONTENT_TYPES, getBlobToken } from "@/lib/blob-config";

export const runtime = "nodejs";
export const maxDuration = 60;

const BLOB_NOT_CONFIGURED =
  "Large ZIP uploads need a public Vercel Blob store. In the Vercel dashboard: Project → Storage → create a Blob store with Public access, connect it to this project, then redeploy.";

/** Quick check before starting a client-side blob upload. */
export async function GET(): Promise<NextResponse> {
  const configured = !!getBlobToken();
  return NextResponse.json({
    configured,
    access: "public" as const,
    directUploadMaxBytes: 4 * 1024 * 1024,
    ...(configured ? {} : { error: BLOB_NOT_CONFIGURED }),
  });
}

/** Client-direct ZIP uploads (bypasses the ~4.5MB serverless request body limit). */
export async function POST(request: Request): Promise<NextResponse> {
  const token = getBlobToken();
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
        allowedContentTypes: ZIP_CONTENT_TYPES,
        maximumSizeInBytes: 500 * 1024 * 1024,
        addRandomSuffix: true,
        validUntil: Date.now() + 2 * 60 * 60 * 1000,
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
