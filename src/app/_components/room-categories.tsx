"use client";

import type { CategoryContractStatus, Cleaning, RateInclusion } from "generated/prisma";
import { useEffect, useRef, useState } from "react";

import { Button, Field, friendlyError, Input, Label, Select } from "~/app/_components/form";
import { PendingLink } from "~/app/_components/pending-link";
import { formatMoney } from "~/lib/format";
import {
  categoryContractStatusHints,
  categoryContractStatusLabels,
  categoryContractStatusOrder,
  cleaningLabels,
  cleaningOrder,
  describeRateIncludes,
  rateInclusionLabels,
  rateInclusionOrder,
} from "~/lib/scouting";
import { api } from "~/trpc/react";

type Category = {
  id: string;
  name: string;
  unitCount: number;
  capacity: number;
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
  rateIncludes: RateInclusion[];
  rateIncludesOther: string | null;
  cleaning: Cleaning | null;
  cleaningOther: string | null;
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
  hotel,
  onStatusChange,
}: {
  scoutingEntryId: string;
  propertyId: string;
  eventId: string;
  categories: Category[];
  contracts: Contract[];
  available: (categoryId: string) => string;
  /** Hotels give a bed configuration; apartments bedrooms and bathrooms (§3.2). */
  hotel: boolean;
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
              <th className={th}>Contract</th>
              <th className={th}>Available</th>
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
                    propertyId={propertyId}
                    hotel={hotel}
                    category={category}
                    contract={contract}
                    onDone={() => setEditing(null)}
                  />
                );
              }
              return (
                <tr key={category.id}>
                  <td className={`${td} text-ink-900 font-medium whitespace-nowrap`}>{category.name}</td>
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
                  <td className={`${td} whitespace-nowrap`}>
                    {contract?.ratePerNightCents != null && contract.rateCurrency
                      ? formatMoney(contract.ratePerNightCents, contract.rateCurrency)
                      : "—"}
                  </td>
                  <td className={`${td} max-w-56`}>
                    {(contract &&
                      describeRateIncludes(
                        contract.rateIncludes,
                        contract.rateIncludesOther,
                        contract.cleaning,
                        contract.cleaningOther,
                      )) ??
                      "—"}
                  </td>
                  <td className={`${td} whitespace-nowrap`}>{percent(contract?.totBasisPoints ?? null) ?? "—"}</td>
                  <td className={`${td} max-w-56`}>{contract?.otherTaxes ?? "—"}</td>
                  <td className={`${td} max-w-44`}>{contract?.applicablePeriod ?? "—"}</td>
                  <td className={td}>{category.unitCount}</td>
                  <td className={`${td} whitespace-nowrap`}>{category.size ?? "—"}</td>
                  <td className={td}>{beds ?? "—"}</td>
                  <td className={td}>
                    <button
                      type="button"
                      onClick={() => setEditing(category.id)}
                      className="text-brand-700 text-xs font-light hover:underline"
                    >
                      Edit
                    </button>
                  </td>
                </tr>
              );
            })}
          </tbody>
        </table>
      </div>
      <p className="text-ink-500 mt-2 text-xs font-light">
        Rates, taxes and period are this event&apos;s. The name, units, size, bed configuration and notes
        are the property&apos;s own, the same on every event —{" "}
        <PendingLink
          href={`/properties/${propertyId}/edit?back=${encodeURIComponent(`/events/${eventId}`)}`}
          className="text-brand-700 hover:underline"
        >
          add or remove room categories on the property
        </PendingLink>
        .
      </p>
    </div>
  );
}

/**
 * One room category edited in place: its own details, which are the
 * property's, and its rates and taxes for this event.
 */
function EditRow({
  scoutingEntryId,
  propertyId,
  hotel,
  category,
  contract,
  onDone,
}: {
  scoutingEntryId: string;
  propertyId: string;
  hotel: boolean;
  category: Category;
  contract: Contract | undefined;
  onDone: () => void;
}) {
  const utils = api.useUtils();
  const [name, setName] = useState(category.name);
  const [units, setUnits] = useState(String(category.unitCount));
  const [size, setSize] = useState(category.size ?? "");
  const [beds, setBeds] = useState(category.bedConfiguration ?? "");
  const [bedrooms, setBedrooms] = useState(category.bedrooms?.toString() ?? "");
  const [bathrooms, setBathrooms] = useState(category.bathrooms?.toString() ?? "");
  const [notes, setNotes] = useState(category.notes ?? "");
  const [rate, setRate] = useState(
    contract?.ratePerNightCents != null ? (contract.ratePerNightCents / 100).toFixed(2) : "",
  );
  const [currency, setCurrency] = useState(contract?.rateCurrency ?? category.currency ?? "USD");
  const [includes, setIncludes] = useState<RateInclusion[]>(contract?.rateIncludes ?? []);
  const [includesOther, setIncludesOther] = useState(contract?.rateIncludesOther ?? "");
  // Ticking Cleaning comes before choosing how often, so the tick is kept apart.
  const [cleaningIncluded, setCleaningIncluded] = useState(contract?.cleaning != null);
  const [cleaning, setCleaning] = useState<Cleaning | "">(contract?.cleaning ?? "");
  const [cleaningOther, setCleaningOther] = useState(contract?.cleaningOther ?? "");
  const [tot, setTot] = useState(
    contract?.totBasisPoints != null ? (contract.totBasisPoints / 100).toFixed(2) : "",
  );
  const [otherTaxes, setOtherTaxes] = useState(contract?.otherTaxes ?? "");
  const [period, setPeriod] = useState(contract?.applicablePeriod ?? "");
  const [problem, setProblem] = useState<string | null>(null);

  const saveCategory = api.property.saveCategory.useMutation();
  const save = api.scouting.setCategoryTerms.useMutation({
    onSuccess: () => {
      void utils.scouting.listForEvent.invalidate();
      void utils.scouting.entry.invalidate();
      void utils.property.invalidate();
      onDone();
    },
  });
  const pending = saveCategory.isPending || save.isPending;
  const error = saveCategory.error ?? save.error;

  const submit = async () => {
    setProblem(null);
    const number = (value: string) => (value.trim() ? Number(value.replace(",", ".")) : undefined);
    if (!name.trim()) {
      setProblem("Give the room category a name.");
      return;
    }
    if ([units, bedrooms, bathrooms].some((value) => value.trim() && !Number.isFinite(number(value)))) {
      setProblem("Units, bedrooms and bathrooms should be numbers.");
      return;
    }
    const rateNumber = rate.trim() ? Number(rate.replace(",", ".")) : null;
    const totNumber = tot.trim() ? Number(tot.replace(",", ".").replace("%", "")) : null;
    if (rateNumber !== null && (!Number.isFinite(rateNumber) || rateNumber < 0)) {
      setProblem("The buying rate should be a number, like 281.50.");
      return;
    }
    if (cleaningIncluded && !cleaning) {
      setProblem("Choose how often the room is cleaned, or untick Cleaning.");
      return;
    }
    if (totNumber !== null && (!Number.isFinite(totNumber) || totNumber < 0 || totNumber > 100)) {
      setProblem("TOT should be a percentage between 0 and 100, like 15.");
      return;
    }
    // The category's own details first: if the property refuses them (fewer
    // units than inventory already numbered), the rates are not saved either.
    const same = (value: string, was: string | number | null) => value.trim() === (was?.toString() ?? "");
    const unchanged =
      same(name, category.name) &&
      same(units, category.unitCount) &&
      same(size, category.size) &&
      same(notes, category.notes) &&
      (hotel ? same(beds, category.bedConfiguration) : same(bedrooms, category.bedrooms) && same(bathrooms, category.bathrooms));
    if (!unchanged) try {
      await saveCategory.mutateAsync({
        propertyId,
        category: {
          id: category.id,
          name,
          unitCount: Math.max(0, Math.round(number(units) ?? 0)),
          capacity: category.capacity,
          currency: category.currency,
          bedConfiguration: hotel ? beds : undefined,
          bedrooms: hotel ? undefined : number(bedrooms),
          bathrooms: hotel ? undefined : number(bathrooms),
          size,
          notes,
        },
      });
    } catch {
      return; // shown below
    }
    save.mutate({
      scoutingEntryId,
      categoryId: category.id,
      // Typed in whole currency units, stored in minor units (§4.5).
      ratePerNightCents: rateNumber === null ? null : Math.round(rateNumber * 100),
      rateCurrency: rateNumber === null ? null : currency,
      rateIncludes: includes,
      rateIncludesOther: includesOther,
      cleaning: cleaningIncluded && cleaning ? cleaning : null,
      cleaningOther,
      totBasisPoints: totNumber === null ? null : Math.round(totNumber * 100),
      otherTaxes,
      applicablePeriod: period,
    });
  };

  // A full-width row of labelled fields, not boxes squeezed into the table's
  // columns — there, a rate or its currency could be cut off.
  return (
    <tr>
      <td colSpan={12} className="border-ink-200/40 bg-brand-50/40 border-b p-4">
        <p className="text-ink-900 mb-3 text-[13px] font-medium">Room category — the property&apos;s, the same on every event</p>
        <div className="grid max-w-4xl gap-3 sm:grid-cols-6">
          <Field label="Name" className="sm:col-span-2">
            <Input value={name} onChange={(e) => setName(e.target.value)} placeholder="Deluxe King" aria-label="Name" autoFocus />
          </Field>
          <Field label="# of units" className="sm:col-span-1">
            <Input value={units} onChange={(e) => setUnits(e.target.value)} inputMode="numeric" aria-label="# of units" />
          </Field>
          <Field label="Size" className="sm:col-span-1">
            <Input value={size} onChange={(e) => setSize(e.target.value)} placeholder="28 m²" aria-label="Size" />
          </Field>
          {hotel ? (
            <Field label="Bed configuration" className="sm:col-span-2">
              <Input value={beds} onChange={(e) => setBeds(e.target.value)} placeholder="1 King" aria-label="Bed configuration" />
            </Field>
          ) : (
            <>
              <Field label="Bedrooms" className="sm:col-span-1">
                <Input value={bedrooms} onChange={(e) => setBedrooms(e.target.value)} inputMode="numeric" aria-label="Bedrooms" />
              </Field>
              <Field label="Bathrooms" className="sm:col-span-1">
                <Input value={bathrooms} onChange={(e) => setBathrooms(e.target.value)} inputMode="decimal" aria-label="Bathrooms" />
              </Field>
            </>
          )}
          <Field label="Notes" className="sm:col-span-6">
            <Input value={notes} onChange={(e) => setNotes(e.target.value)} placeholder="Connecting rooms on request" aria-label="Notes" />
          </Field>
        </div>
        <p className="text-ink-900 mt-5 mb-3 text-[13px] font-medium">This event&apos;s rate and taxes</p>
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
          {/* Not a Field: a label around the list would tick the first item
              on any click inside it. */}
          <div className="sm:col-span-2">
            <Label>Rate include</Label>
            <RateIncludesPicker
              value={includes}
              onChange={setIncludes}
              other={includesOther}
              onOtherChange={setIncludesOther}
              cleaningIncluded={cleaningIncluded}
              onCleaningIncludedChange={setCleaningIncluded}
              cleaning={cleaning}
              onCleaningChange={setCleaning}
              cleaningOther={cleaningOther}
              onCleaningOtherChange={setCleaningOther}
            />
          </div>
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
          <Button type="button" disabled={pending} onClick={() => void submit()}>
            {pending ? "Saving…" : "Save"}
          </Button>
          <Button type="button" variant="ghost" onClick={onDone}>
            Cancel
          </Button>
          {(problem ?? error) && (
            <span className="text-xs text-[#c03654]">{problem ?? friendlyError(error)}</span>
          )}
        </div>
      </td>
    </tr>
  );
}

/**
 * What the rate includes: a dropdown of items to tick — cleaning among them,
 * which then asks how often — and a line for anything the list does not have.
 * The button reads back what is ticked.
 */
function RateIncludesPicker({
  value,
  onChange,
  other,
  onOtherChange,
  cleaningIncluded,
  onCleaningIncludedChange,
  cleaning,
  onCleaningChange,
  cleaningOther,
  onCleaningOtherChange,
}: {
  value: RateInclusion[];
  onChange: (value: RateInclusion[]) => void;
  other: string;
  onOtherChange: (other: string) => void;
  cleaningIncluded: boolean;
  onCleaningIncludedChange: (included: boolean) => void;
  cleaning: Cleaning | "";
  onCleaningChange: (cleaning: Cleaning | "") => void;
  cleaningOther: string;
  onCleaningOtherChange: (other: string) => void;
}) {
  const [open, setOpen] = useState(false);
  const box = useRef<HTMLDivElement>(null);

  // Closes when clicking anywhere else, as a dropdown does.
  useEffect(() => {
    if (!open) return;
    const close = (event: MouseEvent) => {
      if (box.current && !box.current.contains(event.target as Node)) setOpen(false);
    };
    document.addEventListener("mousedown", close);
    return () => document.removeEventListener("mousedown", close);
  }, [open]);

  const toggle = (item: RateInclusion) =>
    onChange(value.includes(item) ? value.filter((chosen) => chosen !== item) : [...value, item]);
  const summary =
    describeRateIncludes(value, other, cleaningIncluded && cleaning ? cleaning : null, cleaningOther) ??
    (cleaningIncluded ? "Cleaning" : null);

  return (
    <div ref={box} className="relative">
      <button
        type="button"
        onClick={() => setOpen(!open)}
        aria-expanded={open}
        aria-label="Rate include"
        className="border-ink-200 focus:border-brand-400 focus:ring-brand-400/20 flex w-full items-center justify-between gap-2 rounded-lg border bg-white px-3 py-2 text-left text-sm font-light outline-none focus:ring-4"
      >
        <span className={`truncate ${summary ? "" : "text-ink-400"}`}>{summary ?? "Choose what is included"}</span>
        <span className="text-ink-500 text-xs" aria-hidden>
          ▾
        </span>
      </button>
      {open && (
        <div className="border-ink-200 absolute z-20 mt-1 w-full min-w-56 rounded-lg border bg-white p-3 shadow-lg">
          <div className="space-y-2">
            {rateInclusionOrder.map((item) => (
              <label key={item} className="flex items-center gap-2 text-sm font-light">
                <input
                  type="checkbox"
                  className="accent-brand-400 h-4 w-4"
                  checked={value.includes(item)}
                  onChange={() => toggle(item)}
                />
                {rateInclusionLabels[item]}
              </label>
            ))}
            <label className="flex items-center gap-2 text-sm font-light">
              <input
                type="checkbox"
                className="accent-brand-400 h-4 w-4"
                checked={cleaningIncluded}
                onChange={() => onCleaningIncludedChange(!cleaningIncluded)}
              />
              Cleaning
            </label>
            {cleaningIncluded && (
              <div className="border-ink-200/60 ml-6 space-y-2 border-l pl-3">
                <p className="text-ink-500 text-xs font-light">How often?</p>
                {cleaningOrder.map((option) => (
                  <label key={option} className="flex items-center gap-2 text-sm font-light">
                    <input
                      type="radio"
                      name="cleaning"
                      className="accent-brand-400 h-4 w-4"
                      checked={cleaning === option}
                      onChange={() => onCleaningChange(option)}
                    />
                    {cleaningLabels[option]}
                  </label>
                ))}
                {cleaning === "OTHER" && (
                  <Input
                    value={cleaningOther}
                    onChange={(e) => onCleaningOtherChange(e.target.value)}
                    placeholder="Every 3 days"
                    aria-label="Cleaning, in words"
                  />
                )}
              </div>
            )}
          </div>
          <div className="mt-3">
            <Input
              value={other}
              onChange={(e) => onOtherChange(e.target.value)}
              placeholder="Anything else, e.g. TOT & TMD"
              aria-label="Rate include, other"
            />
          </div>
          <div className="mt-2 text-right">
            <button type="button" onClick={() => setOpen(false)} className="text-brand-700 text-xs hover:underline">
              Done
            </button>
          </div>
        </div>
      )}
    </div>
  );
}
