import type { TaxKind } from "generated/prisma";

/**
 * The taxes and fees a hotel adds to its rates (doc §3.10), as the team picks
 * them from a list: each a percentage of the room rate or a fixed amount per
 * room per night. Every percentage is of the rate itself, never compounded on
 * another tax.
 */
export const taxKindLabels: Record<TaxKind, string> = {
  OCCUPANCY: "Occupancy tax (TOT)",
  CITY: "City tax",
  VAT: "VAT",
  SALES: "Sales tax",
  ISS: "ISS — municipal service tax",
  SERVICE_CHARGE: "Service charge",
  TOURISM: "Tourism tax",
  TOURISM_DISTRICT: "Tourism district fee (TMD / TBID)",
  RESORT_FEE: "Resort fee",
  OTHER: "Other",
};

export const taxKinds = Object.keys(taxKindLabels) as TaxKind[];

export type TaxLine = { kind: TaxKind; label: string | null; basisPoints: number | null; amountCents: number | null };

/** "ISS — municipal service tax", or the name given — "Other: Taxa de turismo" reads as "Taxa de turismo". */
export function taxName(tax: Pick<TaxLine, "kind" | "label">) {
  if (tax.kind === "OTHER") return tax.label?.trim() || "Other tax";
  return tax.label?.trim() ? `${taxKindLabels[tax.kind]} — ${tax.label.trim()}` : taxKindLabels[tax.kind];
}

/** The taxes on one room-night at this rate: each percentage of the rate, plus each fixed amount. */
export function taxesPerNight(rateCents: number, taxes: Pick<TaxLine, "basisPoints" | "amountCents">[]) {
  return taxes.reduce((sum, tax) => sum + (tax.basisPoints !== null ? Math.round((rateCents * tax.basisPoints) / 10_000) : 0) + (tax.amountCents ?? 0), 0);
}

/** The percentages added up — what a room type's single TOT figure takes from a quotation (doc §3.9). */
export function percentTaxes(taxes: Pick<TaxLine, "basisPoints">[]) {
  const percents = taxes.filter((tax) => tax.basisPoints !== null);
  return percents.length ? percents.reduce((sum, tax) => sum + tax.basisPoints!, 0) : null;
}

/** Kinds that are taxes; the rest — service charge, resort fee, a bank charge — are fees. */
const TAX_KINDS: TaxKind[] = ["OCCUPANCY", "CITY", "VAT", "SALES", "ISS", "TOURISM"];
const isTax = (tax: Pick<TaxLine, "kind" | "label">) => TAX_KINDS.includes(tax.kind) || (tax.kind === "OTHER" && /\btax|taxa|imposto|impuesto|steuer/i.test(tax.label ?? ""));

/**
 * What the amounts on top of a quotation's rates are called (the owner,
 * 2026-11-25: "we included the 12% International Bank Transfer charge, but
 * here it's labeled as tax"): one alone by its own name ("International Bank
 * Transfer"), else "taxes", "fees" or "taxes and fees" as they are.
 */
export function extrasLabel(taxes: Pick<TaxLine, "kind" | "label">[]) {
  if (taxes.length === 1) return taxName(taxes[0]!);
  const taxed = taxes.filter(isTax).length;
  return taxed === taxes.length ? "taxes" : taxed === 0 ? "fees" : "taxes and fees";
}

/** The same, to start a sentence or a column: "Taxes and fees", "International Bank Transfer". */
export const ExtrasLabel = (taxes: Pick<TaxLine, "kind" | "label">[]) => {
  const label = extrasLabel(taxes);
  return label.charAt(0).toUpperCase() + label.slice(1);
};
