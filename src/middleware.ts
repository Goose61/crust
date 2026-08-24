import { NextRequest, NextResponse } from "next/server";

const ALLOWED_ORIGINS =
  process.env.ALLOWED_ORIGINS?.split(",").map((s) => s.trim()).filter(Boolean) ?? [];

export function middleware(req: NextRequest) {
  const { pathname } = req.nextUrl;
  const origin = req.headers.get("origin") ?? "";

  // ── CORS ─────────────────────────────────────────────────────────────────
  const corsHeaders: Record<string, string> = {};
  if (pathname.startsWith("/api/")) {
    const allowed =
      ALLOWED_ORIGINS.length === 0
        ? origin                          // dev: echo origin (same-site only)
        : ALLOWED_ORIGINS.includes(origin)
          ? origin
          : ALLOWED_ORIGINS[0];          // prod: restrict to allowlist

    corsHeaders["Access-Control-Allow-Origin"] = allowed;
    corsHeaders["Access-Control-Allow-Methods"] = "GET, POST, PATCH, OPTIONS";
    corsHeaders["Access-Control-Allow-Headers"] = "Content-Type, X-Requested-With";
    corsHeaders["Vary"] = "Origin";

    if (req.method === "OPTIONS") {
      return new NextResponse(null, { status: 204, headers: corsHeaders });
    }
  }

  const res = NextResponse.next();

  // ── Security headers (applied to all responses) ──────────────────────────
  res.headers.set(
    "Content-Security-Policy",
    [
      "default-src 'self'",
      "script-src 'self' 'unsafe-inline' 'unsafe-eval'",
      "style-src 'self' 'unsafe-inline' https://fonts.googleapis.com",
      "img-src 'self' data: blob: https://gateway.irys.xyz https://arweave.net https://blob.vercel-storage.com https://*.datasprite-cdn.com",
      // Irys upload nodes + Solana RPCs + Jupiter price + blob storage
      [
        "connect-src 'self'",
        // Irys uploader endpoints (mainnet + devnet)
        "https://uploader.irys.xyz",
        "https://devnet.irys.xyz",
        "https://node1.irys.xyz",
        "https://gateway.irys.xyz",
        // Solana RPC (http + websocket)
        "https://api.devnet.solana.com",
        "https://api.mainnet.solana.com",
        "https://api.mainnet-beta.solana.com",
        "wss://api.devnet.solana.com",
        "wss://api.mainnet.solana.com",
        "wss://api.mainnet-beta.solana.com",
        // Jupiter price API
        "https://lite-api.jup.ag",
        "https://api.jup.ag",
        // Arweave gateway
        "https://arweave.net",
        // SlicePay + CoinGecko + Vercel Blob
        "https://api.slicechain.io",
        "https://pay.slicechain.io",
        "https://api.coingecko.com",
        "https://blob.vercel-storage.com",
      ].join(" "),
      "font-src 'self' https://fonts.gstatic.com",
      "frame-src https://dexscreener.com",
      "frame-ancestors 'none'",
      "base-uri 'self'",
    ].join("; "),
  );
  res.headers.set("X-Frame-Options", "DENY");
  res.headers.set("X-Content-Type-Options", "nosniff");
  res.headers.set("Referrer-Policy", "strict-origin-when-cross-origin");
  res.headers.set(
    "Strict-Transport-Security",
    "max-age=63072000; includeSubDomains; preload",
  );
  res.headers.set("Permissions-Policy", "camera=(), microphone=(), geolocation=()");

  // Attach CORS headers to the real response too
  for (const [k, v] of Object.entries(corsHeaders)) {
    res.headers.set(k, v);
  }

  return res;
}

export const config = {
  matcher: ["/((?!_next/static|_next/image|favicon.ico).*)"],
};
