import type { ClientCategory, ContactType, Priority } from "generated/prisma";

/**
 * The words the sales side speaks (doc §4.10): what kind of organisation a
 * client is, and where a person there stands with us.
 */

export const clientCategoryLabels: Record<ClientCategory, string> = {
  BROADCASTER: "Broadcaster",
  FEDERATION: "Federation / NOC",
  SPONSOR: "Sponsor",
  EVENT_ORGANISER: "Event organiser",
  AGENCY: "Agency",
  CORPORATE: "Corporate",
  TECHNICAL_SUPPLIER: "Technical supplier",
  MEDIA: "Media",
  OTHER: "Other",
  PRIVATE_PERSON: "Private person",
};

export const clientCategoryOrder: ClientCategory[] = [
  "BROADCASTER",
  "FEDERATION",
  "SPONSOR",
  "EVENT_ORGANISER",
  "AGENCY",
  "CORPORATE",
  "TECHNICAL_SUPPLIER",
  "MEDIA",
  "OTHER",
  "PRIVATE_PERSON",
];

export const contactTypeLabels: Record<ContactType, string> = {
  LEAD: "Lead",
  QUALIFIED_LEAD: "Qualified lead",
  CUSTOMER: "Customer",
  PARTNER: "Partner",
  OTHER: "Other",
};

export const contactTypeOrder: ContactType[] = ["LEAD", "QUALIFIED_LEAD", "CUSTOMER", "PARTNER", "OTHER"];

export const priorityLabels: Record<Priority, string> = {
  HIGH: "High",
  MEDIUM: "Medium",
  LOW: "Low",
};

export const priorityOrder: Priority[] = ["HIGH", "MEDIUM", "LOW"];

/**
 * A client's contracting details (doc §4.10): the legal entity a contract is
 * signed with. The same fields, by the same names, as the company part of a
 * sales request's contracting details — a request starts from these, and
 * what the client sends through their link is kept here for next time.
 */
export const clientCompanyFields = [
  { key: "tradeName", label: "Trade name", placeholder: "Österreichisches Olympisches Comité" },
  { key: "companyAddress", label: "Company address", placeholder: "Street, postcode, city, country" },
  { key: "vatNumber", label: "VAT number" },
  { key: "registrationNumber", label: "Registration number" },
  { key: "signatory1Name", label: "Name of signatory 1" },
  { key: "signatory1Designation", label: "Designation of signatory 1", placeholder: "Secretary General" },
  { key: "signatory2Name", label: "Name of signatory 2" },
  { key: "signatory2Designation", label: "Designation of signatory 2" },
] as const;

export type ClientCompanyKey = (typeof clientCompanyFields)[number]["key"];
export const clientCompanyKeys = clientCompanyFields.map((field) => field.key) as ClientCompanyKey[];
