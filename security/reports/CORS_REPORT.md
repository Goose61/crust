# CORS Security Report

## Status: MEDIUM → FIXED

## Findings

No explicit CORS configuration. Relied on Next.js framework defaults (same-origin).
Safe by accident, but not explicitly locked down.

## Fixes applied

`src/middleware.ts` handles CORS for all `/api/` routes:
- In development (`ALLOWED_ORIGINS` not set): echoes the request origin (allows all, for dev convenience).
- In production: restricts to the comma-separated `ALLOWED_ORIGINS` env var.
- No wildcard `*` origin.
- `credentials: true` is NOT set (no cookies used).
- Preflight `OPTIONS` requests handled with HTTP 204.

## Required action for production

Set `ALLOWED_ORIGINS` in your Vercel project environment variables:
```
ALLOWED_ORIGINS=https://your-app.vercel.app,https://yourcustomdomain.com
```
