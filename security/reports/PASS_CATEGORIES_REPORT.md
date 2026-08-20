# Pass/N-A Categories Report

## FRONTEND_SECRETS — PASS

No `NEXT_PUBLIC_*` env vars in use anywhere in `src/`.
All sensitive vars (`ARWEAVE_SOLANA_KEY`, `SLICEPAY_MERCHANT_ID`, `SLICEPAY_API_KEY`,
`MONGODB_URI`, `BLOB_READ_WRITE_TOKEN`) are server-side only — never bundled into
client JavaScript.

## SQL_INJECTION — N/A (PASS)

No SQL database. No ORM. All persistence via MongoDB driver using structured query
objects (no string interpolation in queries). MongoDB is not vulnerable to SQL injection.

## PASSWORD_HASHING — N/A

App uses Phantom wallet (public key / Ed25519 cryptography). No passwords stored anywhere.

## SSRF — LOW (no fix needed)

No user-supplied URL fetching anywhere in the codebase.
- `GET /api/quotes` fetches `api.coingecko.com` — hardcoded hostname, not user-supplied.
- `GET /api/slicepay/status/[invoiceId]` interpolates `invoiceId` into a URL at hardcoded
  domain `api.slicechain.io`. No hostname injection possible.
- `invoiceId` should be validated as alphanumeric/UUID to prevent path traversal in the URL.

## CSRF — LOW (acceptable)

No session cookies. App uses Phantom wallet for identity (stateless from server perspective).
All API calls send `Content-Type: application/json` which browsers cannot send in cross-site
form submissions. No CSRF tokens needed given current auth model.
If cookies are added in the future: set `SameSite=Strict` and add CSRF tokens.

## PASSWORD_WEBHOOKS (Stripe) — N/A

App uses SlicePay, not Stripe. SlicePay has no webhook endpoint in the app.
⚠️  The mint endpoint does NOT verify payment before minting. See ACCESS_CONTROL_REPORT.md.

## ERROR_HANDLING — MEDIUM → PARTIALLY FIXED

- MongoDB store errors now propagate as thrown exceptions (previously silently returned `[]`).
- Route error messages are controlled strings, not stack traces.
- `src/lib/storage.ts` logs Arweave failures server-side via `console.error`.
- TODO: Add a global `error.tsx` page and API error boundary to ensure no stack traces
  ever reach the client.

## DEPENDENCIES — MEDIUM (manual action needed)

All package versions use `^` semver ranges. For production:
1. Run `pnpm install` to generate a fresh `pnpm-lock.yaml`.
2. Run `npx audit` or `pnpm audit` to check for known CVEs.
3. Remove `@solana/web3.js` from `package.json` — it is listed as a dependency but
   never imported in `src/`. It adds attack surface and bundle weight.
4. Consider pinning exact versions for production stability.
