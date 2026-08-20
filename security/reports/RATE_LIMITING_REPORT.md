# Rate Limiting Security Report

## Status: HIGH → FIXED

## Findings

No rate limiting existed on any endpoint. An attacker could:
- Loop `POST /api/collections/[id]` action=mint to exhaust all tokens in a collection.
- Spam `POST /api/layers/parse` with 100 MB ZIPs to OOM the server.
- Flood `POST /api/slicepay/invoice` to create thousands of fake invoices.

## Fixes applied

`src/lib/rate-limit.ts` — MongoDB-backed sliding window rate limiter. Works correctly
across all Vercel serverless instances (no in-memory state).

| Endpoint | Limit | Window |
|---|---|---|
| `POST /api/layers/parse` | 10 requests | 10 minutes per IP |
| `POST /api/import/images` | 5 requests | 15 minutes per IP |
| `POST /api/generate/preview` | 15 requests | 60 minutes per IP |
| `POST /api/gift` | 20 requests | 60 minutes per IP |
| `POST /api/collections` | 30 requests | 60 seconds per IP |
| `POST /api/collections/[id]` mint | 10 requests | 15 minutes per wallet |
| `POST /api/collections/[id]` waitlist | 10 requests | 60 minutes per IP |
| `POST /api/slicepay/invoice` | 20 requests | 60 minutes per IP |

Rate-limited requests return HTTP 429.

## Note on X-Forwarded-For bypass

The IP is taken from `x-forwarded-for` header. On Vercel, this header is set by Vercel's
edge network and cannot be spoofed by clients. On other platforms, consider using a
trusted proxy IP extraction library.
