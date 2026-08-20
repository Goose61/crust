# Security Headers Security Report

## Status: HIGH → FIXED

## Findings

`next.config.ts` had no `headers()` configuration. No middleware set any security headers.
All five critical headers were missing on every response.

## What's at risk

- No `X-Frame-Options` → clickjacking (attacker embeds your app in an iframe).
- No `Content-Security-Policy` → XSS attack surface expanded.
- No `X-Content-Type-Options` → MIME sniffing attacks on uploaded files.
- No `Referrer-Policy` → wallet addresses in query params could leak via Referer header.
- No `Strict-Transport-Security` → HTTPS downgrade attacks possible.

## Fixes applied

`src/middleware.ts` sets all five headers on every response:

```
Content-Security-Policy: default-src 'self'; script-src 'self' 'unsafe-inline' 'unsafe-eval'; style-src 'self' 'unsafe-inline'; img-src 'self' data: blob: https://gateway.irys.xyz https://arweave.net https://blob.vercel-storage.com; connect-src 'self' https://api.slicechain.io https://pay.slicechain.io https://api.coingecko.com https://blob.vercel-storage.com; font-src 'self'; frame-ancestors 'none'; base-uri 'self'
X-Frame-Options: DENY
X-Content-Type-Options: nosniff
Referrer-Policy: strict-origin-when-cross-origin
Strict-Transport-Security: max-age=63072000; includeSubDomains; preload
Permissions-Policy: camera=(), microphone=(), geolocation=()
```

Headers are set in a single global middleware, not per-route.

## Verification goals

- [x] All five headers present on every response
- [x] Headers set via a single global middleware
- [ ] Run `curl -I https://your-app.vercel.app` and verify all headers present after deploy
