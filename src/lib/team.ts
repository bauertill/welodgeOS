import type { PhoneKind, UserStatus } from "generated/prisma";

/** UI copy for the team section (doc §2.7). No enum names on screen. */
export const phoneKindLabels: Record<PhoneKind, string> = {
  MOBILE: "Mobile",
  WHATSAPP: "WhatsApp",
  MOBILE_AND_WHATSAPP: "Mobile & WhatsApp",
};

export const phoneKinds = Object.keys(phoneKindLabels) as PhoneKind[];

/** What to call a colleague on screen when they have not set a name. */
export function personName(person: { name: string | null; email: string | null }) {
  return person.name ?? person.email ?? "Unnamed colleague";
}

/**
 * The one key a private conversation between two colleagues is stored under,
 * whichever of them starts it — so a pair can only ever have one.
 */
export function directKey(a: string, b: string) {
  return [a, b].sort().join(":");
}

/** How often an open conversation checks for new messages, in milliseconds. */
export const threadPollMs = 4_000;
/** How often the unread count — and so the message sound — is refreshed. */
export const unreadPollMs = 10_000;

// --- Presence (doc §2.7) ------------------------------------------------------

/** How often an open, in-use tab tells the server its person is still here. */
export const heartbeatMs = 60_000;
/** No click or keypress for this long, and the tab stops saying so. */
export const idleAfterMs = 5 * 60_000;
/** Not heard from for this long, and a person on automatic shows as Away. */
export const activeWithinMs = 2.5 * 60_000;
/** How often the directory refreshes everyone's dots. */
export const presencePollMs = 30_000;

/** What a colleague's dot says: a status set by hand wins over the automatic one. */
export type Presence = "ACTIVE" | "AWAY" | UserStatus;

/** A time limit that has passed is as good as no status at all. */
function stillOn(until: Date | null, now: Date) {
  return !until || until.getTime() > now.getTime();
}

export function presenceOf(
  person: { lastSeenAt: Date | null; status: UserStatus | null; statusUntil: Date | null },
  now = new Date(),
): Presence {
  if (person.status && stillOn(person.statusUntil, now)) return person.status;
  return person.lastSeenAt && now.getTime() - person.lastSeenAt.getTime() < activeWithinMs
    ? "ACTIVE"
    : "AWAY";
}

export type CustomStatus = { emoji: string; text: string; until: Date | null };

/** The status in the person's own words, if they have one and it has not run out. */
export function customStatusOf(
  person: {
    customStatusEmoji: string | null;
    customStatusText: string | null;
    customStatusUntil: Date | null;
  },
  now = new Date(),
): CustomStatus | null {
  if (!person.customStatusText || !stillOn(person.customStatusUntil, now)) return null;
  return {
    emoji: person.customStatusEmoji ?? defaultEmoji,
    text: person.customStatusText,
    until: person.customStatusUntil,
  };
}

export const presenceLabels: Record<Presence, string> = {
  ACTIVE: "Active",
  AWAY: "Away",
  DO_NOT_DISTURB: "Do not disturb",
};

// --- Time limits ------------------------------------------------------------
// Worked out in the browser, because "today" and "this week" end at midnight
// where the person is, which only their browser knows.

function endOfDay(now: Date) {
  const end = new Date(now);
  end.setHours(23, 59, 59, 999);
  return end;
}

/** The end of Sunday — a Swiss week runs Monday to Sunday. */
function endOfWeek(now: Date) {
  const end = endOfDay(now);
  end.setDate(end.getDate() + ((7 - end.getDay()) % 7));
  return end;
}

const minutes = (count: number) => (now: Date) => new Date(now.getTime() + count * 60_000);

export type ClearAfter = "30m" | "1h" | "4h" | "today" | "week" | "never" | "custom";

export const clearAfterChoices: { key: ClearAfter; label: string }[] = [
  { key: "30m", label: "30 minutes" },
  { key: "1h", label: "1 hour" },
  { key: "4h", label: "4 hours" },
  { key: "today", label: "Today" },
  { key: "week", label: "This week" },
  { key: "never", label: "Don't clear" },
  { key: "custom", label: "Custom" },
];

const clearAfterUntil: Record<Exclude<ClearAfter, "custom">, (now: Date) => Date | null> = {
  "30m": minutes(30),
  "1h": minutes(60),
  "4h": minutes(240),
  today: endOfDay,
  week: endOfWeek,
  never: () => null,
};

export function untilFor(choice: Exclude<ClearAfter, "custom">, now = new Date()) {
  return clearAfterUntil[choice](now);
}

/** The choices in the status menu; `null` is automatic. Each lasts until changed. */
export const statusChoices: { status: UserStatus | null; label: string; hint?: string }[] = [
  { status: null, label: "Automatic", hint: "Based on your activity" },
  { status: "DO_NOT_DISTURB", label: "Do not disturb", hint: "Mutes the message sound" },
  { status: "AWAY", label: "Set as away" },
];

// --- Custom status ----------------------------------------------------------

export const customStatusMaxLength = 64;
export const defaultEmoji = "💬";

/** One-click statuses, with how long each usually lasts. */
export const customStatusPresets: { emoji: string; text: string; clearAfter: Exclude<ClearAfter, "custom"> }[] = [
  { emoji: "🥪", text: "At lunch", clearAfter: "1h" },
  { emoji: "🏃", text: "Be right back", clearAfter: "30m" },
  { emoji: "📅", text: "In a meeting", clearAfter: "1h" },
  { emoji: "🚗", text: "Commuting", clearAfter: "1h" },
  { emoji: "🏨", text: "On a site visit", clearAfter: "today" },
  { emoji: "🤒", text: "Out sick", clearAfter: "today" },
  { emoji: "🌴", text: "On holiday", clearAfter: "week" },
  { emoji: "🌙", text: "Done for the day", clearAfter: "today" },
];

export const emojiChoices = [
  "💬", "🏃", "📅", "🚗", "🚆", "✈️", "🏨", "🏢",
  "🏠", "💻", "📞", "🎧", "☕", "🍽️", "🥪", "🤒",
  "🌴", "🏖️", "⛷️", "🎉", "🏆", "⚽", "🎯", "🧠",
  "✅", "⏳", "🔕", "🙏", "👍", "😊", "🤝", "🌍",
];
