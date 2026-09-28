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
  { key: "description", label: "What they need", placeholder: "15 twin rooms for 30 people, close to the Expo" },
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
export type ContractingKey = (typeof contractingFields)[number]["key"];
