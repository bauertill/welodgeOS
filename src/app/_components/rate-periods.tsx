"use client";

import { Input, Select } from "~/app/_components/form";
import { addDays, dayKey, nightsBetween, parseDay } from "~/lib/dates";
import { formatDay } from "~/lib/format";

/**
 * A stay priced by period (doc §4.8) — a pre rate, the event rate and a post
 * rate — each with its own dates and price per night. Together the periods
 * run from check-in to check-out, one after another.
 */

export type RatePeriod = { checkIn: string; checkOut: string; price: string };

const CURRENCIES = ["USD", "EUR", "CHF", "GBP"];

/** Splits the stay in two at its middle night, as a starting point for a new period. */
export function splitPeriod(periods: RatePeriod[], index: number): RatePeriod[] {
  const period = periods[index]!;
  const nights = nightsBetween(parseDay(period.checkIn), parseDay(period.checkOut));
  if (nights < 2) return periods;
  const middle = dayKey(addDays(parseDay(period.checkIn), Math.floor(nights / 2)));
  return [
    ...periods.slice(0, index),
    { ...period, checkOut: middle },
    { checkIn: middle, checkOut: period.checkOut, price: "" },
    ...periods.slice(index + 1),
  ];
}

/**
 * What is wrong with the periods, if anything: each needs a price, and they must
 * run from the stay's check-in to its check-out with no gap and no overlap.
 */
export function periodProblem(periods: RatePeriod[], checkIn: string, checkOut: string): string | null {
  if (periods.length === 0) return "Add at least one period.";
  const sorted = [...periods].sort((a, b) => a.checkIn.localeCompare(b.checkIn));
  for (const period of sorted) {
    if (!period.checkIn || !period.checkOut || period.checkOut <= period.checkIn) {
      return "Each period needs a check-in and a check-out after it.";
    }
    const price = Number(period.price.replace(",", "."));
    if (!period.price.trim() || !Number.isFinite(price) || price < 0) return "Give each period its price per night, like 350.";
  }
  if (sorted[0]!.checkIn !== checkIn) return `The first period should start on check-in, ${formatDay(parseDay(checkIn))}.`;
  if (sorted.at(-1)!.checkOut !== checkOut) return `The last period should end on check-out, ${formatDay(parseDay(checkOut))}.`;
  for (let i = 1; i < sorted.length; i++) {
    const before = sorted[i - 1]!;
    const period = sorted[i]!;
    if (period.checkIn > before.checkOut) return `Nothing covers ${formatDay(parseDay(before.checkOut))} – ${formatDay(parseDay(period.checkIn))}: periods must follow on from each other.`;
    if (period.checkIn < before.checkOut) return `Two periods overlap around ${formatDay(parseDay(period.checkIn))}.`;
  }
  return null;
}

export function RatePeriods({
  periods,
  onChange,
  currency,
  onCurrencyChange,
}: {
  periods: RatePeriod[];
  onChange: (periods: RatePeriod[]) => void;
  currency: string;
  onCurrencyChange: (currency: string) => void;
}) {
  const set = (index: number, key: keyof RatePeriod, value: string) => {
    const next = periods.map((period, i) => (i === index ? { ...period, [key]: value } : period));
    // Moving where one period ends moves where the next begins, so they stay joined.
    if (key === "checkOut" && next[index + 1]) next[index + 1] = { ...next[index + 1]!, checkIn: value };
    if (key === "checkIn" && index > 0 && next[index - 1]) next[index - 1] = { ...next[index - 1]!, checkOut: value };
    onChange(next);
  };
  const remove = (index: number) => {
    if (periods.length < 2) return;
    const next = periods.filter((_, i) => i !== index);
    // The neighbour takes over the removed period's nights.
    if (index > 0) next[index - 1] = { ...next[index - 1]!, checkOut: periods[index]!.checkOut };
    else next[0] = { ...next[0]!, checkIn: periods[0]!.checkIn };
    onChange(next);
  };
  return (
    <div className="border-ink-200/60 space-y-3 rounded-lg border p-3">
      <div className="flex items-center justify-between gap-2">
        <span className="text-ink-500 text-xs font-light">
          {periods.length} {periods.length === 1 ? "period" : "periods"}
        </span>
        <div className="w-24">
          <Select value={currency} onChange={(e) => onCurrencyChange(e.target.value)} className="py-1 text-xs" aria-label="Currency">
            {CURRENCIES.map((code) => (
              <option key={code}>{code}</option>
            ))}
          </Select>
        </div>
      </div>
      {periods.map((period, index) => (
        <div key={index} className="border-ink-200/60 border-t pt-3 first:border-t-0 first:pt-0">
          <div className="grid grid-cols-[minmax(0,1fr)_minmax(0,1fr)_6.5rem] gap-2">
            <label className="min-w-0">
              <span className="text-ink-500 mb-1 block text-[11px]">From</span>
              <Input type="date" value={period.checkIn} onChange={(e) => set(index, "checkIn", e.target.value)} aria-label={`Period ${index + 1} from`} disabled={index === 0} className="px-2 text-[13px]" />
            </label>
            <label className="min-w-0">
              <span className="text-ink-500 mb-1 block text-[11px]">To (check-out)</span>
              <Input type="date" value={period.checkOut} onChange={(e) => set(index, "checkOut", e.target.value)} aria-label={`Period ${index + 1} to`} disabled={index === periods.length - 1} className="px-2 text-[13px]" />
            </label>
            <label className="min-w-0">
              <span className="text-ink-500 mb-1 block text-[11px]">Per night</span>
              <Input value={period.price} onChange={(e) => set(index, "price", e.target.value)} inputMode="decimal" placeholder="350.00" aria-label={`Period ${index + 1} price`} className="px-2 text-[13px]" />
            </label>
          </div>
          <div className="mt-1 flex justify-end gap-3 text-xs">
            <button type="button" onClick={() => onChange(splitPeriod(periods, index))} className="text-brand-700 hover:underline" title="Split this period in two">
              Split
            </button>
            {periods.length > 1 && (
              <button type="button" onClick={() => remove(index)} className="text-[#c03654] hover:underline">
                Remove
              </button>
            )}
          </div>
        </div>
      ))}
      <p className="text-ink-500 text-xs font-light">
        <strong className="font-medium">Split</strong> a period to give part of it another rate — a pre rate, the event rate, a
        post rate. The first starts on check-in and the last ends on check-out; moving where one ends moves where the next
        begins.
      </p>
    </div>
  );
}

/** One period covering the whole stay, as the starting point. */
export const wholeStay = (checkIn: string, checkOut: string, price: string): RatePeriod[] => [{ checkIn, checkOut, price }];
