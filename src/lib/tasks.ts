import type { TaskStatus } from "generated/prisma";

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
