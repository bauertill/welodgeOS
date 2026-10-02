import type { CancellationKind, ContractParty, PaymentStatus } from "generated/prisma";

/**
 * The words for contracts, payments and cancellation deadlines (doc §7.1),
 * said once so every screen agrees.
 */

export const partyLabels: Record<ContractParty, string> = {
  SUPPLIER: "Supplier",
  CLIENT: "Client",
};

export const paymentStatusLabels: Record<PaymentStatus, string> = {
  TO_BE_PAID: "To be paid",
  INVOICE_REQUESTED: "Invoice requested",
  INVOICE_RECEIVED: "Invoice received",
  INVOICE_ISSUED: "Invoice issued",
  PAID: "Paid",
  REFUND: "Refund",
};

/**
 * The statuses a payment moves through, per side: a supplier invoices us, and
 * we ask for that invoice; we invoice a client.
 */
export const paymentStatusOrder: Record<ContractParty, PaymentStatus[]> = {
  SUPPLIER: ["TO_BE_PAID", "INVOICE_REQUESTED", "INVOICE_RECEIVED", "PAID", "REFUND"],
  CLIENT: ["TO_BE_PAID", "INVOICE_ISSUED", "PAID", "REFUND"],
};

/** Settled: nothing left to chase. */
export const isSettled = (status: PaymentStatus) => status === "PAID" || status === "REFUND";

export const paymentStatusStyles: Record<PaymentStatus, string> = {
  TO_BE_PAID: "bg-[#e6f0fb] text-[#1d5fa8]",
  INVOICE_REQUESTED: "bg-brand-50 text-brand-800",
  INVOICE_RECEIVED: "bg-[#fde8ec] text-[#a3243d]",
  INVOICE_ISSUED: "bg-brand-50 text-brand-800",
  PAID: "bg-[#e3f8ee] text-[#0a7a47]",
  REFUND: "bg-ink-50 text-ink-700",
};

export const cancellationKindLabels: Record<CancellationKind, string> = {
  ATTRITION: "Attrition",
  RELEASE: "Release",
  CLIENT_CANCELLATION: "Client cancellation",
  OTHER: "Other",
};

export const cancellationKindHints: Record<CancellationKind, string> = {
  ATTRITION: "We may reduce the rooms or nights by an agreed share, without paying for them.",
  RELEASE: "We may hand rooms back, or an exclusivity lapses.",
  CLIENT_CANCELLATION: "The client may cancel, free or for a fee.",
  OTHER: "Anything else the contract lets go by a date.",
};

/** The kinds that belong on each side of a contract. */
export const cancellationKindOrder: Record<ContractParty, CancellationKind[]> = {
  SUPPLIER: ["ATTRITION", "RELEASE", "OTHER"],
  CLIENT: ["CLIENT_CANCELLATION", "OTHER"],
};

/** "20%" from 2000 — shares are kept in hundredths of a percent. */
export const percent = (basisPoints: number | null) =>
  basisPoints === null ? null : `${Number((basisPoints / 100).toFixed(2))}%`;

/**
 * What a payment comes to: its set amount, or its share of the contract's
 * total. Worked out when read, never stored, so changing the total changes
 * every share with it (doc §7.1).
 */
export function paymentAmount(
  payment: { percentBasisPoints: number | null; amountCents: number | null },
  contract: { totalCents: number | null },
): number | null {
  if (payment.amountCents !== null) return payment.amountCents;
  if (payment.percentBasisPoints === null || contract.totalCents === null) return null;
  return Math.round((contract.totalCents * payment.percentBasisPoints) / 10_000);
}

/**
 * What a contract is still missing: its payment terms, and its cancellation
 * terms — unless it has been said that there are none. A contract missing
 * either is flagged until it is complete (doc §7.1).
 */
export function missingTerms(contract: {
  documentUrl: string | null;
  totalCents: number | null;
  noCancellationTerms: boolean;
  _count: { payments: number; cancellations: number };
}) {
  const missing: string[] = [];
  if (contract.totalCents === null) missing.push("its total");
  if (contract._count.payments === 0) missing.push("payment terms");
  if (contract._count.cancellations === 0 && !contract.noCancellationTerms) missing.push("cancellation terms");
  if (!contract.documentUrl) missing.push("the signed PDF");
  return missing;
}

/**
 * Where a contract lives: its page is under its event (doc §7.1). Shown from
 * the hotel's page or the client's sales request while the event's Contracts
 * tab is hidden.
 */
export const contractHref = (eventId: string, contractId: string) => `/events/${eventId}/contracts/${contractId}`;
export const newContractHref = (eventId: string, query = "") => `/events/${eventId}/contracts/new${query}`;

/** Where a contract's page goes back to: the hotel's page, the sales request, or the event. */
export function contractBack(contract: {
  event: { id: string; name: string };
  property: { id: string; name: string } | null;
  salesRequest: { id: string } | null;
  client: { name: string } | null;
}) {
  if (contract.property) {
    return { href: `/properties/${contract.property.id}?back=${encodeURIComponent(`/events/${contract.event.id}`)}#contracts`, label: contract.property.name };
  }
  if (contract.salesRequest) return { href: `/sales/${contract.salesRequest.id}`, label: `${contract.client?.name ?? "The"} sales request` };
  return { href: `/events/${contract.event.id}`, label: contract.event.name };
}
