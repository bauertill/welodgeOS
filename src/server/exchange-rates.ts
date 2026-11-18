import { CURRENCIES } from "~/lib/currency";

/**
 * Today's exchange rates to the US dollar (doc §4.5), for showing a BRL or EUR
 * figure in USD as well — a guide only: nothing is stored or converted, and
 * every amount stays in the currency it was quoted in.
 *
 * From the European Central Bank's reference rates, through frankfurter.dev
 * (free, no key; only currency codes are sent), refreshed every six hours and
 * kept in memory between requests. When it cannot be reached, nothing is
 * shown in USD rather than a guess.
 */
export type UsdRates = { date: string; perUsd: Record<string, number> };

const SIX_HOURS = 6 * 60 * 60 * 1000;
let cached: { at: number; rates: UsdRates } | null = null;

export async function usdRates(): Promise<UsdRates | null> {
  if (cached && Date.now() - cached.at < SIX_HOURS) return cached.rates;
  try {
    const symbols = CURRENCIES.filter((code) => code !== "USD").join(",");
    const response = await fetch(`https://api.frankfurter.dev/v1/latest?base=USD&symbols=${symbols}`, { signal: AbortSignal.timeout(5000), cache: "no-store" });
    if (!response.ok) throw new Error(`Exchange rates: ${response.status}`);
    const body = (await response.json()) as { date: string; rates: Record<string, number> };
    const rates = { date: body.date, perUsd: { ...body.rates, USD: 1 } };
    cached = { at: Date.now(), rates };
    return rates;
  } catch (error) {
    console.error(error);
    // An older rate is still a fair guide; none at all is said as none.
    return cached?.rates ?? null;
  }
}
