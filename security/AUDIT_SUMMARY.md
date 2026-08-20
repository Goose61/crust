# Security Audit Summary

Date: 2026-08-20

## Results

| # | Category | Status | Report |
|---|----------|--------|--------|
| 1 | SECRETS_EXPOSURE | HIGH → **FIXED** | [report](reports/SECRETS_EXPOSURE_REPORT.md) |
| 2 | DATABASE_ACCESS | MEDIUM → **FIXED** | [report](reports/DATABASE_ACCESS_REPORT.md) |
| 3 | AUTH_MIDDLEWARE | CRITICAL → **PARTIALLY MITIGATED** | [report](reports/AUTH_MIDDLEWARE_REPORT.md) |
| 4 | ACCESS_CONTROL | CRITICAL → **PARTIALLY MITIGATED** | [report](reports/AUTH_MIDDLEWARE_REPORT.md) |
| 5 | FRONTEND_SECRETS | **PASS** | [report](reports/PASS_CATEGORIES_REPORT.md) |
| 6 | SSRF | LOW | [report](reports/PASS_CATEGORIES_REPORT.md) |
| 7 | CSRF | LOW | [report](reports/PASS_CATEGORIES_REPORT.md) |
| 8 | SECURITY_HEADERS | HIGH → **FIXED** | [report](reports/SECURITY_HEADERS_REPORT.md) |
| 9 | CORS | MEDIUM → **FIXED** | [report](reports/CORS_REPORT.md) |
| 10 | RATE_LIMITING | HIGH → **FIXED** | [report](reports/RATE_LIMITING_REPORT.md) |
| 11 | SQL_INJECTION | **N/A (PASS)** | [report](reports/PASS_CATEGORIES_REPORT.md) |
| 12 | XSS | LOW → **FIXED** | [report](reports/XSS_REPORT.md) |
| 13 | PAYMENT_WEBHOOKS | CRITICAL → **PARTIALLY MITIGATED** | [report](reports/AUTH_MIDDLEWARE_REPORT.md) |
| 14 | FILE_UPLOADS | MEDIUM → **FIXED** | [report](reports/FILE_UPLOADS_REPORT.md) |
| 15 | ERROR_HANDLING | MEDIUM → **PARTIALLY FIXED** | [report](reports/PASS_CATEGORIES_REPORT.md) |
| 16 | PASSWORD_HASHING | **N/A** | [report](reports/PASS_CATEGORIES_REPORT.md) |
| 17 | DEPENDENCIES | MEDIUM | [report](reports/PASS_CATEGORIES_REPORT.md) |

---

## What was built (production readiness)

### MongoDB Atlas
- `src/lib/db.ts` — connection singleton (dev caching + prod fresh client)
- `src/lib/store.ts` — full rewrite using MongoDB (`findOne`, `replaceOne` upsert)
- Unique index on `id`, secondary index on `slug`

### Vercel Blob file storage
- `src/lib/blob-storage.ts` — `uploadBlob`, `uploadBlobText`, `downloadBlobToTmp`, `deleteBlob`
- Local filesystem fallback when `BLOB_READ_WRITE_TOKEN` is not set (dev)
- `src/app/api/assets-blob/[...path]/route.ts` — dev fallback server

### Compositor (Vercel-compatible)
- `src/lib/compositor.ts` — generates images to `/tmp`, uploads to Blob, stores URLs on tokens
- Layer files stored in Blob with `blobUrl` on each `LayerCatalog.values` entry
- `downloadBlobToTmp` fetches layer files to `/tmp` before generation

### Security middleware
- `src/middleware.ts` — CSP, HSTS, X-Frame-Options, X-Content-Type-Options, Referrer-Policy, CORS

### Rate limiting
- `src/lib/rate-limit.ts` — MongoDB sliding window, works across serverless instances

### File upload hardening
- Magic byte validation on logo and gift image endpoints
- Server-side size limits on all 4 upload endpoints (10–500 MB depending on type)

---

## Credentials to add to Vercel project

Go to your Vercel project → Settings → Environment Variables and add:

| Variable | Required | Description |
|---|---|---|
| `MONGODB_URI` | ✅ Yes | MongoDB Atlas connection string |
| `BLOB_READ_WRITE_TOKEN` | ✅ Yes | Vercel Blob token (create via Project → Storage → Blob) |
| `ALLOWED_ORIGINS` | ✅ Yes | Comma-separated production domains |
| `ARWEAVE_SOLANA_KEY` | Optional | Solana key for Irys/Arweave publishing |
| `SLICEPAY_MERCHANT_ID` | Optional | SlicePay merchant ID |
| `SLICEPAY_API_KEY` | Optional | SlicePay API key |

---

## Remaining manual actions (in priority order)

### Immediate (before going live)
1. **Rotate `ARWEAVE_SOLANA_KEY`** — the current key was visible in `.env.local` in plain text.
   Create a new Solana wallet, update the key everywhere.

2. **Remove `@solana/web3.js`** from `package.json` — it is a dead dependency (never imported).
   Run `pnpm remove @solana/web3.js`.

3. **Run dependency audit** — `pnpm audit` and fix any critical/high CVEs.

### Next sprint (wallet signature auth)
4. **Implement wallet signature verification** for creator operations.
   See `security/reports/AUTH_MIDDLEWARE_REPORT.md` for the full implementation plan.
   Until this is done, any user who knows a collection's `id` can modify it.

5. **Implement payment verification** before minting.
   The mint endpoint currently accepts mints without verifying SlicePay payment.
   Add a `confirmedInvoiceId` field to the mint request and verify it against the SlicePay API.

### Testing
6. Verify all security headers present: `curl -I https://your-app.vercel.app`
7. Test rate limiting: send 11 rapid mint requests, confirm 429 on the 11th.
8. Test file size limits: upload a 15 MB logo, confirm 413.
9. Test magic bytes: rename a `.exe` to `.png`, upload as logo, confirm 400.
10. Test CORS: cross-origin fetch from a disallowed domain should be blocked.
