/**
 * Proxy Irys/Arweave gateway content through same-origin.
 *
 * gateway.irys.xyz redirects to *.datasprite-cdn.com which is blocked by
 * our CSP img-src. Serving via this route avoids that and keeps images working.
 */

import { NextRequest, NextResponse } from "next/server";

export async function GET(
  _req: NextRequest,
  { params }: { params: Promise<{ id: string }> },
) {
  const { id } = await params;
  if (!id || !/^[A-Za-z0-9_-]{20,64}$/.test(id)) {
    return NextResponse.json({ error: "Invalid id" }, { status: 400 });
  }

  try {
    const upstream = await fetch(`https://gateway.irys.xyz/${id}`, {
      redirect: "follow",
      signal: AbortSignal.timeout(15_000),
    });
    if (!upstream.ok) {
      return NextResponse.json({ error: "Upstream not found" }, { status: upstream.status });
    }

    const body = await upstream.arrayBuffer();
    const contentType = upstream.headers.get("content-type") ?? "application/octet-stream";

    return new NextResponse(body, {
      headers: {
        "Content-Type": contentType,
        "Cache-Control": "public, max-age=86400, immutable",
      },
    });
  } catch (err) {
    return NextResponse.json(
      { error: `Gateway fetch failed: ${String(err)}` },
      { status: 502 },
    );
  }
}
