import type { ContactOutcome, TaskStatus } from "generated/prisma";

/**
 * The words for tasks (doc §2.8), said once so every screen agrees.
 */

export const taskStatusLabels: Record<TaskStatus, string> = {
  BACKLOG: "Backlog",
  TODO: "To do",
  IN_PROGRESS: "In progress",
  DONE: "Done",
};

export const taskStatusOrder: TaskStatus[] = ["BACKLOG", "TODO", "IN_PROGRESS", "DONE"];

export const taskStatusHints: Record<TaskStatus, string> = {
  BACKLOG: "Noted for later — nobody is expected to start on it yet.",
  TODO: "Ready to be done, by the person it is for.",
  IN_PROGRESS: "Being worked on.",
  DONE: "Finished.",
};

export const taskStatusStyles: Record<TaskStatus, string> = {
  BACKLOG: "bg-ink-50 text-ink-700",
  TODO: "bg-[#e6f0fb] text-[#1d5fa8]",
  IN_PROGRESS: "bg-brand-50 text-brand-800",
  DONE: "bg-[#e3f8ee] text-[#0a7a47]",
};

/** Why a hotel could not help (doc §4.11) — the label a closed contact task carries. */
export const contactOutcomeLabels: Record<ContactOutcome, string> = {
  NO_AVAILABILITY: "No availability",
  NO_GROUPS: "No groups",
  NOT_INTERESTED: "Not interested",
};

export const contactOutcomeHints: Record<ContactOutcome, string> = {
  NO_AVAILABILITY: "Full, or not enough rooms, for these dates",
  NO_GROUPS: "Does not take group bookings",
  NOT_INTERESTED: "Does not want to work with us",
};

export const contactOutcomeOrder: ContactOutcome[] = ["NO_AVAILABILITY", "NO_GROUPS", "NOT_INTERESTED"];

export const contactOutcomeStyle = "bg-[#fde8ec] text-[#a3243d]";
