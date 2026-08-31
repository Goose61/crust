import { handleUpload, type HandleUploadBody } from "@vercel/blob/client";
import { NextResponse } from "next/server";

export const runtime = "nodejs";
export const maxDuration = 60;

/** Client-direct ZIP uploads (bypasses the ~4.5MB serverless request body limit). */
export async function POST(request: Request): Promise<NextResponse> {
  if (!process.env.BLOB_READ_WRITE_TOKEN) {
    return NextResponse.json(
      { error: "Blob storage not configured — set BLOB_READ_WRITE_TOKEN on Vercel." },
      { status: 503 },
    );
  }

  try {
    const body = (await request.json()) as HandleUploadBody;
    const jsonResponse = await handleUpload({
      body,
      request,
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
