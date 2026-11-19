import type { ContractorKind } from "generated/prisma";

/** What a contractor does for us, in the business's words (doc §3.11). */
export const contractorKindLabels: Record<ContractorKind, string> = {
  FURNITURE: "Furniture",
  CLEANING: "Cleaning",
  LINEN: "Linen & laundry",
  MAINTENANCE: "Maintenance",
  TRANSPORT: "Transport",
  SECURITY: "Security",
  CATERING: "Catering",
  OTHER: "Other",
};

export const contractorKinds = Object.keys(contractorKindLabels) as ContractorKind[];

/** "Furniture", or what an Other contractor does in its own words. */
export const contractorWhat = (contractor: { kind: ContractorKind; service?: string | null }) =>
  contractor.kind === "OTHER" && contractor.service?.trim() ? contractor.service.trim() : contractorKindLabels[contractor.kind];
