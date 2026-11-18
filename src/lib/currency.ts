/**
 * The currencies a rate, a quotation or a contract can be in (doc §4.5) — one
 * list, so a new one (BRL for the Women's World Cup 2027) appears everywhere.
 */
export const CURRENCIES = ["USD", "EUR", "CHF", "GBP", "BRL"];

/** The currencies to offer, with one already in use kept even when not on the list. */
export function currencyOptions(current?: string | null) {
  return current && !CURRENCIES.includes(current) ? [...CURRENCIES, current] : CURRENCIES;
}
