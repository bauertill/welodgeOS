import type { UpdateKind } from "generated/prisma";

/**
 * The kinds of update (doc §2.6), as the team had them on monday.com: a
 * note, meeting feedback, a call summary and site inspection feedback — each
 * but the note with its own template, a heading per thing to say. A posted
 * template is kept as plain text, each answer under its heading, so it can be
 * edited like any update; headings left empty are left out.
 */
export type UpdateKindInfo = {
  label: string;
  /** What it is called in a sentence: "Meeting on 3 Oct". */
  short: string;
  badge: string;
  /** Only for a property — a site inspection is of a place. */
  propertyOnly?: boolean;
  sections: { heading: string; placeholder: string }[];
};

export const updateKinds: Record<UpdateKind, UpdateKindInfo> = {
  NOTE: { label: "Note", short: "Note", badge: "bg-ink-50 text-ink-700", sections: [] },
  MEETING: {
    label: "Meeting feedback",
    short: "Meeting",
    badge: "bg-[#e6f0fb] text-[#1d5fa8]",
    sections: [
      { heading: "Who was there", placeholder: "Their GM and sales manager; @Ami and I" },
      { heading: "What was discussed", placeholder: "Group rates for LA28, blocks, payment terms…" },
      { heading: "What was agreed", placeholder: "They hold 40 rooms until 1 Dec…" },
      { heading: "Next steps", placeholder: "Send the contract draft by Friday" },
    ],
  },
  CALL: {
    label: "Call summary",
    short: "Call",
    badge: "bg-[#e3f8ee] text-[#0a7a47]",
    sections: [
      { heading: "Who we spoke to", placeholder: "Maria Lopez, sales manager" },
      { heading: "Summary", placeholder: "What was said" },
      { heading: "Next steps", placeholder: "Follow up next week with dates" },
    ],
  },
  SITE_INSPECTION: {
    label: "Site inspection feedback",
    short: "Site inspection",
    badge: "bg-[#fff4e0] text-[#8a5a00]",
    propertyOnly: true,
    sections: [
      { heading: "Who visited", placeholder: "@Brandon, with their front office manager" },
      { heading: "First impression", placeholder: "Clean, recently renovated, quiet street" },
      { heading: "Rooms", placeholder: "Sizes, beds, condition, views" },
      { heading: "Common areas and amenities", placeholder: "Lobby, breakfast room, gym, parking" },
      { heading: "Location and surroundings", placeholder: "Walk to the IBC, food nearby, safety at night" },
      { heading: "Fit for our clients", placeholder: "Good for broadcasters; too small for a federation" },
      { heading: "Photos and video", placeholder: "Link to the Drive folder" },
      { heading: "Next steps", placeholder: "Ask for a quotation for 30 rooms" },
    ],
  },
};

export const updateKindOrder: UpdateKind[] = ["NOTE", "MEETING", "CALL", "SITE_INSPECTION"];

/** The template's answers as one body: each heading on its line, its answer beneath; empty ones left out. */
export function composeBody(kind: UpdateKind, answers: Record<string, string>) {
  return updateKinds[kind].sections
    .map((section) => ({ heading: section.heading, answer: (answers[section.heading] ?? "").trim() }))
    .filter((section) => section.answer)
    .map((section) => `${section.heading}\n${section.answer}`)
    .join("\n\n");
}

/** Whether a line of a body is one of its kind's headings — shown as a heading. */
export function isHeading(kind: UpdateKind, line: string) {
  return updateKinds[kind].sections.some((section) => section.heading === line.trim());
}
