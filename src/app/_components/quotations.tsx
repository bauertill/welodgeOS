"use client";

import type { QuotationStatus } from "generated/prisma";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { useState } from "react";

import { Button, Field, FormError, friendlyError, Input, Select, Textarea } from "~/app/_components/form";
import { dayKey } from "~/lib/dates";
import { formatDate, formatMoney, formatRange } from "~/lib/format";
import { contractHref } from "~/lib/finance";
import { api, type RouterOutputs } from "~/trpc/react";

/**
 * A hotel's quotations for an event (doc §3.10): each one a scenario — a group,
 * periods and room categories with rooms and rates, and the terms offered —
 * kept apart from the hotel's general details. An accepted one becomes the
 * supplier contract.
 */

type Quotation = RouterOutputs["quotation"]["forEntry"][number];
type Category = { id: string; name: string };

const CURRENCIES = ["USD", "EUR", "CHF", "GBP"];
const th = "text-ink-500 border-ink-200/60 border-b px-3 py-2 text-[10px] font-medium tracking-wider whitespace-nowrap uppercase";
const td = "border-ink-200/40 border-b px-3 py-2 align-top text-[13px] font-light";

export const quotationStatusLabels: Record<QuotationStatus, string> = {
  RECEIVED: "Received",
  ACCEPTED: "Accepted",
  DECLINED: "Declined",
};
const statusStyles: Record<QuotationStatus, string> = {
  RECEIVED: "bg-[#e6f0fb] text-[#1d5fa8]",
  ACCEPTED: "bg-[#e3f8ee] text-[#0a7a47]",
  DECLINED: "bg-ink-50 text-ink-500",
};

export function QuotationsSection({
  scoutingEntryId,
  eventId,
  categories,
  stay,
}: {
  scoutingEntryId: string;
  eventId: string;
  categories: Category[];
  /** The event's own dates, as a starting point for a new line. */
  stay: { checkIn: string; checkOut: string };
}) {
  const quotations = api.quotation.forEntry.useQuery({ scoutingEntryId });
  const [editing, setEditing] = useState<string | "new" | null>(null);
  const rows = quotations.data ?? [];
  return (
    // Sticky and capped: the row it opens in belongs to a table far wider than
    // the screen, which scrolls sideways.
    <div className="border-ink-200/60 sticky left-5 mt-4 ml-5 max-w-5xl border-t pt-4">
      <div className="mb-3 flex items-baseline justify-between gap-3">
        <h3 className="text-ink-900 text-[14px] font-medium">
          Quotations{rows.length > 0 && <span className="text-ink-500 ml-1.5 text-xs font-light">{rows.length}</span>}
        </h3>
        {editing === null && (
          <button type="button" onClick={() => setEditing("new")} className="text-brand-700 text-[13px] font-medium hover:underline">
            + Add quotation
          </button>
        )}
      </div>
      {editing === "new" && (
        <QuotationEditor scoutingEntryId={scoutingEntryId} categories={categories} stay={stay} onDone={() => setEditing(null)} />
      )}
      {rows.length === 0 && editing !== "new" ? (
        <p className="text-ink-500 text-[13px] font-light">
          None yet. Add each quotation the hotel sends — different periods, rooms or groups are separate scenarios.
        </p>
      ) : (
        <div className="space-y-3">
          {rows.map((quotation) =>
            editing === quotation.id ? (
              <QuotationEditor
                key={quotation.id}
                scoutingEntryId={scoutingEntryId}
                categories={categories}
                stay={stay}
                quotation={quotation}
                onDone={() => setEditing(null)}
              />
            ) : (
              <QuotationCard key={quotation.id} quotation={quotation} eventId={eventId} onEdit={() => setEditing(quotation.id)} />
            ),
          )}
        </div>
      )}
    </div>
  );
}

function QuotationCard({ quotation, eventId, onEdit }: { quotation: Quotation; eventId: string; onEdit: () => void }) {
  const router = useRouter();
  const utils = api.useUtils();
  const refresh = () => {
    void utils.quotation.invalidate();
    void utils.scouting.listForEvent.invalidate();
    void utils.finance.invalidate();
  };
  const setStatus = api.quotation.setStatus.useMutation({ onSuccess: refresh });
  const remove = api.quotation.remove.useMutation({ onSuccess: refresh });
  const makeContract = api.quotation.makeContract.useMutation({
    onSuccess: (contract) => {
      refresh();
      router.push(contractHref(contract.eventId, contract.id));
    },
  });
  const error = setStatus.error ?? remove.error ?? makeContract.error;
  const terms = [
    ["Payment terms", quotation.paymentTerms],
    ["Cancellation terms", quotation.cancellationTerms],
    ["Rates include", quotation.ratesInclude],
  ].filter(([, value]) => value) as [string, string][];

  return (
    <div className={`border-ink-200/60 rounded-lg border bg-white p-3 ${quotation.status === "DECLINED" ? "opacity-60" : ""}`}>
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div className="min-w-0">
          <p className="text-ink-900 text-[14px] font-medium">
            {quotation.name}
            <span className={`ml-2 rounded-full px-2 py-0.5 align-middle text-[11px] font-medium ${statusStyles[quotation.status]}`}>
              {quotationStatusLabels[quotation.status]}
            </span>
          </p>
          <p className="text-ink-500 mt-0.5 text-xs font-light">
            {[
              quotation.from && quotation.to ? formatRange(quotation.from, quotation.to) : null,
              `${quotation.roomNights} room-nights`,
              quotation.persons ? `${quotation.persons} persons` : null,
              quotation.receivedOn ? `received ${formatDate(quotation.receivedOn)}` : null,
              quotation.validUntil ? `valid until ${formatDate(quotation.validUntil)}` : null,
            ]
              .filter(Boolean)
              .join(" · ")}
          </p>
        </div>
        <p className="text-ink-900 text-[15px] font-semibold whitespace-nowrap">{formatMoney(quotation.totalCents, quotation.currency)}</p>
      </div>

      <div className="border-ink-200/60 mt-3 overflow-x-auto rounded-lg border">
        <table className="w-full text-left">
          <thead className="bg-ink-50/60">
            <tr>
              <th className={th}>Room category</th>
              <th className={th}>Period</th>
              <th className={th}>Rooms</th>
              <th className={th}>Per night</th>
              <th className={th}>Room-nights</th>
              <th className={th}>Total</th>
            </tr>
          </thead>
          <tbody>
            {quotation.lines.map((line) => (
              <tr key={line.id}>
                <td className={`${td} text-ink-900`}>
                  {line.category.name}
                  {line.occupancy && <span className="text-ink-500 block text-xs">{line.occupancy} per room</span>}
                </td>
                <td className={`${td} whitespace-nowrap`}>
                  {formatRange(line.checkIn, line.checkOut)}
                  <span className="text-ink-500 block text-xs">{line.nights} nights</span>
                </td>
                <td className={td}>{line.rooms}</td>
                <td className={`${td} whitespace-nowrap`}>{formatMoney(line.rateCents, quotation.currency)}</td>
                <td className={td}>{line.roomNights}</td>
                <td className={`${td} whitespace-nowrap`}>{formatMoney(line.totalCents, quotation.currency)}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>

      {terms.length > 0 && (
        <dl className="mt-3 space-y-1 text-[13px] font-light">
          {terms.map(([label, value]) => (
            <div key={label} className="flex gap-3">
              <dt className="text-ink-500 w-36 shrink-0">{label}</dt>
              <dd className="text-ink-900 min-w-0 whitespace-pre-line">{value}</dd>
            </div>
          ))}
        </dl>
      )}
      {quotation.notes && <p className="text-ink-700 mt-2 text-[13px] font-light whitespace-pre-line">{quotation.notes}</p>}

      <div className="mt-3 flex flex-wrap items-center gap-x-4 gap-y-2 text-xs">
        {quotation.documentUrl && (
          <a href={quotation.documentUrl} target="_blank" rel="noreferrer" className="text-brand-700 hover:underline">
            Open the quotation ↗
          </a>
        )}
        <button type="button" onClick={onEdit} className="text-brand-700 hover:underline">
          Edit
        </button>
        {quotation.contract ? (
          <Link href={contractHref(quotation.contract.eventId, quotation.contract.id)} className="text-brand-700 font-medium hover:underline">
            Open its contract →
          </Link>
        ) : (
          <>
            {quotation.status !== "DECLINED" && (
              <button
                type="button"
                disabled={makeContract.isPending}
                onClick={() =>
                  window.confirm(
                    `Accept "${quotation.name}" and make it the supplier contract, worth ${formatMoney(quotation.totalCents, quotation.currency)}?`,
                  ) && makeContract.mutate({ id: quotation.id })
                }
                className="text-brand-700 font-medium hover:underline"
              >
                {makeContract.isPending ? "Making the contract…" : "Accept and make the contract"}
              </button>
            )}
            {quotation.status === "RECEIVED" ? (
              <button type="button" onClick={() => setStatus.mutate({ id: quotation.id, status: "DECLINED" })} className="text-ink-500 hover:underline">
                Decline
              </button>
            ) : (
              <button type="button" onClick={() => setStatus.mutate({ id: quotation.id, status: "RECEIVED" })} className="text-ink-500 hover:underline">
                Back to received
              </button>
            )}
            <button
              type="button"
              onClick={() => window.confirm(`Remove the quotation "${quotation.name}"?`) && remove.mutate({ id: quotation.id })}
              className="ml-auto text-[#c03654] hover:underline"
            >
              Remove
            </button>
          </>
        )}
      </div>
      {error && <FormError message={friendlyError(error)} />}
    </div>
  );
}

type LineDraft = { categoryId: string; checkIn: string; checkOut: string; rooms: string; rate: string; occupancy: string };

function QuotationEditor({
  scoutingEntryId,
  categories,
  stay,
  quotation,
  onDone,
}: {
  scoutingEntryId: string;
  categories: Category[];
  stay: { checkIn: string; checkOut: string };
  quotation?: Quotation;
  onDone: () => void;
}) {
  const utils = api.useUtils();
  const [draft, setDraft] = useState({
    name: quotation?.name ?? "",
    receivedOn: quotation?.receivedOn ? dayKey(quotation.receivedOn) : "",
    validUntil: quotation?.validUntil ? dayKey(quotation.validUntil) : "",
    persons: quotation?.persons?.toString() ?? "",
    currency: quotation?.currency ?? "USD",
    paymentTerms: quotation?.paymentTerms ?? "",
    cancellationTerms: quotation?.cancellationTerms ?? "",
    ratesInclude: quotation?.ratesInclude ?? "",
    documentUrl: quotation?.documentUrl ?? "",
    notes: quotation?.notes ?? "",
  });
  const blankLine = (from?: LineDraft): LineDraft => ({
    categoryId: from?.categoryId ?? categories[0]?.id ?? "",
    checkIn: from?.checkOut ?? stay.checkIn,
    checkOut: stay.checkOut,
    rooms: from?.rooms ?? "",
    rate: "",
    occupancy: "",
  });
  const [lines, setLines] = useState<LineDraft[]>(
    quotation?.lines.map((line) => ({
      categoryId: line.categoryId,
      checkIn: dayKey(line.checkIn),
      checkOut: dayKey(line.checkOut),
      rooms: String(line.rooms),
      rate: (line.rateCents / 100).toFixed(2),
      occupancy: line.occupancy?.toString() ?? "",
    })) ?? [blankLine()],
  );
  const [problem, setProblem] = useState<string | null>(null);
  const set = (key: keyof typeof draft) => (value: string) => setDraft((current) => ({ ...current, [key]: value }));
  const setLine = (index: number, key: keyof LineDraft, value: string) =>
    setLines((current) => current.map((line, i) => (i === index ? { ...line, [key]: value } : line)));
  const save = api.quotation.save.useMutation({
    onSuccess: () => {
      void utils.quotation.invalidate();
      void utils.scouting.listForEvent.invalidate();
      onDone();
    },
  });

  // What the lines come to, as they are typed.
  const total = lines.reduce((sum, line) => {
    const nights = line.checkIn && line.checkOut ? Math.max(0, (Date.parse(line.checkOut) - Date.parse(line.checkIn)) / 86_400_000) : 0;
    const rate = Number(line.rate.replace(",", "."));
    return sum + (Number.isFinite(rate) ? nights * (Number(line.rooms) || 0) * rate : 0);
  }, 0);

  return (
    <form
      className="border-brand-200 bg-brand-50/40 space-y-4 rounded-lg border p-4"
      onSubmit={(e) => {
        e.preventDefault();
        setProblem(null);
        if (!draft.name.trim()) return setProblem("Give the quotation a name — the group or scenario, like Austria House staff.");
        const parsed = [];
        for (const [i, line] of lines.entries()) {
          const rooms = Number(line.rooms);
          const rate = Number(line.rate.replace(",", "."));
          if (!line.categoryId) return setProblem(`Line ${i + 1}: choose the room category.`);
          if (!line.checkIn || !line.checkOut || line.checkOut <= line.checkIn) return setProblem(`Line ${i + 1}: give a check-in and a check-out after it.`);
          if (!Number.isInteger(rooms) || rooms < 1) return setProblem(`Line ${i + 1}: say how many rooms, like 20.`);
          if (!line.rate.trim() || !Number.isFinite(rate) || rate < 0) return setProblem(`Line ${i + 1}: give the rate per night, like 315.`);
          const occupancy = line.occupancy.trim() ? Number(line.occupancy) : null;
          if (occupancy !== null && (!Number.isInteger(occupancy) || occupancy < 1)) return setProblem(`Line ${i + 1}: people per room should be a whole number.`);
          parsed.push({ categoryId: line.categoryId, checkIn: line.checkIn, checkOut: line.checkOut, rooms, rateCents: Math.round(rate * 100), occupancy });
        }
        const persons = draft.persons.trim() ? Number(draft.persons) : null;
        if (persons !== null && (!Number.isInteger(persons) || persons < 0)) return setProblem("Persons should be a whole number.");
        save.mutate({ scoutingEntryId, id: quotation?.id, quotation: { ...draft, persons, lines: parsed } });
      }}
    >
      <div className="grid gap-3 sm:grid-cols-6">
        <Field label="Name — the group or scenario" className="sm:col-span-3">
          <Input value={draft.name} onChange={(e) => set("name")(e.target.value)} placeholder="Austria House staff" autoFocus />
        </Field>
        <Field label="Received on" className="sm:col-span-1">
          <Input type="date" value={draft.receivedOn} onChange={(e) => set("receivedOn")(e.target.value)} />
        </Field>
        <Field label="Valid until" className="sm:col-span-1">
          <Input type="date" value={draft.validUntil} onChange={(e) => set("validUntil")(e.target.value)} />
        </Field>
        <Field label="Persons" className="sm:col-span-1">
          <Input value={draft.persons} onChange={(e) => set("persons")(e.target.value)} inputMode="numeric" placeholder="60" />
        </Field>
      </div>

      <div>
        <div className="mb-1.5 flex items-center justify-between gap-3">
          <span className="text-ink-700 text-[13px] font-medium">Rooms and rates — a line per room category and period</span>
          <div className="w-24">
            <Select value={draft.currency} onChange={(e) => set("currency")(e.target.value)} aria-label="Currency" className="py-1 text-xs">
              {CURRENCIES.map((code) => (
                <option key={code}>{code}</option>
              ))}
            </Select>
          </div>
        </div>
        <div className="space-y-2">
          {lines.map((line, index) => (
            <div key={index} className="grid grid-cols-2 gap-2 sm:grid-cols-[minmax(0,2fr)_minmax(0,1.2fr)_minmax(0,1.2fr)_5rem_6rem_5rem_auto] sm:items-end">
              <label className="col-span-2 min-w-0 sm:col-span-1">
                <span className="text-ink-500 mb-1 block text-[11px]">Room category</span>
                <Select value={line.categoryId} onChange={(e) => setLine(index, "categoryId", e.target.value)} aria-label={`Line ${index + 1} category`}>
                  {categories.map((category) => (
                    <option key={category.id} value={category.id}>
                      {category.name}
                    </option>
                  ))}
                </Select>
              </label>
              <label className="min-w-0">
                <span className="text-ink-500 mb-1 block text-[11px]">Check-in</span>
                <Input type="date" value={line.checkIn} onChange={(e) => setLine(index, "checkIn", e.target.value)} aria-label={`Line ${index + 1} check-in`} className="px-2" />
              </label>
              <label className="min-w-0">
                <span className="text-ink-500 mb-1 block text-[11px]">Check-out</span>
                <Input type="date" value={line.checkOut} onChange={(e) => setLine(index, "checkOut", e.target.value)} aria-label={`Line ${index + 1} check-out`} className="px-2" />
              </label>
              <label className="min-w-0">
                <span className="text-ink-500 mb-1 block text-[11px]">Rooms</span>
                <Input value={line.rooms} onChange={(e) => setLine(index, "rooms", e.target.value)} inputMode="numeric" placeholder="20" aria-label={`Line ${index + 1} rooms`} className="px-2" />
              </label>
              <label className="min-w-0">
                <span className="text-ink-500 mb-1 block text-[11px]">Per night</span>
                <Input value={line.rate} onChange={(e) => setLine(index, "rate", e.target.value)} inputMode="decimal" placeholder="315.00" aria-label={`Line ${index + 1} rate`} className="px-2" />
              </label>
              <label className="min-w-0">
                <span className="text-ink-500 mb-1 block text-[11px]">People/room</span>
                <Input value={line.occupancy} onChange={(e) => setLine(index, "occupancy", e.target.value)} inputMode="numeric" placeholder="2" aria-label={`Line ${index + 1} people per room`} className="px-2" />
              </label>
              <span className="flex gap-2 pb-2 text-xs">
                {lines.length > 1 && (
                  <button type="button" onClick={() => setLines((current) => current.filter((_, i) => i !== index))} className="text-[#c03654] hover:underline">
                    Remove
                  </button>
                )}
              </span>
            </div>
          ))}
        </div>
        <div className="mt-2 flex flex-wrap items-center justify-between gap-2 text-xs">
          <button type="button" onClick={() => setLines((current) => [...current, blankLine(current.at(-1))])} className="text-brand-700 font-medium hover:underline">
            + Add a line — another room category, or a pre or post period
          </button>
          <span className="text-ink-700">
            Comes to <strong className="font-semibold">{formatMoney(Math.round(total * 100), draft.currency)}</strong>
          </span>
        </div>
      </div>

      <div className="grid gap-3 sm:grid-cols-2">
        <Field label="Payment terms, as quoted">
          <Textarea rows={2} value={draft.paymentTerms} onChange={(e) => set("paymentTerms")(e.target.value)} placeholder="20% on signature, 20% on 1 Dec 2026…" />
        </Field>
        <Field label="Cancellation terms, as quoted">
          <Textarea rows={2} value={draft.cancellationTerms} onChange={(e) => set("cancellationTerms")(e.target.value)} placeholder="10% attrition until 10 May 2028…" />
        </Field>
        <Field label="Rates include">
          <Input value={draft.ratesInclude} onChange={(e) => set("ratesInclude")(e.target.value)} placeholder="Breakfast, Wi-Fi" />
        </Field>
        <Field label="The quotation — Google Drive link">
          <Input value={draft.documentUrl} onChange={(e) => set("documentUrl")(e.target.value)} placeholder="https://drive.google.com/file/d/…" />
        </Field>
        <Field label="Notes" className="sm:col-span-2">
          <Textarea rows={2} value={draft.notes} onChange={(e) => set("notes")(e.target.value)} />
        </Field>
      </div>

      <FormError message={problem ?? (save.error ? friendlyError(save.error) : null)} />
      <div className="flex gap-2">
        <Button type="submit" disabled={save.isPending}>
          {save.isPending ? "Saving…" : quotation ? "Save" : "Add quotation"}
        </Button>
        <Button type="button" variant="ghost" onClick={onDone}>
          Cancel
        </Button>
      </div>
    </form>
  );
}
