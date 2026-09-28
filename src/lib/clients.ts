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
  OTHER: "Other",
};

export const clientCategoryOrder: ClientCategory[] = [
  "BROADCASTER",
  "FEDERATION",
  "SPONSOR",
  "EVENT_ORGANISER",
  "AGENCY",
  "CORPORATE",
  "OTHER",
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
