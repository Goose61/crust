import { NextRequest, NextResponse } from "next/server";
import sharp from "sharp";

export const runtime = "nodejs";

const MAX_WIDTH = 800;
const MIN_WIDTH = 64;
const MAX_UPSTREAM_BYTES = 12 * 1024 * 1024;

function allowedRelativePath(pathname: string): boolean {
  return (
    pathname.startsWith("/api/assets/") ||
    pathname.startsWith("/api/irys-gateway/") ||
    pathname.startsWith("/api/assets-blob/")
  );
}

function isAllowedAbsoluteUrl(url: URL): boolean {
  const host = url.hostname.toLowerCase();
  return (
    host === "gateway.irys.xyz" ||
    host === "arweave.net" ||
    host === "blob.vercel-storage.com" ||
    host.endsWith(".public.blob.vercel-storage.com") ||
    host.endsWith(".datasprite-cdn.com")
  );
}

function resolveUpstream(raw: string, origin: string): URL | null {
  if (!raw || raw.length > 1024) return null;
  if (raw.startsWith("/")) {
    if (!allowedRelativePath(raw)) return null;
    try {
      return new URL(raw, origin);
    } catch {
      return null;
    }
  }
  try {
    const url = new URL(raw);
    if (url.protocol !== "https:" && url.protocol !== "http:") return null;
    if (!isAllowedAbsoluteUrl(url)) return null;
    return url;
  } catch {
    return null;
  }
}

export async function GET(req: NextRequest) {
  const raw = req.nextUrl.searchParams.get("u") ?? "";
  const widthRaw = Number(req.nextUrl.searchParams.get("w") ?? 400);
  const width = Number.isFinite(widthRaw)
    ? Math.min(MAX_WIDTH, Math.max(MIN_WIDTH, Math.round(widthRaw)))
    : 400;

  const upstreamUrl = resolveUpstream(raw, req.nextUrl.origin);
  if (!upstreamUrl) {
    return NextResponse.json({ error: "Invalid image" }, { status: 400 });
  }

  try {
    const upstream = await fetch(upstreamUrl, {
      redirect: "follow",
      signal: AbortSignal.timeout(15_000),
    });
    if (!upstream.ok) {
      return NextResponse.json({ error: "Upstream not found" }, { status: upstream.status });
    }

    const buf = Buffer.from(await upstream.arrayBuffer());
    if (buf.length > MAX_UPSTREAM_BYTES) {
      return NextResponse.json({ error: "Image too large" }, { status: 413 });
    }

    const webp = await sharp(buf)
      .rotate()
      .resize(width, width, { fit: "cover", withoutEnlargement: true })
      .webp({ quality: 72 })
      .toBuffer();

    return new NextResponse(new Uint8Array(webp), {
      headers: {
        "Content-Type": "image/webp",
        "Cache-Control": "public, max-age=86400, immutable",
      },
    });
  } catch (err) {
    return NextResponse.json(
      { error: `Thumb failed: ${String(err)}` },
      { status: 502 },
    );
  }
}
