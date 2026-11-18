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
