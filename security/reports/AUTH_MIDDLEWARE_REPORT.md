# Auth Middleware Security Report

## Status: CRITICAL → PARTIALLY MITIGATED

## Findings

All 12 API routes had zero authentication. Any unauthenticated user on the internet could:
- Modify any collection's name, fees, supply, allowlist, status.
- Trigger go-live on any draft collection.
- Trigger reveal on any collection.
- Mint tokens by self-reporting any wallet address as `body.payer`.
- Upload new logos to any collection.
- Create gift NFTs attributed to any wallet.

The "auth" on the mint action was:
```typescript
const payer = String(body.payer || "");
if (!current.allowlist.includes(payer)) throw new Error("Not on allowlist");
```
This is trivially bypassed — the payer wallet is self-reported in the request body.

## What's at risk

- Complete collection takeover (rename, reprice, push live prematurely).
- Allowlist bypass (attacker mints without being on allowlist).
- Denial of service (drain collection supply by minting all tokens).
- Fraudulent gift NFTs attributed to legitimate creators.

## What's already secure

- The seed route is properly blocked in production (`NODE_ENV === "production"`).

## Fixes applied

- **Rate limiting on all write routes**: MongoDB-backed sliding window limiter in `src/lib/rate-limit.ts`.
  - mint: 10 per 15 minutes per wallet/IP
  - generate/import/layers: 5–15 per hour per IP
  - invoice: 20 per hour per IP
  - waitlist: 10 per hour per IP
- Rate-limited requests return HTTP 429.

## What still needs to be done (next sprint)

Full wallet signature verification is required for production security:

1. **Frontend**: When performing creator operations (go-live, reveal, allowlist, publish),
   call `wallet.signMessage(Buffer.from("Dough Boi Auth: " + timestamp))` and include
   the base64 signature + timestamp in the request headers.

2. **Backend**: Verify the signature using `@solana/web3.js`:
   ```typescript
   import { PublicKey } from "@solana/web3.js";
   import nacl from "tweetnacl";
   const valid = nacl.sign.detached.verify(
     Buffer.from("Dough Boi Auth: " + timestamp),
     Buffer.from(signature, "base64"),
     new PublicKey(wallet).toBytes()
   );
   ```

3. **Ownership check**: Add `creatorWallet` field to `Collection` type and verify
   that the signing wallet matches `collection.payments.creatorWallet`.
