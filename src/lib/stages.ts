import type { CategoryContractStatus, ContactOutcome, QuotationStatus, ScoutingStatus, TaskStatus } from "generated/prisma";

import type { ScoutingDetailShown } from "~/lib/scouting";

/**
 * Where a property stands on an event's board (doc §3.9, the team 2026-11-17).
 * Its **group** is set by hand — dragged, or several moved at once — except
 * that a supplier contract or a contracted room type always shows it as
 * Contracted. Its **status** is the detail beneath: what a person set, or else
 * what the system works out from its contact tasks and quotations.
 */
export function groupOf(entry: {
  status: ScoutingStatus;
  categoryContracts: { status: CategoryContractStatus }[];
  hasSupplierContract: boolean;
}): ScoutingStatus {
  if (entry.hasSupplierContract || entry.categoryContracts.some((contract) => contract.status === "CONTRACTED")) return "CONTRACTED";
  return entry.status;
}

/** Whether the group is held at Contracted by a contract, so moving it elsewhere would not show. */
export function contractedByContract(entry: { categoryContracts: { status: CategoryContractStatus }[]; hasSupplierContract: boolean }) {
  return entry.hasSupplierContract || entry.categoryContracts.some((contract) => contract.status === "CONTRACTED");
}

/** The status the system works out, shown when nobody has set one by hand. */
export function autoDetailOf(
  entry: {
    quotations: { status: QuotationStatus; validUntil: Date | null }[];
    /** Its hotel contact tasks on the event, newest first. */
    contactTasks: { status: TaskStatus; outcome: ContactOutcome | null }[];
    status: ScoutingStatus;
  },
  today: Date = new Date(),
): ScoutingDetailShown | null {
  const live = entry.quotations.filter((quotation) => quotation.status !== "DECLINED");
  if (live.length) {
    const day = new Date(Date.UTC(today.getFullYear(), today.getMonth(), today.getDate()));
    const expired = live.every((quotation) => quotation.status !== "ACCEPTED" && quotation.validUntil !== null && quotation.validUntil < day);
    return expired ? "QUOTE_EXPIRED" : "QUOTE_RECEIVED";
  }
  const open = entry.contactTasks.find((task) => task.status !== "DONE");
  if (open) return open.status === "IN_PROGRESS" ? "QUOTE_REQUESTED" : "TO_CONTACT";
  const outcome = entry.contactTasks[0]?.outcome;
  if (outcome) return outcome === "NO_AVAILABILITY" ? "NO_AVAILABILITY" : "COULDNT_HELP";
  if (entry.status === "CONTACTED") return "QUOTE_REQUESTED";
  return null;
}
