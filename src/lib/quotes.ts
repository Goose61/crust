const PIZZA_USD_FALLBACK = 0.0052;
const SOL_USD_FALLBACK = 145;

export type Quote = {
  usd: number;
  sol: number;
  usdc: number;
  pizza: number;
  pizzaUsd: number;
  solUsd: number;
  updatedAt: string;
};

export async function getQuote(usd: number): Promise<Quote> {
  let solUsd = SOL_USD_FALLBACK;
  const pizzaUsd = PIZZA_USD_FALLBACK;

  try {
    const res = await fetch(
      "https://api.coingecko.com/api/v3/simple/price?ids=solana&vs_currencies=usd",
      { next: { revalidate: 30 } },
    );
    if (res.ok) {
      const data = (await res.json()) as { solana?: { usd?: number } };
      if (data.solana?.usd) solUsd = data.solana.usd;
    }
  } catch {
    /* keep fallback */
  }

  return {
    usd,
    usdc: usd,
    sol: usd / solUsd,
    pizza: usd / pizzaUsd,
    pizzaUsd,
    solUsd,
    updatedAt: new Date().toISOString(),
  };
}
