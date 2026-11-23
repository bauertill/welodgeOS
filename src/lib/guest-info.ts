/**
 * Property information for the client (doc §6.8, the owner 2026-11-23): what
 * guests need to know about a property, in the order the client's page shows
 * it. The first five are kept with the property's other details already; the
 * rest are its guest information.
 */
export const guestFields = [
  { key: "checkInTime", label: "Check-in from", placeholder: "15:00", short: true },
  { key: "checkOutTime", label: "Check-out by", placeholder: "11:00", short: true },
  { key: "guestCheckIn", label: "How to check in", placeholder: "Reception on the ground floor, open 24 hours. Keys are handed over by our team in the lobby." },
  { key: "guestPayment", label: "Needed at check-in", placeholder: "A credit card for a USD 200 deposit per room, and each guest's passport." },
  { key: "guestCityTax", label: "City tax", placeholder: "Included in the rate. — or — USD 3 per person per night, paid at the property." },
  { key: "breakfast", label: "Breakfast", placeholder: "Included, 6:30–10:30 in the restaurant." },
  { key: "guestParking", label: "Parking", placeholder: "Underground garage, USD 25 a day — or none on site." },
  { key: "guestWifi", label: "Wi-Fi", placeholder: "Network ‘Oasis-Guest’, password on the card in the room." },
  { key: "cleaning", label: "Cleaning", placeholder: "Daily, towels every two days." },
  { key: "laundry", label: "Laundry", placeholder: "Washer and dryer in every apartment." },
  { key: "gym", label: "Gym", placeholder: "Level 2, 6:00–22:00." },
  { key: "publicTransport", label: "Getting around", placeholder: "Metro station 5 minutes’ walk." },
  { key: "guestRules", label: "House rules", placeholder: "No smoking. Quiet after 22:00. Rubbish to the chute on each floor." },
  { key: "guestEmergency", label: "Emergency contact at the property", placeholder: "Front desk +1 213 555 0100, 24 hours." },
  { key: "guestOther", label: "Anything else guests should know", placeholder: "" },
] as const;

export type GuestKey = (typeof guestFields)[number]["key"];
export type GuestInfo = Record<GuestKey, string | null>;

/** The ones a client page should not go without — flagged to the team while empty. */
export const essentialGuestKeys: GuestKey[] = ["checkInTime", "checkOutTime", "guestCheckIn", "guestPayment", "guestCityTax", "guestEmergency"];

export const guestSelect = Object.fromEntries(guestFields.map((field) => [field.key, true])) as Record<GuestKey, true>;

export const missingGuestInfo = (info: Partial<GuestInfo>) =>
  essentialGuestKeys.filter((key) => !info[key]?.trim()).map((key) => guestFields.find((field) => field.key === key)!.label);
