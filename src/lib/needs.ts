/**
 * The client's preferences (doc §4.11): breakfast, parking and how many
 * share a unit — said the same way
 * on the request, on the sourcing task and in the email to a hotel.
 */
/** "2 people per unit". */
export const peopleWords = (people: number | null | undefined) => (people ? `${people} ${people === 1 ? "person" : "people"} per unit` : null);

type Wishes = {
  breakfast: boolean | null;
  parking: boolean | null;
  parkingSpaces: number | null;
};

/** Each wish as a label and its value — only those the client said. */
export function wishes(request: Wishes): { label: string; value: string }[] {
  return [
    request.breakfast !== null ? { label: "Breakfast", value: request.breakfast ? "Yes" : "No" } : null,
    request.parking !== null
      ? {
          label: "Parking",
          value: request.parking ? (request.parkingSpaces ? `Yes — ${request.parkingSpaces} ${request.parkingSpaces === 1 ? "car" : "cars"}` : "Yes") : "No",
        }
      : null,
  ].filter((wish): wish is { label: string; value: string } => wish !== null);
}

/** The wishes as lines of text: "Breakfast: Yes". */
export const wishesInWords = (request: Wishes) => wishes(request).map((wish) => `${wish.label}: ${wish.value}`);

/**
 * A location of a request (doc §4.11) by what the team called it, or by the
 * places it is close to, or "Location 2".
 */
export function locationName(
  location: { name: string | null; closeTo?: { name: string }[]; points?: { label: string }[] },
  index: number,
) {
  if (location.name) return location.name;
  const near = [...(location.closeTo ?? []).map((place) => place.name), ...(location.points ?? []).map((point) => point.label)];
  return near.length ? `Near ${near.slice(0, 2).join(" & ")}` : `Location ${index + 1}`;
}
