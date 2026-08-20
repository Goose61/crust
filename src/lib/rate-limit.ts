import { getDb } from "./db";

/** Sliding window rate limiter backed by MongoDB. Serverless-safe. */
export async function rateLimit(
  key: string,
  maxRequests: number,
  windowMs: number,
): Promise<{ allowed: boolean; remaining: number }> {
  try {
    const db = await getDb();
    const col = db.collection("rate_limits");

    // TTL index — MongoDB auto-purges expired docs
    await col.createIndex({ expiresAt: 1 }, { expireAfterSeconds: 0, background: true });

    const now = Date.now();
    const windowStart = new Date(now - windowMs);

    // Count recent hits
    const count = await col.countDocuments({
      key,
      createdAt: { $gt: windowStart },
    });

    if (count >= maxRequests) {
      return { allowed: false, remaining: 0 };
    }

    await col.insertOne({
      key,
      createdAt: new Date(now),
      expiresAt: new Date(now + windowMs),
    });

    return { allowed: true, remaining: maxRequests - count - 1 };
  } catch {
    // If DB is unavailable, allow the request (fail open)
    return { allowed: true, remaining: maxRequests };
  }
}
