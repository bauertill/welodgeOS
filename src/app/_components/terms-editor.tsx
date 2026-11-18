"use client";

import type { CancellationKind } from "generated/prisma";
import { useId } from "react";

import { Input, Select } from "~/app/_components/form";

export type PaymentDraft = { onSignature: boolean; dueOn: string; percent: string; /** Also takes all of the taxes (doc §3.10). */ plusTaxes?: boolean };
/**
 * A cut-off's meaning: a cancellation fee from the date; what may go —
 * attrition, release — by it; a number of rooms that may be cancelled by it,
 * free or for a fee (2026-11-18: "Two (2) family rooms may be cancelled free
 * of charge up to and including 1 September 2027"); or a term in words, with
 * or without a date ("After that, no cancellations are allowed").
 */
export type CutKind = "FEE" | "ROOMS" | "ATTRITION" | "RELEASE" | "OTHER";
export type CancellationDraft = { kind: CutKind; cutoffOn: string; percent: string; remarks: string; rooms?: string; roomType?: string };
export const cutKindLabels: Record<CutKind, { label: string; percent: string }> = {
  FEE: { label: "Cancellation fee", percent: "% charged from this date" },
  ROOMS: { label: "Rooms may be cancelled", percent: "% fee — leave empty if free" },
  ATTRITION: { label: "Attrition", percent: "% may be reduced, free, until this date" },
  RELEASE: { label: "Release", percent: "% may be handed back until this date" },
  OTHER: { label: "In words", percent: "%" },
};

/** A saved term back into the editor's line. */
export function toCancellationDraft(cut: {
  kind: string;
  cutoffOn: Date | null;
  percentBasisPoints: number | null;
  feeBasisPoints: number | null;
  rooms: number | null;
  roomType: string | null;
  remarks: string | null;
}, dayKey: (date: Date) => string): CancellationDraft {
  const kind: CutKind =
    cut.rooms !== null ? "ROOMS" : cut.feeBasisPoints !== null ? "FEE" : cut.kind === "ATTRITION" || cut.kind === "RELEASE" ? cut.kind : "OTHER";
  return {
    kind,
    cutoffOn: cut.cutoffOn ? dayKey(cut.cutoffOn) : "",
    percent: toPercent(kind === "ROOMS" ? (cut.feeBasisPoints || null) : (cut.feeBasisPoints ?? cut.percentBasisPoints)),
    remarks: cut.remarks ?? "",
    rooms: cut.rooms?.toString() ?? "",
    roomType: cut.roomType ?? "",
  };
}
export const toPercent = (basisPoints: number | null) => (basisPoints === null ? "" : String(basisPoints / 100));
export const toBasisPoints = (text: string) => {
  const value = Number(text.trim().replace(",", ".").replace("%", ""));
  return text.trim() && Number.isFinite(value) && value >= 0 && value <= 100 ? Math.round(value * 100) : null;
};

/** The terms as saved, or what is wrong with them. A fee is saved as feeKind with its share as the fee. */
export function checkTerms(payments: PaymentDraft[], cancellations: CancellationDraft[], feeKind: CancellationKind) {
  const paymentsOut = [];
  for (const [i, payment] of payments.entries()) {
    if (!payment.percent.trim() && !payment.dueOn) continue;
    const share = toBasisPoints(payment.percent);
    if (share === null || share === 0) return `Payment ${i + 1}: give its percentage, like 20.`;
    if (!payment.onSignature && !payment.dueOn) return `Payment ${i + 1}: give the date it is due, or choose On signature.`;
    paymentsOut.push({ onSignature: payment.onSignature, dueOn: payment.onSignature ? "" : payment.dueOn, percentBasisPoints: share, plusTaxes: Boolean(payment.plusTaxes) });
  }
  const cancellationsOut = [];
  for (const [i, cut] of cancellations.entries()) {
    if (!cut.percent.trim() && !cut.cutoffOn && !cut.remarks.trim() && !cut.rooms?.trim()) continue;
    // Only a term in words may go without a date — "After that, no cancellations are allowed".
    if (!cut.cutoffOn && cut.kind !== "OTHER") return `Cancellation ${i + 1}: give the cut-off date.`;
    if (cut.kind === "OTHER" && !cut.remarks.trim()) return `Cancellation ${i + 1}: write the term in words.`;
    const share = cut.percent.trim() ? toBasisPoints(cut.percent) : null;
    if (cut.percent.trim() && share === null) return `Cancellation ${i + 1}: the percentage should be between 0 and 100.`;
    const rooms = cut.kind === "ROOMS" ? Number(cut.rooms?.trim()) : null;
    if (rooms !== null && (!Number.isInteger(rooms) || rooms < 1)) return `Cancellation ${i + 1}: say how many rooms may be cancelled, like 2.`;
    cancellationsOut.push({
      kind: cut.kind === "FEE" || cut.kind === "ROOMS" ? feeKind : cut.kind,
      cutoffOn: cut.cutoffOn,
      percentBasisPoints: cut.kind === "FEE" || cut.kind === "ROOMS" ? null : share,
      // A number of rooms cancelled free has no fee; one for a fee, its share.
      feeBasisPoints: cut.kind === "FEE" ? (share ?? 0) : cut.kind === "ROOMS" ? share || null : null,
      rooms,
      roomType: cut.kind === "ROOMS" ? (cut.roomType ?? "") : "",
      remarks: cut.remarks,
    });
  }
  return { payments: paymentsOut, cancellations: cancellationsOut };
}

/**
 * Payment and cancellation terms as lines (doc §3.10, §4.11): the shares due
 * on signature or on a date, and the cancellation cut-offs — the same editor
 * for a hotel's quotation and our offer to a client.
 */
export function TermsEditor({
  payments,
  setPayments,
  cancellations,
  setCancellations,
  taxes = false,
  roomTypes = [],
}: {
  payments: PaymentDraft[];
  setPayments: React.Dispatch<React.SetStateAction<PaymentDraft[]>>;
  cancellations: CancellationDraft[];
  setCancellations: React.Dispatch<React.SetStateAction<CancellationDraft[]>>;
  /** Offer "+ all taxes" on a payment — a hotel's quotation, where taxes come on top (doc §3.10). */
  taxes?: boolean;
  /** The room types on offer, suggested for a "Rooms may be cancelled" line. */
  roomTypes?: string[];
}) {
  const listId = useId();
  const setCut = (index: number, patch: Partial<CancellationDraft>) =>
    setCancellations((current) => current.map((one, i) => (i === index ? { ...one, ...patch } : one)));
  const paidShare = payments.reduce((sum, payment) => sum + (toBasisPoints(payment.percent) ?? 0), 0);
  return (
    <>
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
            {taxes && (
              <label className="text-ink-700 flex items-center gap-1.5 text-[13px] font-light" title="This payment also takes all of the taxes — like “30% + tax 100%”">
                <input
                  type="checkbox"
                  className="accent-brand-400 h-4 w-4"
                  checked={Boolean(payment.plusTaxes)}
                  onChange={(e) => setPayments((current) => current.map((one, i) => (i === index ? { ...one, plusTaxes: e.target.checked } : one)))}
                />
                + all taxes
              </label>
            )}
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
            <Select value={cut.kind} onChange={(e) => setCut(index, { kind: e.target.value as CutKind })} aria-label={`Cancellation ${index + 1} kind`} className="w-52">
              {(Object.keys(cutKindLabels) as CutKind[]).map((kind) => (
                <option key={kind} value={kind}>
                  {cutKindLabels[kind].label}
                </option>
              ))}
            </Select>
            {cut.kind === "ROOMS" && (
              <>
                <Input
                  value={cut.rooms ?? ""}
                  onChange={(e) => setCut(index, { rooms: e.target.value })}
                  inputMode="numeric"
                  placeholder="2"
                  aria-label={`Cancellation ${index + 1} rooms`}
                  className="w-14 px-2"
                />
                <Input
                  value={cut.roomType ?? ""}
                  onChange={(e) => setCut(index, { roomType: e.target.value })}
                  list={listId}
                  placeholder="family rooms — optional"
                  aria-label={`Cancellation ${index + 1} room type`}
                  className="w-48 px-2"
                />
                <span className="text-ink-500 text-[12px]">until</span>
              </>
            )}
            <Input
              type="date"
              value={cut.cutoffOn}
              onChange={(e) => setCut(index, { cutoffOn: e.target.value })}
              aria-label={`Cancellation ${index + 1} cut-off`}
              title={cut.kind === "OTHER" ? "A date, if the term has one" : undefined}
              className="w-40 px-2"
            />
            {cut.kind !== "OTHER" && (
              <span className="flex items-center gap-1">
                <Input
                  value={cut.percent}
                  onChange={(e) => setCut(index, { percent: e.target.value })}
                  inputMode="decimal"
                  placeholder={cut.kind === "ROOMS" ? "30" : "50"}
                  aria-label={`Cancellation ${index + 1} percentage`}
                  className="w-16 px-2"
                />
                <span className="text-ink-500 text-[12px] whitespace-nowrap">{cutKindLabels[cut.kind].percent}</span>
              </span>
            )}
            <Input
              value={cut.remarks}
              onChange={(e) => setCut(index, { remarks: e.target.value })}
              placeholder={cut.kind === "OTHER" ? "After that, no cancellations are allowed." : "Anything to add, in words — optional"}
              aria-label={`Cancellation ${index + 1} in words`}
              className="min-w-56 flex-1 px-2"
            />
            {cancellations.length > 1 && (
              <button type="button" onClick={() => setCancellations((current) => current.filter((_, i) => i !== index))} className="text-ink-400 text-lg leading-none hover:text-[#c03654]" aria-label={`Remove cancellation ${index + 1}`}>
                ×
              </button>
            )}
          </div>
        ))}
        <datalist id={listId}>
          {[...new Set(roomTypes)].map((name) => (
            <option key={name} value={name} />
          ))}
        </datalist>
      </div>
      <button type="button" onClick={() => setCancellations((current) => [...current, { kind: current.at(-1)?.kind ?? "FEE", cutoffOn: "", percent: "", remarks: "", rooms: "", roomType: current.at(-1)?.roomType ?? "" }])} className="text-brand-700 mt-1.5 text-xs font-medium hover:underline">
        + Add a cut-off
      </button>
    </div>
    </>
  );
}
