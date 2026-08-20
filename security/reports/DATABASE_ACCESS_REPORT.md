# Database Access Security Report

## Status: MEDIUM → FIXED

## Findings

**Before**: All data was in a plain JSON file (`data/collections.json`) on disk with no
access control, no encryption at rest, and a single-instance mutex that would fail under
concurrent Vercel serverless invocations.

**After**: MongoDB Atlas replaces the JSON file. Atlas provides:
- Encryption at rest (AES-256).
- Network access control (IP allowlist).
- Role-based database users.
- TLS in transit.

## What's already secure

- No SQL — no SQL injection risk.
- No Supabase/Firebase RLS to configure.
- MongoDB Atlas free tier includes all security features above.

## Fixes applied

- `src/lib/db.ts` — MongoDB connection singleton with dev/prod caching.
- `src/lib/store.ts` — Complete rewrite using MongoDB `findOne`, `replaceOne` (upsert).
  Unique index on `id`, secondary index on `slug`.
- `MONGODB_URI` added to `.env.example` with full setup instructions.

## Manual action required

In MongoDB Atlas:
1. Network Access → Add IP address → `0.0.0.0/0` (or Vercel's IP range for stricter security).
2. Database Access → Add database user → role: `readWrite` on database `crypgo`.
3. Connect → Drivers → copy the connection string into `MONGODB_URI`.
