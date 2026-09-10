export type PriceDisplayUnit = "usd" | "sol";

export const SOL_USD_FALLBACK = 145;

export function usdToSol(usd: number, solUsd = SOL_USD_FALLBACK): number {
  if (!solUsd) return 0;
  return usd / solUsd;
}

export function solToUsd(sol: number, solUsd = SOL_USD_FALLBACK): number {
  return sol * solUsd;
}

export function formatSolAmount(sol: number): string {
  if (sol >= 1) return sol.toFixed(3);
  if (sol >= 0.01) return sol.toFixed(4);
  return sol.toFixed(6);
}

export function displayPriceFromUsd(usd: number, unit: PriceDisplayUnit, solUsd = SOL_USD_FALLBACK): number {
  return unit === "usd" ? usd : usdToSol(usd, solUsd);
}

export function usdFromDisplayInput(value: number, unit: PriceDisplayUnit, solUsd = SOL_USD_FALLBACK): number {
  return unit === "usd" ? value : solToUsd(value, solUsd);
}
