import type { SiteVisitVerdict } from "generated/prisma";
import { z } from "zod";

/**
 * Site visit reports (doc §3.12, the owner 2026-11-26): the words and shapes a
 * report is made of, shared by the site, the server and Claude's connector.
 */

export const siteVisitVerdicts = ["STRONG", "NEEDS_WORK", "NOT_READY", "NO_GO"] as const satisfies readonly SiteVisitVerdict[];

/** The team tag every new report is sent to, as if @mentioned (the owner, 2026-11-26: "auto tag, @LA group"). */
export const SITE_VISIT_TEAM_TAG = "LA";

export const verdictLabels: Record<SiteVisitVerdict, string> = {
  STRONG: "Strong option",
  NEEDS_WORK: "Needs work",
  NOT_READY: "Not ready",
  NO_GO: "Not for us",
};

/** The badge's colours, as on Alex's report: lime, orange, red — and grey for a no. */
export const verdictStyles: Record<SiteVisitVerdict, string> = {
  STRONG: "bg-[#d9f99d] text-[#2f4a00]",
  NEEDS_WORK: "bg-[#fde3c4] text-[#8a4b00]",
  NOT_READY: "bg-[#fbd5dc] text-[#8f1d35]",
  NO_GO: "bg-ink-100 text-ink-700",
};

/** The facts a side-by-side starts with; any can be left empty or renamed, and more added. */
export const glanceDefaults = ["Building", "Sleeps", "Bathrooms", "Floors", "Kitchen", "Laundry", "Outdoor", "Entry", "Condition"];

const line = (max: number) => z.string().trim().max(max);
export const glanceRow = z.object({ label: line(80).min(1), value: line(500) });
export const areaRow = z.object({ area: line(120).min(1), seen: line(2000) });
export const issueRow = z.object({ title: line(120).min(1), text: line(2000).default(""), videoUrl: line(2000).optional(), at: line(40).optional() });
export const videoRow = z.object({ name: line(200).min(1), url: line(2000).min(1) });

export type GlanceRow = z.infer<typeof glanceRow>;
export type AreaRow = z.infer<typeof areaRow>;
export type IssueRow = z.infer<typeof issueRow>;
export type VideoRow = z.infer<typeof videoRow>;

export const unitInput = z.object({
  propertyId: z.string().nullable().optional(),
  label: line(200).min(1, "Each place visited needs a name."),
  verdict: z.enum(siteVisitVerdicts).nullable().optional(),
  verdictNote: line(80).optional(),
  conclusion: line(2000).optional(),
  notes: line(5000).optional(),
  glance: z.array(glanceRow).max(40).default([]),
  areas: z.array(areaRow).max(40).default([]),
  issues: z.array(issueRow).max(60).default([]),
  videos: z.array(videoRow).max(60).default([]),
});
export type UnitInput = z.infer<typeof unitInput>;

export const visitInput = z.object({
  title: line(200).min(1, "Give the report a title."),
  visitedOn: z.string().regex(/^\d{4}-\d{2}-\d{2}$/, "A date as YYYY-MM-DD"),
  visitors: line(300).optional(),
  guide: line(200).optional(),
  summary: line(5000).optional(),
  eventId: z.string().nullable().optional(),
  providerId: z.string().nullable().optional(),
  units: z.array(unitInput).min(1, "Add at least one place visited.").max(30),
});
export type VisitInput = z.infer<typeof visitInput>;

/** A stored list read back safely: what does not fit the shape is left out. */
export function readRows<T>(value: unknown, row: z.ZodType<T, z.ZodTypeDef, unknown>): T[] {
  if (!Array.isArray(value)) return [];
  return value.flatMap((item) => {
    const parsed = row.safeParse(item);
    return parsed.success ? [parsed.data] : [];
  });
}

/** The side-by-side's rows: every label any unit has, in the order first met. */
export function glanceLabels(units: { glance: GlanceRow[] }[]) {
  const labels: string[] = [];
  for (const unit of units) for (const row of unit.glance) if (row.value.trim() && !labels.includes(row.label)) labels.push(row.label);
  return labels;
}
