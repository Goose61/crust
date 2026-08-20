/**
 * Local-dev blob fallback.
 * In production, files are served directly from Vercel Blob CDN URLs.
 * In dev (no BLOB_READ_WRITE_TOKEN), uploaded files are saved under data/staging/
 * and this route serves them.
 */
import { NextRequest, NextResponse } from "next/server";
import { readFile, stat } from "fs/promises";
import path from "path";
import { STAGING_DIR } from "@/lib/paths";

type Params = { params: Promise<{ path: string[] }> };

export async function GET(_req: NextRequest, { params }: Params) {
  const { path: segments } = await params;
  const rel = segments.join("/");

  if (rel.includes("..") || rel.startsWith("/")) {
    return NextResponse.json({ error: "invalid path" }, { status: 400 });
  }

  const filePath = path.join(STAGING_DIR, rel);
  const resolved = path.resolve(filePath);
  if (!resolved.startsWith(path.resolve(STAGING_DIR))) {
    return NextResponse.json({ error: "forbidden" }, { status: 403 });
  }

  try {
    await stat(filePath);
    const buf = await readFile(filePath);
    const type = rel.endsWith(".json")
      ? "application/json"
      : rel.endsWith(".png")
        ? "image/png"
        : rel.endsWith(".jpeg") || rel.endsWith(".jpg")
          ? "image/jpeg"
          : rel.endsWith(".webp")
            ? "image/webp"
            : "application/octet-stream";
    return new NextResponse(new Uint8Array(buf), {
      headers: { "Content-Type": type, "Cache-Control": "public, max-age=3600" },
    });
  } catch {
    return NextResponse.json({ error: "not found" }, { status: 404 });
  }
}
