"use client";

import { formatDate, formatMoney } from "~/lib/format";
import { api } from "~/trpc/react";

/**
 * The same amount in US dollars at today's rate (doc §4.5) — "≈ US$ 1,234.00"
 * beside a BRL or EUR figure, a guide only. Nothing shows for USD itself, or
 * while today's rate is not known.
 */
export function useUsd() {
  const rates = api.exchange.usd.useQuery(undefined, { staleTime: 60 * 60 * 1000, refetchOnWindowFocus: false }).data;
  return (cents: number, currency: string) => {
    if (currency === "USD" || !rates) return null;
    const perUsd = rates.perUsd[currency];
    return perUsd ? Math.round(cents / perUsd) : null;
  };
}

export function InUsd({ cents, currency, className = "text-ink-500 block text-xs font-light" }: { cents: number | null | undefined; currency: string; className?: string }) {
  const toUsd = useUsd();
  const rates = api.exchange.usd.useQuery(undefined, { staleTime: 60 * 60 * 1000, refetchOnWindowFocus: false }).data;
  if (cents == null) return null;
  const usd = toUsd(cents, currency);
  if (usd === null || !rates) return null;
  return (
    <span className={className} title={`At the European Central Bank's rate of ${formatDate(new Date(`${rates.date}T00:00:00Z`))}: US$ 1 = ${rates.perUsd[currency]?.toFixed(4)} ${currency}. A guide only — the amount stays in ${currency}.`}>
      ≈ {formatMoney(usd, "USD")}
    </span>
  );
}
