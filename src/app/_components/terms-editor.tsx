"use client";

import type { CancellationKind } from "generated/prisma";

import { Input, Select } from "~/app/_components/form";

export type PaymentDraft = { onSignature: boolean; dueOn: string; percent: string };
/** A cut-off's meaning: a cancellation fee from the date, or what may go — attrition, release — by it. */
export type CutKind = "FEE" | "ATTRITION" | "RELEASE" | "OTHER";
export type CancellationDraft = { kind: CutKind; cutoffOn: string; percent: string; remarks: string };
export const cutKindLabels: Record<CutKind, { label: string; percent: string }> = {
  FEE: { label: "Cancellation fee", percent: "% charged from this date" },
  ATTRITION: { label: "Attrition", percent: "% may be reduced, free, until this date" },
  RELEASE: { label: "Release", percent: "% may be handed back until this date" },
  OTHER: { label: "Other", percent: "%" },
};
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
    paymentsOut.push({ onSignature: payment.onSignature, dueOn: payment.onSignature ? "" : payment.dueOn, percentBasisPoints: share });
  }
  const cancellationsOut = [];
  for (const [i, cut] of cancellations.entries()) {
    if (!cut.percent.trim() && !cut.cutoffOn && !cut.remarks.trim()) continue;
    if (!cut.cutoffOn) return `Cancellation ${i + 1}: give the cut-off date.`;
    const share = cut.percent.trim() ? toBasisPoints(cut.percent) : null;
    if (cut.percent.trim() && share === null) return `Cancellation ${i + 1}: the percentage should be between 0 and 100.`;
    cancellationsOut.push({
      kind: cut.kind === "FEE" ? feeKind : cut.kind,
      cutoffOn: cut.cutoffOn,
      percentBasisPoints: cut.kind === "FEE" ? null : share,
      feeBasisPoints: cut.kind === "FEE" ? (share ?? 0) : null,
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
}: {
  payments: PaymentDraft[];
  setPayments: React.Dispatch<React.SetStateAction<PaymentDraft[]>>;
  cancellations: CancellationDraft[];
  setCancellations: React.Dispatch<React.SetStateAction<CancellationDraft[]>>;
}) {
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
    </>
  );
}
