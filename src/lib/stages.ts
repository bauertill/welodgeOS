import type { CategoryContractStatus, ContactOutcome, QuotationStatus, ScoutingStatus, TaskStatus } from "generated/prisma";

/**
 * Where a property stands on an event's board (doc §3.9) — worked out, never
 * set by hand: from its hotel contact tasks, its quotations and its
 * contracts. It moves on its own as the work does.
 */
export type PropertyStage = "TO_CONTACT" | "PENDING_QUOTE" | "QUOTED" | "CONTRACTED" | "PROSPECT" | "COULDNT_HELP" | "RULED_OUT";

/** The board's order: the work in hand first, then the long list, then the closed ones. */
export const stageOrder: PropertyStage[] = ["TO_CONTACT", "PENDING_QUOTE", "QUOTED", "CONTRACTED", "PROSPECT", "COULDNT_HELP", "RULED_OUT"];

export const stageInfo: Record<PropertyStage, { label: string; hint: string; colour: string }> = {
  TO_CONTACT: { label: "To be contacted", hint: "A contact task is open and not started yet.", colour: "#7c4dd8" },
  PENDING_QUOTE: { label: "Pending quote", hint: "Contacted — the request emailed, or reached out — and waiting for their quotation.", colour: "#1d5fa8" },
  QUOTED: { label: "Quote received", hint: "They have sent a quotation for this event.", colour: "#b07800" },
  CONTRACTED: { label: "Contracted", hint: "Rooms contracted, or a supplier contract for this event.", colour: "#0a7a47" },
  PROSPECT: { label: "Prospects", hint: "On the list; nothing started yet.", colour: "#6b7280" },
  COULDNT_HELP: { label: "Couldn't help", hint: "Their last contact task closed with why they could not help.", colour: "#a3243d" },
  RULED_OUT: { label: "Ruled out", hint: "Marked Rejected for this event.", colour: "#9a9a9a" },
};

export function stageOf(entry: {
  status: ScoutingStatus;
  categoryContracts: { status: CategoryContractStatus }[];
  quotations: { status: QuotationStatus }[];
  /** Its hotel contact tasks on the event, newest first. */
  contactTasks: { status: TaskStatus; outcome: ContactOutcome | null }[];
  hasSupplierContract: boolean;
}): PropertyStage {
  if (entry.hasSupplierContract || entry.status === "CONTRACTED" || entry.categoryContracts.some((contract) => contract.status === "CONTRACTED")) {
    return "CONTRACTED";
  }
  if (entry.status === "REJECTED") return "RULED_OUT";
  if (entry.quotations.some((quotation) => quotation.status !== "DECLINED")) return "QUOTED";
  const open = entry.contactTasks.find((task) => task.status !== "DONE");
  if (open) return open.status === "IN_PROGRESS" ? "PENDING_QUOTE" : "TO_CONTACT";
  if (entry.status === "CONTACTED") return "PENDING_QUOTE";
  if (entry.contactTasks[0]?.outcome) return "COULDNT_HELP";
  return "PROSPECT";
}
