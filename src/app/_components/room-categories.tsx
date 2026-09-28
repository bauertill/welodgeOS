"use client";

import type { CategoryContractStatus } from "generated/prisma";
import { useState } from "react";

import { Button, Field, friendlyError, Input, Select } from "~/app/_components/form";
import { PendingLink } from "~/app/_components/pending-link";
import { formatMoney } from "~/lib/format";
import {
  categoryContractStatusHints,
  categoryContractStatusLabels,
  categoryContractStatusOrder,
} from "~/lib/scouting";
import { api } from "~/trpc/react";

type Category = {
  id: string;
  name: string;
  unitCount: number;
  bedConfiguration: string | null;
  bedrooms: number | null;
  bathrooms: number | null;
  size: string | null;
  notes: string | null;
  currency: string;
};

type Contract = {
  categoryId: string;
  status: CategoryContractStatus;
  ratePerNightCents: number | null;
  rateCurrency: string | null;
  rateIncludes: string | null;
  totBasisPoints: number | null;
  otherTaxes: string | null;
  applicablePeriod: string | null;
};

const CURRENCIES = ["USD", "EUR", "CHF", "GBP"];

/** "15.00%" from 1500 — TOT is kept in hundredths of a percent. */
const percent = (basisPoints: number | null) =>
  basisPoints === null ? null : `${(basisPoints / 100).toFixed(2)}%`;

/**
 * A property's room categories on an event's Properties tab (doc §3.9) — the
 * Monday board's subitems, in its column order. The rate, what it includes,
 * the taxes and the period are this event's, edited here row by row; the
 * rest belongs to the property and is changed on its form.
 */
export function RoomCategoryTable({
  scoutingEntryId,
  propertyId,
  eventId,
  categories,
  contracts,
  available,
  onStatusChange,
}: {
  scoutingEntryId: string;
  propertyId: string;
  eventId: string;
  categories: Category[];
  contracts: Contract[];
  available: (categoryId: string) => string;
  onStatusChange: (categoryId: string, status: CategoryContractStatus) => void;
}) {
  const [editing, setEditing] = useState<string | null>(null);
  const contractOf = (categoryId: string) => contracts.find((contract) => contract.categoryId === categoryId);

  const th = "text-ink-500 border-ink-200/60 border-b px-3 py-2 text-[10px] font-medium tracking-wider whitespace-nowrap uppercase";
  const td = "border-ink-200/40 border-b px-3 py-2 align-top text-[13px] font-light";

  return (
    <div className="ml-5">
      <div className="border-ink-200/60 overflow-x-auto rounded-lg border">
        <table className="w-full text-left">
          <thead className="bg-ink-50/60">
            <tr>
              <th className={th}>Room category</th>
              <th className={th} title="What we pay the hotel per night, as contracted for this event. The indicative, Booking-style price is on the property's own page.">
                Buying rate
              </th>
              <th className={th}>Rate include</th>
              <th className={th} title="Transient Occupancy Tax — the city's hotel tax on the room rate, as a percentage">
                TOT
              </th>
              <th className={th}>Other applicable tax</th>
              <th className={th}>Applicable period</th>
              <th className={th}># of units</th>
              <th className={th}>Size</th>
              <th className={th}>Bed configuration</th>
              <th className={th}>Notes</th>
              <th className={th}>Contract</th>
              <th className={th}>Available</th>
              <th className={th}>{""}</th>
            </tr>
          </thead>
          <tbody>
            {categories.map((category) => {
              const contract = contractOf(category.id);
              const status = contract?.status ?? "IN_NEGOTIATION";
              const beds =
                category.bedConfiguration ??
                ([
                  category.bedrooms !== null ? `${category.bedrooms} bedroom${category.bedrooms === 1 ? "" : "s"}` : null,
                  category.bathrooms !== null ? `${category.bathrooms} bath` : null,
                ]
                  .filter(Boolean)
                  .join(" · ") ||
                  null);
              if (editing === category.id) {
                return (
                  <EditRow
                    key={category.id}
                    scoutingEntryId={scoutingEntryId}
                    category={category}
                    contract={contract}
                    onDone={() => setEditing(null)}
                  />
                );
              }
              return (
                <tr key={category.id}>
                  <td className={`${td} text-ink-900 font-medium whitespace-nowrap`}>{category.name}</td>
                  <td className={`${td} whitespace-nowrap`}>
                    {contract?.ratePerNightCents != null && contract.rateCurrency
                      ? formatMoney(contract.ratePerNightCents, contract.rateCurrency)
                      : "—"}
                  </td>
                  <td className={td}>{contract?.rateIncludes ?? "—"}</td>
                  <td className={`${td} whitespace-nowrap`}>{percent(contract?.totBasisPoints ?? null) ?? "—"}</td>
                  <td className={`${td} max-w-56`}>{contract?.otherTaxes ?? "—"}</td>
                  <td className={`${td} max-w-44`}>{contract?.applicablePeriod ?? "—"}</td>
                  <td className={td}>{category.unitCount}</td>
                  <td className={`${td} whitespace-nowrap`}>{category.size ?? "—"}</td>
                  <td className={td}>{beds ?? "—"}</td>
                  <td className={`${td} max-w-56`}>{category.notes ?? "—"}</td>
                  <td className={td}>
                    <Select
                      value={status}
                      title={categoryContractStatusHints[status]}
                      onChange={(e) => onStatusChange(category.id, e.target.value as CategoryContractStatus)}
                      className="w-36 min-w-36 py-1 text-[12px]"
                    >
                      {categoryContractStatusOrder.map((option) => (
                        <option key={option} value={option}>
                          {categoryContractStatusLabels[option]}
                        </option>
                      ))}
                    </Select>
                  </td>
                  <td className={`${td} text-ink-500 text-xs whitespace-nowrap`}>{available(category.id)}</td>
                  <td className={td}>
                    <button
                      type="button"
                      onClick={() => setEditing(category.id)}
                      className="text-brand-700 text-xs font-light hover:underline"
                    >
                      Edit rate
                    </button>
                  </td>
                </tr>
              );
            })}
          </tbody>
        </table>
      </div>
      <p className="text-ink-500 mt-2 text-xs font-light">
        Rates, taxes and period are this event&apos;s. Units, size, bed configuration and notes are the
        property&apos;s own —{" "}
        <PendingLink
          href={`/properties/${propertyId}/edit?back=${encodeURIComponent(`/events/${eventId}`)}`}
          className="text-brand-700 hover:underline"
        >
          change them on the property
        </PendingLink>
        .
      </p>
    </div>
  );
}

/** One room category's rates and taxes for this event, edited in place. */
function EditRow({
  scoutingEntryId,
  category,
  contract,
  onDone,
}: {
  scoutingEntryId: string;
  category: Category;
  contract: Contract | undefined;
  onDone: () => void;
}) {
  const utils = api.useUtils();
  const [rate, setRate] = useState(
    contract?.ratePerNightCents != null ? (contract.ratePerNightCents / 100).toFixed(2) : "",
  );
  const [currency, setCurrency] = useState(contract?.rateCurrency ?? category.currency ?? "USD");
  const [includes, setIncludes] = useState(contract?.rateIncludes ?? "");
  const [tot, setTot] = useState(
    contract?.totBasisPoints != null ? (contract.totBasisPoints / 100).toFixed(2) : "",
  );
  const [otherTaxes, setOtherTaxes] = useState(contract?.otherTaxes ?? "");
  const [period, setPeriod] = useState(contract?.applicablePeriod ?? "");
  const [problem, setProblem] = useState<string | null>(null);

  const save = api.scouting.setCategoryTerms.useMutation({
    onSuccess: () => {
      void utils.scouting.listForEvent.invalidate();
      void utils.scouting.entry.invalidate();
      onDone();
    },
  });

  const submit = () => {
    setProblem(null);
    const rateNumber = rate.trim() ? Number(rate.replace(",", ".")) : null;
    const totNumber = tot.trim() ? Number(tot.replace(",", ".").replace("%", "")) : null;
    if (rateNumber !== null && (!Number.isFinite(rateNumber) || rateNumber < 0)) {
      setProblem("The buying rate should be a number, like 281.50.");
      return;
    }
    if (totNumber !== null && (!Number.isFinite(totNumber) || totNumber < 0 || totNumber > 100)) {
      setProblem("TOT should be a percentage between 0 and 100, like 15.");
      return;
    }
    save.mutate({
      scoutingEntryId,
      categoryId: category.id,
      // Typed in whole currency units, stored in minor units (§4.5).
      ratePerNightCents: rateNumber === null ? null : Math.round(rateNumber * 100),
      rateCurrency: rateNumber === null ? null : currency,
      rateIncludes: includes,
      totBasisPoints: totNumber === null ? null : Math.round(totNumber * 100),
      otherTaxes,
      applicablePeriod: period,
    });
  };

  // A full-width row of labelled fields, not boxes squeezed into the table's
  // columns — there, a rate or its currency could be cut off.
  return (
    <tr>
      <td colSpan={13} className="border-ink-200/40 bg-brand-50/40 border-b p-4">
        <p className="text-ink-900 mb-3 text-[13px] font-medium">{category.name} — this event&apos;s rate and taxes</p>
        <div className="grid max-w-4xl gap-3 sm:grid-cols-6">
          <Field label="Buying rate, per night" className="sm:col-span-2">
            {/* Widths are set on wrappers: the boxes themselves always fill
                whatever holds them, so the currency could otherwise crowd
                out the amount. */}
            <div className="flex gap-2">
              <div className="min-w-0 flex-1">
                <Input
                  value={rate}
                  onChange={(e) => setRate(e.target.value)}
                  placeholder="281.50"
                  inputMode="decimal"
                  aria-label="Buying rate"
                  autoFocus
                />
              </div>
              <div className="w-24 shrink-0">
                <Select value={currency} onChange={(e) => setCurrency(e.target.value)} aria-label="Currency">
                  {(CURRENCIES.includes(currency) ? CURRENCIES : [currency, ...CURRENCIES]).map((option) => (
                    <option key={option}>{option}</option>
                  ))}
                </Select>
              </div>
            </div>
          </Field>
          <Field label="Rate include" className="sm:col-span-2">
            <Input value={includes} onChange={(e) => setIncludes(e.target.value)} placeholder="TOT & TMD" aria-label="Rate include" />
          </Field>
          <Field label="TOT (Transient Occupancy Tax), %" className="sm:col-span-2" hint="The city's hotel tax on the room rate — about 14–16% in Los Angeles.">
            <Input value={tot} onChange={(e) => setTot(e.target.value)} placeholder="15.00" inputMode="decimal" aria-label="TOT %" />
          </Field>
          <Field label="Other applicable tax" className="sm:col-span-3">
            <Input value={otherTaxes} onChange={(e) => setOtherTaxes(e.target.value)} placeholder="TMD: 6.25 USD (ADR 200–300)" aria-label="Other applicable tax" />
          </Field>
          <Field label="Applicable period" className="sm:col-span-3">
            <Input value={period} onChange={(e) => setPeriod(e.target.value)} placeholder="10 Jul – 31 Jul 2028" aria-label="Applicable period" />
          </Field>
        </div>
        <div className="mt-3 flex flex-wrap items-center gap-2">
          <Button type="button" disabled={save.isPending} onClick={submit}>
            {save.isPending ? "Saving…" : "Save"}
          </Button>
          <Button type="button" variant="ghost" onClick={onDone}>
            Cancel
          </Button>
          {(problem ?? save.error) && (
            <span className="text-xs text-[#c03654]">{problem ?? friendlyError(save.error)}</span>
          )}
        </div>
      </td>
    </tr>
  );
}
