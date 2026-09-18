import { fetchSolUsd } from "./sol-price";

const PIZZA_USD_FALLBACK = 0.0052;

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
  const solUsd = await fetchSolUsd();
  const pizzaUsd = PIZZA_USD_FALLBACK;

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
