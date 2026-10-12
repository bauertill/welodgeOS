import type { CleaningWanted } from "generated/prisma";

/**
 * What the client wants with the rooms (doc §4.11): breakfast, cleaning,
 * parking, how many share a unit and what else matters — said the same way
 * on the request, on the sourcing task and in the email to a hotel.
 */
export const cleaningWantedLabels: Record<CleaningWanted, string> = {
  DAILY: "Daily",
  EVERY_FEW_DAYS: "Every few days",
  WEEKLY: "Weekly",
  NONE: "Not needed",
};
export const cleaningWantedOrder: CleaningWanted[] = ["DAILY", "EVERY_FEW_DAYS", "WEEKLY", "NONE"];

/** "2 people per unit". */
export const peopleWords = (people: number | null | undefined) => (people ? `${people} ${people === 1 ? "person" : "people"} per unit` : null);

type Wishes = {
  breakfast: boolean | null;
  cleaning: CleaningWanted | null;
  parking: boolean | null;
  parkingSpaces: number | null;
  mustHaves: { label: string }[];
};

/** Each wish as a label and its value — only those the client said. */
export function wishes(request: Wishes): { label: string; value: string }[] {
  return [
    request.breakfast !== null ? { label: "Breakfast", value: request.breakfast ? "Yes" : "No" } : null,
    request.cleaning ? { label: "Cleaning", value: cleaningWantedLabels[request.cleaning] } : null,
    request.parking !== null
      ? {
          label: "Parking",
          value: request.parking ? (request.parkingSpaces ? `Yes — ${request.parkingSpaces} ${request.parkingSpaces === 1 ? "car" : "cars"}` : "Yes") : "No",
        }
      : null,
    request.mustHaves.length ? { label: "Also important", value: request.mustHaves.map((amenity) => amenity.label).join(", ") } : null,
  ].filter((wish): wish is { label: string; value: string } => wish !== null);
}

/** The wishes as lines of text: "Breakfast: Yes". */
export const wishesInWords = (request: Wishes) => wishes(request).map((wish) => `${wish.label}: ${wish.value}`);
