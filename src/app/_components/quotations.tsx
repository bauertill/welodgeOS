"use client";

import type { Cleaning, QuotationStatus, RateInclusion } from "generated/prisma";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { useState } from "react";

import { Combobox } from "~/app/_components/combobox";
import { Button, Field, FormError, friendlyError, Input, Label, Select, Textarea } from "~/app/_components/form";
import { Popup } from "~/app/_components/popup";
import { RateIncludesPicker } from "~/app/_components/room-categories";
import { dayKey } from "~/lib/dates";
import { formatDate, formatMoney, formatRange } from "~/lib/format";
import { contractHref, percent } from "~/lib/finance";
import { describeRateIncludes } from "~/lib/scouting";
import { api, type RouterOutputs } from "~/trpc/react";

/**
 * The Quotations tab of a property's page (doc §3.10): its quotations for
 * each event it is on, the event it was opened from first. Each is one tinted
 * line until opened, so many of them still fit on a screen.
 */
export function PropertyQuotations({
  entries,
  categories,
}: {
  entries: { id: string; event: { id: string; name: string; startDate: Date; endDate: Date } }[];
  categories: Category[];
}) {
  return (
    <div>
      {entries.length === 0 ? (
        <p className="text-ink-500 text-sm font-light">Put the property on an event&apos;s list to record what it quotes for that event.</p>
      ) : (
        <div className="space-y-6">
          {entries.map((entry) => (
            <QuotationsSection
              key={entry.id}
              scoutingEntryId={entry.id}
              eventId={entry.event.id}
              eventName={entries.length > 1 ? entry.event.name : null}
              categories={categories}
              stay={{ checkIn: dayKey(entry.event.startDate), checkOut: dayKey(entry.event.endDate) }}
            />
          ))}
        </div>
      )}
    </div>
  );
}

/**
 * A hotel's quotations for one event (doc §3.10): each one a scenario — a group,
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
  eventName,
  categories,
  stay,
}: {
  scoutingEntryId: string;
  eventId: string;
  /** Named only when the property is on more than one event. */
  eventName: string | null;
  categories: Category[];
  /** The event's own dates, as a starting point for a new line. */
  stay: { checkIn: string; checkOut: string };
}) {
  const quotations = api.quotation.forEntry.useQuery({ scoutingEntryId });
  const [editing, setEditing] = useState<string | "new" | null>(null);
  const rows = quotations.data ?? [];
  return (
    <div>
      <div className="mb-3 flex items-baseline justify-between gap-3">
        <h3 className="text-ink-700 text-[13px] font-medium">
          {eventName && `For ${eventName}`}
          {eventName && rows.length > 0 && <span className="text-ink-500 ml-1.5 text-xs font-light">{rows.length}</span>}
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
        <div className="space-y-2">
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
              <QuotationCard
                key={quotation.id}
                quotation={quotation}
                eventId={eventId}
                startOpen={rows.length === 1}
                onEdit={() => setEditing(quotation.id)}
              />
            ),
          )}
        </div>
      )}
    </div>
  );
}

function QuotationCard({
  quotation,
  eventId,
  startOpen,
  onEdit,
}: {
  quotation: Quotation;
  eventId: string;
  /** A lone quotation shows in full; several start as one line each. */
  startOpen: boolean;
  onEdit: () => void;
}) {
  const [open, setOpen] = useState(startOpen);
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
    [
      "Payments",
      quotation.payments.map((payment) => `${percent(payment.percentBasisPoints)} ${payment.onSignature ? "on signature" : `on ${formatDate(payment.dueOn!)}`}`).join(" · ") || null,
    ],
    ["Payment terms", quotation.paymentTerms],
    [
      "Cancellation",
      quotation.cancellations
        .map((cut) =>
          cut.feeBasisPoints !== null
            ? `${percent(cut.feeBasisPoints)} charged from ${formatDate(cut.cutoffOn)}`
            : `${cut.kind === "ATTRITION" ? "attrition" : cut.kind === "RELEASE" ? "release" : "other"}${cut.percentBasisPoints !== null ? ` ${percent(cut.percentBasisPoints)}` : ""} until ${formatDate(cut.cutoffOn)}`,
        )
        .join(" · ") || null,
    ],
    ["Cancellation terms", quotation.cancellationTerms],
    ["Rates include", describeRateIncludes(quotation.rateIncludes, quotation.rateIncludesOther, quotation.cleaning, quotation.cleaningOther)],
    ["TOT", percent(quotation.totBasisPoints)],
    ["Other taxes", quotation.otherTaxes],
  ].filter(([, value]) => value) as [string, string][];

  return (
    <div className={`border-brand-200 bg-brand-50/60 rounded-lg border ${quotation.status === "DECLINED" ? "opacity-60" : ""}`}>
      <button
        type="button"
        onClick={() => setOpen(!open)}
        aria-expanded={open}
        className="hover:bg-brand-50 flex w-full items-start justify-between gap-3 rounded-lg p-3 text-left"
      >
        <div className="flex min-w-0 flex-1 items-start gap-2">
          <svg
            viewBox="0 0 16 16"
            fill="none"
            className={`text-brand-700 mt-1 h-3.5 w-3.5 shrink-0 transition-transform ${open ? "rotate-90" : ""}`}
            aria-hidden
          >
            <path d="M6 4l4 4-4 4" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round" />
          </svg>
          <div className="min-w-0">
          <p className="text-ink-900 text-[14px] font-medium">
            {quotation.name}
            <span className={`ml-2 rounded-full px-2 py-0.5 align-middle text-[11px] font-medium ${statusStyles[quotation.status]}`}>
              {quotationStatusLabels[quotation.status]}
            </span>
            {quotation.salesRequest && <span className="text-brand-700 ml-2 text-xs font-medium">For {quotation.salesRequest.client.name}</span>}
          </p>
          <p className="text-ink-500 mt-0.5 text-xs font-light">
            {[
              quotation.from && quotation.to ? formatRange(quotation.from, quotation.to) : null,
              `${quotation.roomNights} room-nights`,
              quotation.rooms ? `${quotation.rooms} rooms` : null,
              quotation.receivedOn ? `received ${formatDate(quotation.receivedOn)}` : null,
              quotation.validUntil ? `valid until ${formatDate(quotation.validUntil)}` : null,
            ]
              .filter(Boolean)
              .join(" · ")}
          </p>
          </div>
        </div>
        <p className="text-ink-900 shrink-0 text-[15px] font-semibold whitespace-nowrap">{formatMoney(quotation.totalCents, quotation.currency)}</p>
      </button>

      {open && (
      <div className="px-3 pb-3">
      <div className="border-ink-200/60 overflow-x-auto rounded-lg border bg-white">
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
      )}
    </div>
  );
}

type LineDraft = { categoryId: string; checkIn: string; checkOut: string; rooms: string; rate: string; occupancy: string };
type PaymentDraft = { onSignature: boolean; dueOn: string; percent: string };
/** A cut-off's meaning: a cancellation fee from the date, or what may go — attrition, release — by it. */
type CutKind = "FEE" | "ATTRITION" | "RELEASE" | "OTHER";
type CancellationDraft = { kind: CutKind; cutoffOn: string; percent: string; remarks: string };
const cutKindLabels: Record<CutKind, { label: string; percent: string }> = {
  FEE: { label: "Cancellation fee", percent: "% charged from this date" },
  ATTRITION: { label: "Attrition", percent: "% may be reduced, free, until this date" },
  RELEASE: { label: "Release", percent: "% may be handed back until this date" },
  OTHER: { label: "Other", percent: "%" },
};
const toPercent = (basisPoints: number | null) => (basisPoints === null ? "" : String(basisPoints / 100));
const toBasisPoints = (text: string) => {
  const value = Number(text.trim().replace(",", ".").replace("%", ""));
  return text.trim() && Number.isFinite(value) && value >= 0 && value <= 100 ? Math.round(value * 100) : null;
};

function QuotationEditor({
  scoutingEntryId,
  categories,
  stay,
  quotation,
  forRequestId,
  onDone,
}: {
  scoutingEntryId: string;
  categories: Category[];
  stay: { checkIn: string; checkOut: string };
  quotation?: Quotation;
  /** A new quotation's sales request, when it is made from that request's task. */
  forRequestId?: string | null;
  onDone: () => void;
}) {
  const utils = api.useUtils();
  const [draft, setDraft] = useState({
    name: quotation?.name ?? "",
    receivedOn: quotation?.receivedOn ? dayKey(quotation.receivedOn) : "",
    validUntil: quotation?.validUntil ? dayKey(quotation.validUntil) : "",
    rooms: quotation?.rooms?.toString() ?? "",
    currency: quotation?.currency ?? "USD",
    paymentTerms: quotation?.paymentTerms ?? "",
    cancellationTerms: quotation?.cancellationTerms ?? "",
    rateIncludesOther: quotation?.rateIncludesOther ?? "",
    cleaningOther: quotation?.cleaningOther ?? "",
    tot: quotation?.totBasisPoints != null ? (quotation.totBasisPoints / 100).toFixed(2) : "",
    otherTaxes: quotation?.otherTaxes ?? "",
    documentUrl: quotation?.documentUrl ?? "",
    notes: quotation?.notes ?? "",
  });
  // Which client's request it was quoted for (doc §4.11) — for a new one, the request its open contact task is about.
  const requests = api.quotation.requestsFor.useQuery({ scoutingEntryId });
  // The hotel's room categories, as they are now — one can be added right here, from a line (doc §3.10).
  const context = api.quotation.formContext.useQuery({ scoutingEntryId });
  const cats = context.data?.property.categories ?? categories;
  const [addingFor, setAddingFor] = useState<number | null>(categories.length === 0 ? 0 : null);
  const [salesRequestId, setSalesRequestId] = useState<string | null>(quotation ? quotation.salesRequestId : (forRequestId ?? null));
  const [requestTouched, setRequestTouched] = useState(Boolean(quotation) || Boolean(forRequestId));
  const forRequest = requestTouched ? salesRequestId : (requests.data?.likely ?? null);
  // What the rates include, the same choice as on a room category (§3.9).
  const [includes, setIncludes] = useState<RateInclusion[]>(quotation?.rateIncludes ?? []);
  const [cleaningIncluded, setCleaningIncluded] = useState(quotation?.cleaning != null);
  const [cleaning, setCleaning] = useState<Cleaning | "">(quotation?.cleaning ?? "");
  const blankLine = (from?: LineDraft): LineDraft => ({
    categoryId: from?.categoryId ?? cats[0]?.id ?? "",
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
  // Payments and cancellation cut-offs, line by line (doc §3.10) — one to start, more when quoted.
  const [payments, setPayments] = useState<PaymentDraft[]>(
    quotation?.payments.length
      ? quotation.payments.map((payment) => ({ onSignature: payment.onSignature, dueOn: payment.dueOn ? dayKey(payment.dueOn) : "", percent: toPercent(payment.percentBasisPoints) }))
      : [{ onSignature: true, dueOn: "", percent: "" }],
  );
  const [cancellations, setCancellations] = useState<CancellationDraft[]>(
    quotation?.cancellations.length
      ? quotation.cancellations.map((cut) => ({
          kind: cut.feeBasisPoints !== null ? "FEE" : cut.kind === "ATTRITION" || cut.kind === "RELEASE" ? cut.kind : "OTHER",
          cutoffOn: dayKey(cut.cutoffOn),
          percent: toPercent(cut.feeBasisPoints ?? cut.percentBasisPoints),
          remarks: cut.remarks ?? "",
        }))
      : [{ kind: "FEE", cutoffOn: "", percent: "", remarks: "" }],
  );
  const paidShare = payments.reduce((sum, payment) => sum + (toBasisPoints(payment.percent) ?? 0), 0);
  const set = (key: keyof typeof draft) => (value: string) => setDraft((current) => ({ ...current, [key]: value }));
  const setLine = (index: number, key: keyof LineDraft, value: string) =>
    setLines((current) => current.map((line, i) => (i === index ? { ...line, [key]: value } : line)));
  const save = api.quotation.save.useMutation({
    onSuccess: () => {
      void utils.quotation.invalidate();
      void utils.scouting.listForEvent.invalidate();
      void utils.sales.sourcing.invalidate();
      // Its contact task may have moved to In progress (doc §4.11).
      void utils.task.invalidate();
      void utils.audit.invalidate();
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
      className="border-brand-300 space-y-4 rounded-lg border bg-white p-4"
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
        const rooms = draft.rooms.trim() ? Number(draft.rooms) : null;
        if (rooms !== null && (!Number.isInteger(rooms) || rooms < 0)) return setProblem("Rooms should be a whole number, like 40.");
        if (cleaningIncluded && !cleaning) return setProblem("Say how often the rooms are cleaned, or untick cleaning.");
        const tot = draft.tot.trim() ? Number(draft.tot.replace(",", ".").replace("%", "")) : null;
        if (tot !== null && (!Number.isFinite(tot) || tot < 0 || tot > 100)) return setProblem("TOT should be a percentage, like 15.");
        const paymentsOut = [];
        for (const [i, payment] of payments.entries()) {
          if (!payment.percent.trim() && !payment.dueOn) continue;
          const share = toBasisPoints(payment.percent);
          if (share === null || share === 0) return setProblem(`Payment ${i + 1}: give its percentage, like 20.`);
          if (!payment.onSignature && !payment.dueOn) return setProblem(`Payment ${i + 1}: give the date it is due, or choose On signature.`);
          paymentsOut.push({ onSignature: payment.onSignature, dueOn: payment.onSignature ? "" : payment.dueOn, percentBasisPoints: share });
        }
        const cancellationsOut = [];
        for (const [i, cut] of cancellations.entries()) {
          if (!cut.percent.trim() && !cut.cutoffOn && !cut.remarks.trim()) continue;
          if (!cut.cutoffOn) return setProblem(`Cancellation ${i + 1}: give the cut-off date.`);
          const share = cut.percent.trim() ? toBasisPoints(cut.percent) : null;
          if (cut.percent.trim() && share === null) return setProblem(`Cancellation ${i + 1}: the percentage should be between 0 and 100.`);
          cancellationsOut.push({
            kind: cut.kind === "FEE" ? ("OTHER" as const) : cut.kind,
            cutoffOn: cut.cutoffOn,
            percentBasisPoints: cut.kind === "FEE" ? null : share,
            feeBasisPoints: cut.kind === "FEE" ? (share ?? 0) : null,
            remarks: cut.remarks,
          });
        }
        const { tot: _tot, ...fields } = draft;
        save.mutate({
          scoutingEntryId,
          id: quotation?.id,
          quotation: {
            ...fields,
            rooms,
            rateIncludes: includes,
            cleaning: cleaningIncluded && cleaning ? cleaning : null,
            totBasisPoints: tot === null ? null : Math.round(tot * 100),
            salesRequestId: forRequest,
            lines: parsed,
            payments: paymentsOut,
            cancellations: cancellationsOut,
          },
        });
      }}
    >
      <Field label="For which sales request — search by client, or leave it general">
        <Combobox
          value={forRequest ?? ""}
          onChange={(value) => {
            setRequestTouched(true);
            setSalesRequestId(value || null);
          }}
          placeholder="None — a general quote for the event"
          options={[
            ...(requests.data?.requests ?? []).map((request) => ({ id: request.id, label: request.name, detail: request.description?.slice(0, 60) ?? null })),
            ...(quotation?.salesRequest && !requests.data?.requests.some((request) => request.id === quotation.salesRequest!.id)
              ? [{ id: quotation.salesRequest.id, label: quotation.salesRequest.client.name }]
              : []),
          ]}
        />
      </Field>
      <div className="grid gap-3 sm:grid-cols-[minmax(0,1fr)_9.5rem_9.5rem_5.5rem]">
        <Field label="Name — the group or scenario">
          <Input value={draft.name} onChange={(e) => set("name")(e.target.value)} placeholder="Austria House staff" autoFocus />
        </Field>
        <Field label="Received on">
          <Input type="date" value={draft.receivedOn} onChange={(e) => set("receivedOn")(e.target.value)} />
        </Field>
        <Field label="Valid until">
          <Input type="date" value={draft.validUntil} onChange={(e) => set("validUntil")(e.target.value)} />
        </Field>
        <Field label="Rooms">
          <Input value={draft.rooms} onChange={(e) => set("rooms")(e.target.value)} inputMode="numeric" placeholder="40" />
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
            <div key={index} className="grid grid-cols-2 gap-2 sm:grid-cols-[minmax(0,1fr)_8.75rem_8.75rem_4.5rem_5.5rem_4.5rem_auto] sm:items-end">
              <label className="col-span-2 min-w-0 sm:col-span-1">
                <span className="text-ink-500 mb-1 block text-[11px]">Room category</span>
                <Select
                  value={line.categoryId}
                  onChange={(e) => (e.target.value === NEW_CATEGORY ? setAddingFor(index) : setLine(index, "categoryId", e.target.value))}
                  aria-label={`Line ${index + 1} category`}
                >
                  {!line.categoryId && <option value="">Add a room category →</option>}
                  {cats.map((category) => (
                    <option key={category.id} value={category.id}>
                      {category.name}
                    </option>
                  ))}
                  <option value={NEW_CATEGORY}>+ New room category…</option>
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
        {addingFor !== null && context.data && (
          <NewCategory
            propertyId={context.data.property.id}
            propertyName={context.data.property.name}
            first={cats.length === 0}
            onCancel={cats.length ? () => setAddingFor(null) : undefined}
            onAdded={(id) => {
              const index = addingFor;
              setAddingFor(null);
              void context.refetch();
              setLines((current) => current.map((line, i) => (i === index || !line.categoryId ? { ...line, categoryId: id } : line)));
            }}
          />
        )}
        <div className="mt-2 flex flex-wrap items-center justify-between gap-2 text-xs">
          <button type="button" onClick={() => setLines((current) => [...current, blankLine(current.at(-1))])} className="text-brand-700 font-medium hover:underline">
            + Add a line — another room category, or a pre or post period
          </button>
          <span className="text-ink-700">
            Comes to <strong className="font-semibold">{formatMoney(Math.round(total * 100), draft.currency)}</strong>
          </span>
        </div>
      </div>

      <div className="space-y-4">
        <div>
          <div className="mb-1.5 flex items-baseline gap-3">
            <span className="text-ink-700 text-[13px] font-medium">Payments</span>
            <span className={`text-xs ${paidShare === 10_000 ? "text-[#0a7a47]" : "text-ink-500"}`}>Adds up to {Number((paidShare / 100).toFixed(2))}%</span>
          </div>
          <div className="space-y-2">
            {payments.map((payment, index) => (
              <div key={index} className="flex flex-wrap items-center gap-2">
                <Select
                  value={payment.onSignature ? "SIGNATURE" : "DATE"}
                  onChange={(e) => setPayments((current) => current.map((one, i) => (i === index ? { ...one, onSignature: e.target.value === "SIGNATURE" } : one)))}
                  aria-label={`Payment ${index + 1} due`}
                  className="w-36"
                >
                  <option value="SIGNATURE">On signature</option>
                  <option value="DATE">On a date</option>
                </Select>
                {!payment.onSignature && (
                  <Input
                    type="date"
                    value={payment.dueOn}
                    onChange={(e) => setPayments((current) => current.map((one, i) => (i === index ? { ...one, dueOn: e.target.value } : one)))}
                    aria-label={`Payment ${index + 1} date`}
                    className="w-40 px-2"
                  />
                )}
                <span className="flex items-center gap-1">
                  <Input
                    value={payment.percent}
                    onChange={(e) => setPayments((current) => current.map((one, i) => (i === index ? { ...one, percent: e.target.value } : one)))}
                    inputMode="decimal"
                    placeholder="20"
                    aria-label={`Payment ${index + 1} percentage`}
                    className="w-16 px-2"
                  />
                  <span className="text-ink-500 text-[13px]">%</span>
                </span>
                {payments.length > 1 && (
                  <button type="button" onClick={() => setPayments((current) => current.filter((_, i) => i !== index))} className="text-ink-400 text-lg leading-none hover:text-[#c03654]" aria-label={`Remove payment ${index + 1}`}>
                    ×
                  </button>
                )}
              </div>
            ))}
          </div>
          <button type="button" onClick={() => setPayments((current) => [...current, { onSignature: false, dueOn: "", percent: "" }])} className="text-brand-700 mt-1.5 text-xs font-medium hover:underline">
            + Add a payment
          </button>
        </div>
        <div>
          <span className="text-ink-700 mb-1.5 block text-[13px] font-medium">Cancellation cut-offs</span>
          <div className="space-y-2">
            {cancellations.map((cut, index) => (
              <div key={index} className="flex flex-wrap items-center gap-2">
                <Select
                  value={cut.kind}
                  onChange={(e) => setCancellations((current) => current.map((one, i) => (i === index ? { ...one, kind: e.target.value as CutKind } : one)))}
                  aria-label={`Cancellation ${index + 1} kind`}
                  className="w-44"
                >
                  {(Object.keys(cutKindLabels) as CutKind[]).map((kind) => (
                    <option key={kind} value={kind}>
                      {cutKindLabels[kind].label}
                    </option>
                  ))}
                </Select>
                <Input
                  type="date"
                  value={cut.cutoffOn}
                  onChange={(e) => setCancellations((current) => current.map((one, i) => (i === index ? { ...one, cutoffOn: e.target.value } : one)))}
                  aria-label={`Cancellation ${index + 1} cut-off`}
                  className="w-40 px-2"
                />
                <span className="flex items-center gap-1">
                  <Input
                    value={cut.percent}
                    onChange={(e) => setCancellations((current) => current.map((one, i) => (i === index ? { ...one, percent: e.target.value } : one)))}
                    inputMode="decimal"
                    placeholder="50"
                    aria-label={`Cancellation ${index + 1} percentage`}
                    className="w-16 px-2"
                  />
                  <span className="text-ink-500 text-[12px] whitespace-nowrap">{cutKindLabels[cut.kind].percent}</span>
                </span>
                {cancellations.length > 1 && (
                  <button type="button" onClick={() => setCancellations((current) => current.filter((_, i) => i !== index))} className="text-ink-400 text-lg leading-none hover:text-[#c03654]" aria-label={`Remove cancellation ${index + 1}`}>
                    ×
                  </button>
                )}
              </div>
            ))}
          </div>
          <button type="button" onClick={() => setCancellations((current) => [...current, { kind: current.at(-1)?.kind ?? "FEE", cutoffOn: "", percent: "", remarks: "" }])} className="text-brand-700 mt-1.5 text-xs font-medium hover:underline">
            + Add a cut-off
          </button>
        </div>
      </div>

      <div className="grid gap-3 sm:grid-cols-2">
        <Field label="Other payment terms, in words — optional">
          <Textarea rows={2} value={draft.paymentTerms} onChange={(e) => set("paymentTerms")(e.target.value)} placeholder="Deposit by bank transfer only…" />
        </Field>
        <Field label="Other cancellation terms, in words — optional">
          <Textarea rows={2} value={draft.cancellationTerms} onChange={(e) => set("cancellationTerms")(e.target.value)} placeholder="Name changes free until 14 days before arrival…" />
        </Field>
        {/* Not a Field: a label around the list would tick the first item
            on any click inside it. */}
        <div>
          <Label>Rates include</Label>
          <RateIncludesPicker
            value={includes}
            onChange={setIncludes}
            other={draft.rateIncludesOther}
            onOtherChange={set("rateIncludesOther")}
            cleaningIncluded={cleaningIncluded}
            onCleaningIncludedChange={setCleaningIncluded}
            cleaning={cleaning}
            onCleaningChange={setCleaning}
            cleaningOther={draft.cleaningOther}
            onCleaningOtherChange={set("cleaningOther")}
          />
        </div>
        <Field label="TOT (Transient Occupancy Tax), %">
          <Input value={draft.tot} onChange={(e) => set("tot")(e.target.value)} placeholder="15.00" inputMode="decimal" aria-label="TOT %" />
        </Field>
        <Field label="Other applicable tax">
          <Input value={draft.otherTaxes} onChange={(e) => set("otherTaxes")(e.target.value)} placeholder="TMD: 6.25 USD (ADR 200–300)" aria-label="Other applicable tax" />
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

/**
 * Register a hotel's quotation from elsewhere — its contact task (doc §4.11) —
 * in a popup, so the task stays where it is. It is saved on the property's
 * Quotations tab for the event, like one added there.
 */
export function QuotationPopup({ scoutingEntryId, forRequestId, onClose }: { scoutingEntryId: string; forRequestId: string | null; onClose: () => void }) {
  const context = api.quotation.formContext.useQuery({ scoutingEntryId });
  const c = context.data;
  return (
    <Popup title={c ? `Their quote — ${c.property.name}` : "Their quote"} subtitle={c ? `For ${c.event.name}. Saved on the property's Quotations tab.` : undefined} size="large" onClose={onClose}>
      {!c ? (
        <p className="text-ink-500 text-sm font-light">Loading…</p>
      ) : (
        <QuotationEditor
          scoutingEntryId={scoutingEntryId}
          categories={c.property.categories}
          stay={{ checkIn: dayKey(c.event.startDate), checkOut: dayKey(c.event.endDate) }}
          forRequestId={forRequestId}
          onDone={onClose}
        />
      )}
    </Popup>
  );
}

const NEW_CATEGORY = "__new__";

/**
 * A room category added from the quotation form (doc §3.10): a hotel's quote
 * often comes before its room categories are on the property. Name, how many
 * rooms, how many they sleep — the rest on the property's page later.
 */
function NewCategory({
  propertyId,
  propertyName,
  first,
  onAdded,
  onCancel,
}: {
  propertyId: string;
  propertyName: string;
  first: boolean;
  onAdded: (id: string) => void;
  onCancel?: () => void;
}) {
  const [name, setName] = useState("");
  const [rooms, setRooms] = useState("");
  const [sleeps, setSleeps] = useState("2");
  const save = api.property.saveCategory.useMutation({ onSuccess: (category) => onAdded(category.id) });
  const add = () => {
    if (!name.trim()) return;
    save.mutate({ propertyId, category: { name: name.trim(), unitCount: Math.max(0, Math.round(Number(rooms) || 0)), capacity: Math.max(1, Math.round(Number(sleeps) || 2)) } });
  };
  return (
    <div className="bg-brand-50/60 border-brand-200 mt-2 rounded-lg border p-3">
      <p className="text-ink-900 text-[13px] font-medium">{first ? `${propertyName} has no room categories yet — add the one quoted` : "New room category"}</p>
      <p className="text-ink-500 mb-2 text-xs font-light">Saved on the property, where its beds, size and the rest can be filled in later.</p>
      <div className="grid gap-2 sm:grid-cols-[minmax(0,1fr)_6rem_6rem_auto] sm:items-end">
        <Field label="Name">
          <Input value={name} onChange={(e) => setName(e.target.value)} placeholder="Standard King" autoFocus onKeyDown={(e) => e.key === "Enter" && (e.preventDefault(), add())} />
        </Field>
        <Field label="Rooms it has">
          <Input value={rooms} onChange={(e) => setRooms(e.target.value)} inputMode="numeric" placeholder="40" />
        </Field>
        <Field label="Sleeps">
          <Input value={sleeps} onChange={(e) => setSleeps(e.target.value)} inputMode="numeric" />
        </Field>
        <span className="flex items-center gap-3 pb-1">
          <Button type="button" disabled={save.isPending || !name.trim()} onClick={add}>
            {save.isPending ? "Adding…" : "Add"}
          </Button>
          {onCancel && (
            <button type="button" onClick={onCancel} className="text-ink-500 text-xs hover:underline">
              Cancel
            </button>
          )}
        </span>
      </div>
      {save.error && <p className="mt-1 text-xs text-[#c03654]">{friendlyError(save.error)}</p>}
    </div>
  );
}

/**
 * The quotations hotels sent for a client's request (doc §4.11) — a card on
 * its sourcing task and on its page: which hotel, for what, at what rate,
 * each opening on the hotel's Quotations tab.
 */
export function QuotesReceived({ salesRequestId }: { salesRequestId: string }) {
  const quotes = api.quotation.forRequest.useQuery({ salesRequestId });
  const list = quotes.data ?? [];
  const [open, setOpen] = useState<string | null>(null);
  const opened = list.find((quote) => quote.id === open) ?? null;
  return (
    <div className="border-ink-200/60 rounded-xl border bg-white p-5">
      <h2 className="text-ink-900 mb-3 text-[15px] font-medium">Quotes received{list.length ? ` (${list.length})` : ""}</h2>
      {list.length === 0 ? (
        <p className="text-ink-500 text-[13px] font-light">{quotes.isLoading ? "…" : "None yet. A hotel's quote registered for this request shows here."}</p>
      ) : (
        <ul className="space-y-2">
          {list.map((quote) => (
            <li key={quote.id}>
              <button
                type="button"
                onClick={() => setOpen(quote.id)}
                className={`border-brand-200 bg-brand-50/50 hover:border-brand-400 block w-full rounded-lg border px-3 py-2.5 text-left text-[13px] transition-colors ${quote.status === "DECLINED" ? "opacity-60" : ""}`}
              >
                <span className="flex items-baseline justify-between gap-2">
                  <span className="text-ink-900 min-w-0 truncate font-medium">{quote.property.name}</span>
                  <span className={`shrink-0 rounded-full px-2 py-0.5 text-[10px] font-medium ${statusStyles[quote.status]}`}>{quotationStatusLabels[quote.status]}</span>
                </span>
                <span className="text-ink-500 block truncate text-xs font-light">{quote.name}</span>
                <span className="text-ink-700 mt-1 block text-xs">
                  {[
                    quote.from && quote.to ? formatRange(quote.from, quote.to) : null,
                    quote.rooms ? `${quote.rooms} rooms` : `${quote.roomNights} room-nights`,
                    quote.lowestRateCents !== null ? `from ${formatMoney(quote.lowestRateCents, quote.currency)} a night` : null,
                  ]
                    .filter(Boolean)
                    .join(" · ")}
                </span>
                <span className="text-ink-900 mt-0.5 block text-[13px] font-semibold">{formatMoney(quote.totalCents, quote.currency)}</span>
              </button>
            </li>
          ))}
        </ul>
      )}
      {opened && <QuotePopup quote={opened} onClose={() => setOpen(null)} />}
    </div>
  );
}

/** One quotation in full, over the page (doc §4.11): its lines and terms, changed or accepted right there. */
function QuotePopup({ quote, onClose }: { quote: RouterOutputs["quotation"]["forRequest"][number]; onClose: () => void }) {
  const [editing, setEditing] = useState(false);
  const context = api.quotation.formContext.useQuery({ scoutingEntryId: quote.scoutingEntryId });
  const c = context.data;
  return (
    <Popup
      title={`${quote.property.name} — ${quote.name}`}
      subtitle={
        <Link href={`/properties/${quote.property.id}?back=${encodeURIComponent(`/events/${quote.eventId}`)}#quotations`} className="text-brand-700 hover:underline">
          Open the hotel&apos;s page →
        </Link>
      }
      size="large"
      onClose={onClose}
    >
      {editing ? (
        c ? (
          <QuotationEditor
            scoutingEntryId={quote.scoutingEntryId}
            categories={c.property.categories}
            stay={{ checkIn: dayKey(c.event.startDate), checkOut: dayKey(c.event.endDate) }}
            quotation={quote}
            onDone={() => setEditing(false)}
          />
        ) : (
          <p className="text-ink-500 text-sm font-light">Loading…</p>
        )
      ) : (
        <QuotationCard quotation={quote} eventId={quote.eventId} startOpen onEdit={() => setEditing(true)} />
      )}
    </Popup>
  );
}
