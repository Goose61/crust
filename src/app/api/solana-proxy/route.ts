/**
 * Server-side Solana JSON-RPC proxy.
 *
 * Forwards browser Solana RPC calls to the real endpoint from the server.
 * This bypasses the 403 "Access forbidden" rate-limit that api.devnet.solana.com
 * returns for browser-originated requests (e.g. from Phantom's in-app browser),
 * because server-to-server calls are not subject to the same restrictions.
 *
 * Usage: POST /api/solana-proxy?n=devnet  or  ?n=mainnet
 */

import { NextRequest, NextResponse } from "next/server";

const RPC_URLS: Record<string, string> = {
  devnet:
    process.env.SOLANA_RPC_URL_DEVNET ?? "https://api.devnet.solana.com",
  mainnet:
    process.env.SOLANA_RPC_URL_MAINNET ?? "https://api.mainnet.solana.com",
};

export async function POST(req: NextRequest) {
  const n = req.nextUrl.searchParams.get("n") ?? "devnet";
  const upstream = RPC_URLS[n] ?? RPC_URLS.devnet;

  let body: string;
  try {
    body = await req.text();
  } catch {
    return NextResponse.json({ error: "Could not read request body" }, { status: 400 });
  }

  try {
    const resp = await fetch(upstream, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body,
    });
    const text = await resp.text();
    return new NextResponse(text, {
      status: resp.status,
      headers: { "Content-Type": "application/json" },
    });
  } catch (err) {
    return NextResponse.json(
      { error: `RPC proxy error: ${String(err)}` },
      { status: 502 },
    );
  }
}

export async function OPTIONS() {
  return new NextResponse(null, { status: 204 });
}
