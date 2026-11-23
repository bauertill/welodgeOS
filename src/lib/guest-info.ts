/**
 * Property information for the client (doc §6.8, the owner 2026-11-23): what
 * guests need to know about a property, in the order the client's page shows
 * it. The first five are kept with the property's other details already; the
 * rest are its guest information.
 */
export const guestFields = [
  { key: "checkInTime", label: "Check-in from", placeholder: "e.g. 15:00", short: true },
  { key: "checkOutTime", label: "Check-out by", placeholder: "e.g. 11:00", short: true },
  { key: "guestCheckIn", label: "How to check in", placeholder: "e.g. Reception on the ground floor, open 24 hours. Keys are handed over by our team in the lobby." },
  { key: "guestPayment", label: "Needed at check-in", placeholder: "e.g. A credit card for a USD 200 deposit per room, and each guest's passport." },
  { key: "guestCityTax", label: "City tax", placeholder: "e.g. Included in the rate. — or — USD 3 per person per night, paid at the property." },
  { key: "breakfast", label: "Breakfast", placeholder: "e.g. Included, 6:30–10:30 in the restaurant." },
  { key: "guestParking", label: "Parking", placeholder: "e.g. Underground garage, USD 25 a day — or none on site." },
  { key: "guestWifi", label: "Wi-Fi", placeholder: "e.g. Network ‘Oasis-Guest’, password on the card in the room." },
  { key: "cleaning", label: "Cleaning", placeholder: "e.g. Daily, towels every two days." },
  { key: "laundry", label: "Laundry", placeholder: "e.g. Washer and dryer in every apartment." },
  { key: "gym", label: "Gym", placeholder: "e.g. Level 2, 6:00–22:00." },
  { key: "publicTransport", label: "Getting around", placeholder: "e.g. Metro station 5 minutes’ walk." },
  { key: "guestRules", label: "House rules", placeholder: "e.g. No smoking. Quiet after 22:00. Rubbish to the chute on each floor." },
  { key: "guestEmergency", label: "Emergency contact at the property", placeholder: "e.g. Front desk +1 213 555 0100, 24 hours." },
  { key: "guestOther", label: "Anything else guests should know", placeholder: "" },
] as const;

export type GuestKey = (typeof guestFields)[number]["key"];
export type GuestInfo = Record<GuestKey, string | null>;

/** The ones a client page should not go without — flagged to the team while empty. */
export const essentialGuestKeys: GuestKey[] = ["checkInTime", "checkOutTime", "guestCheckIn", "guestPayment", "guestCityTax", "guestEmergency"];

export const guestSelect = Object.fromEntries(guestFields.map((field) => [field.key, true])) as Record<GuestKey, true>;

export const missingGuestInfo = (info: Partial<GuestInfo>) =>
  essentialGuestKeys.filter((key) => !info[key]?.trim()).map((key) => guestFields.find((field) => field.key === key)!.label);

/** A field the team added for one property (doc §6.8): its label, and what it says. */
export type CustomField = { id: string; label: string; value: string };

/** The property's custom fields as stored — anything malformed left out. */
export function customFields(json: unknown): CustomField[] {
  if (!Array.isArray(json)) return [];
  return json
    .filter((item): item is CustomField => Boolean(item) && typeof item === "object" && typeof (item as CustomField).id === "string" && typeof (item as CustomField).label === "string")
    .map((item) => ({ id: item.id, label: item.label, value: typeof item.value === "string" ? item.value : "" }));
}
