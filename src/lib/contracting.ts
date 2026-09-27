/**
 * Contracting details (doc §3.9): the legal entity a contract is signed with.
 * A property and a provider carry the same fields; a property with none of
 * its own falls back on its provider's. Labels are the business's own words.
 */
export const contractingFields = [
  { key: "tradeName", label: "Trade name" },
  { key: "vatNumber", label: "VAT number" },
  { key: "registrationNumber", label: "Registration number" },
  { key: "iban", label: "IBAN" },
  { key: "bic", label: "BIC" },
  { key: "signatoryName", label: "Name of signatory" },
  { key: "signatoryTitle", label: "Designation of signatory" },
  { key: "contractEmail", label: "Email address for contracts" },
] as const;

export type ContractingKey = (typeof contractingFields)[number]["key"];
export type Contracting = Partial<Record<ContractingKey, string | null>>;

const hasAny = (details: Contracting | null | undefined) =>
  Boolean(details && contractingFields.some(({ key }) => details[key]?.trim()));

/**
 * The details that apply to a property: its own if it has any at all,
 * otherwise its provider's — said so, so nobody mistakes one for the other.
 * All or nothing, not field by field: a contract is signed with one entity.
 */
export function effectiveContracting(
  property: Contracting,
  provider: (Contracting & { name: string }) | null | undefined,
): { details: Contracting; from: "property" | "provider" | null; providerName?: string } {
  if (hasAny(property)) return { details: property, from: "property" };
  if (provider && hasAny(provider)) return { details: provider, from: "provider", providerName: provider.name };
  return { details: {}, from: null };
}

/** Everything else recorded about a property (doc §3.9), in the order shown. */
export const propertyDetailFields = [
  { key: "area", label: "Area", placeholder: "Santa Monica" },
  { key: "generalEmail", label: "General email", placeholder: "reservations@hotel.com" },
  { key: "videoUrl", label: "Video", placeholder: "https://…" },
  { key: "checkInTime", label: "Check-in time", placeholder: "15:00" },
  { key: "checkOutTime", label: "Check-out time", placeholder: "11:00" },
] as const;

export const propertyServiceFields = [
  { key: "breakfast", label: "Breakfast", placeholder: "Included / USD 25 pp / No" },
  { key: "cleaning", label: "Cleaning", placeholder: "Daily" },
  { key: "laundry", label: "Laundry", placeholder: "On site, charged" },
  { key: "gym", label: "Gym", placeholder: "24h, free" },
  { key: "publicTransport", label: "Public transport", placeholder: "Metro E line, 5 min walk" },
] as const;

/** The terms agreed per event (doc §3.9), as the side panel shows them. */
export const termTextFields = [
  { key: "applicablePeriod", label: "Applicable period", hint: "When the rates apply — the wording that goes to the lawyers." },
  { key: "ratesInclude", label: "Rates include", hint: "What the rates include — the wording that goes to the lawyers." },
  { key: "deposit", label: "Deposit" },
  { key: "cancellationTerms", label: "Cancellation terms" },
  { key: "paymentTerms", label: "Payment terms" },
] as const;
