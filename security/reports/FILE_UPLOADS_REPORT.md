# File Uploads Security Report

## Status: MEDIUM → FIXED

## Findings

Before fixes:
- No server-side file size limits on any upload endpoint.
- Logo upload checked only file extension (trivially spoofed).
- Gift image checked extension + `file.type` (client-supplied, spoofable).
- ZIP imports had no size limits.

## Fixes applied

### Magic byte validation (logo and gift endpoints)
Both endpoints now validate file headers before processing:
```typescript
function isAllowedImageMagic(buf: Buffer): boolean {
  // PNG: 89 50 4E 47
  if (buf[0] === 0x89 && buf[1] === 0x50 && ...) return true;
  // JPEG: FF D8 FF
  if (buf[0] === 0xff && buf[1] === 0xd8 && ...) return true;
  // WebP: 52 49 46 46
  if (buf[0] === 0x52 && buf[1] === 0x49 && ...) return true;
  return false;
}
```

### Server-side size limits

| Endpoint | Limit |
|---|---|
| Logo upload | 10 MB |
| Gift image | 50 MB |
| Layer ZIP | 100 MB |
| Import images ZIP | 500 MB |

Limits are checked via `Content-Length` header (early rejection) and `file.size` (after parse).
Returns HTTP 413 when exceeded.

### File storage
All uploaded files go to Vercel Blob (CDN, not the app server filesystem).
Files are stored under UUID-prefixed paths — no predictable filenames.
