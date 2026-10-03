import type { SalesRequestStage } from "generated/prisma";

/**
 * The words for a sales request (doc §4.11): where it stands, and the fields a
 * request is made of, labelled once so the form, the page and the history
 * all say the same thing.
 */

export const salesStageLabels: Record<SalesRequestStage, string> = {
  INITIAL_INTEREST: "Initial interest",
  PROPOSAL_SENT: "Proposal sent",
  BLOCKED: "Blocked",
  SIGNED: "Signed",
  RELEASED: "Released",
  NO_REPLY: "No reply",
  LOST: "Lost",
};

export const salesStageHints: Record<SalesRequestStage, string> = {
  INITIAL_INTEREST: "The client has asked. We are looking for units and preparing a proposal.",
  PROPOSAL_SENT: "We have sent the client a proposal and are waiting for their answer.",
  BLOCKED: "The client is holding rooms while they decide.",
  SIGNED: "The client has signed. Closed.",
  RELEASED: "The client let their block go. Closed.",
  NO_REPLY: "The client never came back to us. Closed.",
  LOST: "The client went elsewhere or dropped the plan. Closed.",
};

/** Still being worked, in the order a request moves through them. */
export const openStages: SalesRequestStage[] = ["INITIAL_INTEREST", "PROPOSAL_SENT", "BLOCKED"];
/** The ways a request ends. */
export const closedStages: SalesRequestStage[] = ["SIGNED", "RELEASED", "NO_REPLY", "LOST"];
export const salesStageOrder: SalesRequestStage[] = [...openStages, ...closedStages];

export const isClosed = (stage: SalesRequestStage) => closedStages.includes(stage);

export const salesStageStyles: Record<SalesRequestStage, string> = {
  INITIAL_INTEREST: "bg-[#fff4e0] text-[#a15c00]",
  PROPOSAL_SENT: "bg-[#ffe9e0] text-[#b33f12]",
  BLOCKED: "bg-brand-50 text-brand-800",
  SIGNED: "bg-[#e3f8ee] text-[#0a7a47]",
  RELEASED: "bg-ink-50 text-ink-700",
  NO_REPLY: "bg-ink-50 text-ink-700",
  LOST: "bg-[#fde8ec] text-[#a3243d]",
};

/** The client's initial interest, as they put it. */
export const interestFields = [
  { key: "description", label: "What they asked for", placeholder: "In their words — \"About 15 rooms for our team, close to the Expo, in July\"" },
  { key: "location", label: "Location and/or property", placeholder: "Santa Monica, within an hour by public transport" },
  { key: "rooms", label: "No. of rooms / room category / occupancy", placeholder: "35–40 twin rooms, 10–20 single rooms" },
  { key: "period", label: "Period", placeholder: "7 – 31 July 2028" },
  { key: "budget", label: "Budget / proposed rate", placeholder: "About USD 100 per person per night" },
  { key: "prePost", label: "Pre and post", placeholder: "Two nights before, one after" },
  { key: "rateIncludes", label: "Rate includes", placeholder: "Breakfast, Wi-Fi" },
  { key: "extraServices", label: "Extra services required", placeholder: "Meeting room, laundry" },
] as const;

/** What the lawyers need to draw up the contract. */
export const contractingFields = [
  { key: "tradeName", label: "Trade name", placeholder: "Österreichisches Olympisches Comité" },
  { key: "companyAddress", label: "Company address", placeholder: "Street, postcode, city, country" },
  { key: "vatNumber", label: "VAT number" },
  { key: "registrationNumber", label: "Registration number" },
  { key: "signatory1Name", label: "Name of signatory 1" },
  { key: "signatory1Designation", label: "Designation of signatory 1", placeholder: "Secretary General" },
  { key: "signatory2Name", label: "Name of signatory 2" },
  { key: "signatory2Designation", label: "Designation of signatory 2" },
  { key: "contractContacts", label: "Contact persons", placeholder: "Name, job title, email — one person per line" },
  { key: "propertyNameAndAddress", label: "Hotel / apartments and address" },
  { key: "paymentSchedule", label: "Payment schedule" },
  { key: "cancellationPolicy", label: "Cancellation policy" },
  { key: "otherServices", label: "Other services / facilities, with rate" },
] as const;

export type InterestKey = (typeof interestFields)[number]["key"];

/**
 * What a request said in words before its details had fields of their own
 * (doc §4.11): kept, and shown under More detail where a request has any.
 */
export const earlierInterestFields = interestFields.filter((field) => field.key !== "description" && field.key !== "rooms");
export type ContractingKey = (typeof contractingFields)[number]["key"];

/**
 * The contracting details the client fills in themselves, through the link
 * (doc §4.11) — their company and who signs. The rest are our terms, and are
 * never shown to them.
 */
export const clientContractingKeys = [
  "tradeName",
  "companyAddress",
  "vatNumber",
  "registrationNumber",
  "signatory1Name",
  "signatory1Designation",
  "signatory2Name",
  "signatory2Designation",
  "contractContacts",
] as const satisfies readonly ContractingKey[];

export type ClientContractingKey = (typeof clientContractingKeys)[number];

/** A contact person for the contract, as the link's form asks for one. */
export type ContractContact = { name: string; jobTitle: string; email: string };

/** "Name, Job title, email" per line — how the contact persons are kept. */
export function joinContractContacts(people: ContractContact[]) {
  return people
    .map((person) => [person.name, person.jobTitle, person.email].map((part) => part.trim().replace(/,/g, " ")).filter(Boolean).join(", "))
    .filter(Boolean)
    .join("\n");
}

/** The lines back into people; a line in another shape is kept whole as the name. */
export function splitContractContacts(text: string | null): ContractContact[] {
  return (text ?? "")
    .split("\n")
    .map((line) => line.trim())
    .filter(Boolean)
    .map((line) => {
      const parts = line.split(",").map((part) => part.trim());
      const email = parts.length > 1 && parts[parts.length - 1]!.includes("@") ? parts.pop()! : "";
      return parts.length === 2 ? { name: parts[0]!, jobTitle: parts[1]!, email } : { name: parts.join(", "), jobTitle: "", email };
    });
}
