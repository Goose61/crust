/** Shared SOL/USD fetch so mint quotes and launch costs stay aligned. */

export const SOL_USD_FALLBACK = 180;
const SOL_MINT = "So11111111111111111111111111111111111111112";

async function readJson(url: string, timeoutMs = 3500): Promise<unknown> {
  const res = await fetch(url, {
    cache: "no-store",
    signal: AbortSignal.timeout(timeoutMs),
  });
  if (!res.ok) throw new Error(`HTTP ${res.status}`);
  return res.json();
}

function asPositive(n: unknown): number | null {
  const v = typeof n === "string" ? Number(n) : typeof n === "number" ? n : NaN;
  return Number.isFinite(v) && v > 1 && v < 100_000 ? v : null;
}

export async function fetchSolUsd(): Promise<number> {
  const sources: Array<() => Promise<number | null>> = [
    async () => {
      const json = (await readJson(
        `https://lite-api.jup.ag/price/v2?ids=${SOL_MINT}`,
      )) as { data?: Record<string, { price?: string | number }> };
      return asPositive(json.data?.[SOL_MINT]?.price);
    },
    async () => {
      const json = (await readJson(
        "https://api.binance.com/api/v3/ticker/price?symbol=SOLUSDT",
      )) as { price?: string };
      return asPositive(json.price);
    },
    async () => {
      const json = (await readJson(
        "https://api.coingecko.com/api/v3/simple/price?ids=solana&vs_currencies=usd",
      )) as { solana?: { usd?: number } };
      return asPositive(json.solana?.usd);
    },
  ];

  for (const source of sources) {
    try {
      const price = await source();
      if (price) return price;
    } catch {
      /* try next source */
    }
  }
  return SOL_USD_FALLBACK;
}
