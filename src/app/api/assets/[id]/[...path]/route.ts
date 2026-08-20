import { NextRequest, NextResponse } from "next/server";
import { readFile, stat } from "fs/promises";
import path from "path";
import { collectionDir, STAGING_DIR } from "@/lib/paths";
import sharp from "sharp";

type Params = { params: Promise<{ id: string; path: string[] }> };

export async function GET(_req: NextRequest, { params }: Params) {
  const { id, path: segments } = await params;

  if (segments[0] === "placeholder") {
    const png = await sharp({
      create: { width: 800, height: 800, channels: 4, background: { r: 32, g: 24, b: 18, alpha: 1 } },
    })
      .png()
      .toBuffer();
    return new NextResponse(new Uint8Array(png), {
      headers: { "Content-Type": "image/png", "Cache-Control": "public, max-age=60" },
    });
  }

  const rel = segments.join("/");
  // Block path traversal
  if (rel.includes("..") || rel.startsWith("/")) {
    return NextResponse.json({ error: "invalid path" }, { status: 400 });
  }

  const filePath = path.join(collectionDir(id), rel);

  // Ensure the resolved path stays within STAGING_DIR
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
          : "application/octet-stream";
    return new NextResponse(new Uint8Array(buf), {
      headers: { "Content-Type": type, "Cache-Control": "public, max-age=3600" },
    });
  } catch {
    return NextResponse.json({ error: "not found" }, { status: 404 });
  }
}
