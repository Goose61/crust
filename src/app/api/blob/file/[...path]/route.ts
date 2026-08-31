import { get } from "@vercel/blob";
import { NextRequest, NextResponse } from "next/server";
import { getBlobToken, resolveBlobAccess } from "@/lib/blob-config";

export const runtime = "nodejs";

type Params = { params: Promise<{ path: string[] }> };

/** Serve private blob files through the app (public CDN URLs for NFT metadata). */
export async function GET(_req: NextRequest, { params }: Params) {
  const token = getBlobToken();
  if (!token) {
    return NextResponse.json({ error: "Blob storage not configured" }, { status: 503 });
  }

  const { path: segments } = await params;
  const pathname = segments.map(decodeURIComponent).join("/");
  if (!pathname || pathname.includes("..")) {
    return NextResponse.json({ error: "invalid path" }, { status: 400 });
  }

  const access = await resolveBlobAccess(token);
  const result = await get(pathname, { access, token });
  if (!result?.stream) {
    return NextResponse.json({ error: "not found" }, { status: 404 });
  }

  return new NextResponse(result.stream, {
    headers: {
      "Content-Type": result.blob.contentType,
      "Cache-Control": "public, max-age=31536000, immutable",
    },
  });
}
