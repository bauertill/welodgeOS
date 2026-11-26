import type { DefectSeverity, DefectStatus, InspectionStatus } from "generated/prisma";
import { z } from "zod";

/**
 * Apartment inspections and defects (doc §6.10, Phase 3 step 3). Before
 * check-in one of the team walks each apartment with its checklist: what
 * should work (facility) and what should be there, how many (inventory), area
 * by area — the We Lodge check-in inspection sheet, now on a phone. What is
 * not right becomes a defect; once every defect that stops a check-in is fixed
 * and checked, the apartment is Ready for check-in.
 */

export type ChecklistItem = { id: string; label: string; /** Inventory: how many there should be; empty for "count it". */ expected: number | null };
export type ChecklistSection = { id: string; kind: "facility" | "inventory"; area: string; items: ChecklistItem[] };

export const checklistItem = z.object({
  id: z.string().min(1).max(40),
  label: z.string().trim().min(1, "Every item needs a name.").max(200),
  expected: z.number().int().min(0).max(999).nullable(),
});
export const checklistSection = z.object({
  id: z.string().min(1).max(40),
  kind: z.enum(["facility", "inventory"]),
  area: z.string().trim().min(1, "Every area needs a name.").max(100),
  items: z.array(checklistItem).max(80),
});
export const checklistInput = z.array(checklistSection).max(40);

/** A checklist as stored — anything malformed is left out rather than breaking the page. */
export function readChecklist(value: unknown): ChecklistSection[] {
  const parsed = checklistInput.safeParse(value);
  return parsed.success ? parsed.data : [];
}

export const newId = () => Math.random().toString(36).slice(2, 10);

export const severityLabels: Record<DefectSeverity, string> = {
  BEFORE_CHECK_IN: "Fix before check-in",
  MUST_FIX: "Must fix",
  DOCUMENT: "Just document",
  NOT_SURE: "Not sure",
};
export const severityHints: Record<DefectSeverity, string> = {
  BEFORE_CHECK_IN: "Broken shower, bad smell, cleaning needed",
  MUST_FIX: "To fix, but guests can move in",
  DOCUMENT: "A scratch, a chip — on record only",
  NOT_SURE: "The office decides",
};
export const severityStyles: Record<DefectSeverity, string> = {
  BEFORE_CHECK_IN: "bg-[#fbd5dc] text-[#8f1d35]",
  MUST_FIX: "bg-[#fde3c4] text-[#8a4b00]",
  DOCUMENT: "bg-ink-50 text-ink-700 ring-1 ring-ink-200",
  NOT_SURE: "bg-[#e6f0fb] text-[#1d5fa8]",
};
export const severityOrder: DefectSeverity[] = ["BEFORE_CHECK_IN", "MUST_FIX", "DOCUMENT", "NOT_SURE"];

export const defectStatusLabels: Record<DefectStatus, string> = { OPEN: "To fix", FIXED: "Fixed — to check", CHECKED: "Checked" };
export const inspectionStatusLabels: Record<InspectionStatus, string> = { PLANNED: "Planned", IN_PROGRESS: "Under way", DONE: "Done" };

/** A defect stops the check-in until it is checked as fixed: fix-before-check-in, and anything nobody has judged yet. */
export const blocksCheckIn = (defect: { severity: DefectSeverity; status: DefectStatus }) =>
  (defect.severity === "BEFORE_CHECK_IN" || defect.severity === "NOT_SURE") && defect.status !== "CHECKED";

export type Readiness = "NOT_PLANNED" | "PLANNED" | "IN_PROGRESS" | "TO_FIX" | "TO_CHECK" | "READY";
export const readinessLabels: Record<Readiness, string> = {
  NOT_PLANNED: "Not inspected",
  PLANNED: "Inspection planned",
  IN_PROGRESS: "Inspection under way",
  TO_FIX: "Defects to fix",
  TO_CHECK: "Fixed — to check",
  READY: "Ready for check-in",
};
export const readinessStyles: Record<Readiness, string> = {
  NOT_PLANNED: "bg-ink-50 text-ink-500 ring-1 ring-ink-200",
  PLANNED: "bg-[#e6f0fb] text-[#1d5fa8]",
  IN_PROGRESS: "bg-[#e6f0fb] text-[#1d5fa8]",
  TO_FIX: "bg-[#fbd5dc] text-[#8f1d35]",
  TO_CHECK: "bg-[#fde3c4] text-[#8a4b00]",
  READY: "bg-[#d9f99d] text-[#2f4a00]",
};

/**
 * Where an apartment stands, worked out on read (nothing derived is stored):
 * from its latest inspection and its defects at the event. Ready once the
 * inspection is done and no defect stops the check-in.
 */
export function readinessOf(latest: { status: InspectionStatus } | null, defects: { severity: DefectSeverity; status: DefectStatus }[]): Readiness {
  if (!latest) return "NOT_PLANNED";
  if (latest.status === "PLANNED") return "PLANNED";
  if (latest.status === "IN_PROGRESS") return "IN_PROGRESS";
  const blocking = defects.filter(blocksCheckIn);
  if (blocking.some((defect) => defect.status === "OPEN")) return "TO_FIX";
  if (blocking.length) return "TO_CHECK";
  return "READY";
}

/** A missing item, written for the defect: "2 missing Spoons (Kitchen)". */
export const missingText = (label: string, missing: number, area: string) => `${missing} missing ${label.replace(/\s*\(\s*\d*\s*\)\s*$/, "")} (${area})`;

const items = (...rows: (string | [string, number])[]): ChecklistItem[] =>
  rows.map((row) => (Array.isArray(row) ? { id: newId(), label: row[0], expected: row[1] } : { id: newId(), label: row, expected: null }));

/**
 * The standard apartment checklist, from the check-in inspection sheets used
 * at EXPO Osaka 2025 (Bay Wheel, Eslead, moco): kept in OS and changed there.
 * Counts are a starting point — each room type is adjusted to what is there.
 */
export function standardChecklist(): ChecklistSection[] {
  const section = (kind: ChecklistSection["kind"], area: string, list: ChecklistItem[]): ChecklistSection => ({ id: newId(), kind, area, items: list });
  return [
    section("facility", "Entrance", items("Doorbell", "Main door lock", "Light", "Floor / wall")),
    section("facility", "Living room", items("Intercom", "Light", "Floor / wall", "Wi-Fi", "Hot water system", "AC")),
    section("facility", "Bedroom", items("Door", "Light", "Floor / wall", "AC", "Closet")),
    section("facility", "Kitchen", items("Light (above the sink)", "Fan (above the stove)", "Floor / wall", "Kitchen cabinets (drawers and handles)", "Sink cabinet (drawers and handles)", "Cooking stove")),
    section("facility", "Bathroom", items("Toilet (seat and flushing)", "Shower and hot water", "Washing machine", "Light", "Floor / wall", "Mirror", "Fan")),
    section("facility", "Balcony", items("Light", "Floor / wall")),
    section("inventory", "Entrance", items(["Room slippers", 4], ["Umbrella stand", 1], ["Shoehorn", 1])),
    section(
      "inventory",
      "Living room",
      items(["TV and remote", 1], ["AC remote", 1], ["Dining table", 1], ["Dining chairs", 4], ["Sofa", 1], ["Vacuum cleaner", 1], ["Box tissue", 1], ["Trash bin", 1], ["User guide", 1]),
    ),
    section(
      "inventory",
      "Bedroom",
      items(["Bed", 1], ["Bed sheet", 1], ["Pillows", 2], ["Pillow covers", 2], ["Blanket", 1], ["Bath towel", 1], ["Face towel", 1], ["Side table", 1], ["Bedside lamp", 1], ["Hangers", 6], ["Trash bin", 1]),
    ),
    section(
      "inventory",
      "Kitchen",
      items(
        ["Electric kettle", 1],
        ["Refrigerator", 1],
        ["Microwave", 1],
        ["Rice cooker", 1],
        ["Frying pan", 1],
        ["Pot", 1],
        ["Plates (large)", 4],
        ["Plates (small)", 4],
        ["Bowls", 4],
        ["Mugs", 4],
        ["Glasses", 4],
        ["Spoons", 4],
        ["Forks", 4],
        ["Knives", 4],
        ["Chopsticks", 4],
        ["Tea spoons", 4],
        ["Kitchen knife", 1],
        ["Chopping board", 1],
        ["Spatula", 1],
        ["Ladle", 1],
        ["Strainer", 1],
        ["Dish rack", 1],
        ["Dishwashing detergent", 1],
        ["Sponge", 1],
        ["Kitchen paper roll", 1],
        ["Salt and pepper", 1],
        ["Trash bins", 2],
      ),
    ),
    section(
      "inventory",
      "Bathroom",
      items(["Bath towel", 1], ["Face towel", 1], ["Bath mat", 1], ["Hair dryer", 1], ["Hand soap", 1], ["Shampoo", 1], ["Conditioner", 1], ["Body soap", 1], ["Washing detergent", 1], ["Cleaning spray and sponge", 1], ["Trash bin", 1]),
    ),
    section("inventory", "Toilet", items(["Toilet paper rolls", 2], ["Toilet brush", 1], ["Sanitary box", 1])),
    section("inventory", "Balcony", items(["Clothes drying rack", 1], ["Slippers", 1])),
  ];
}
