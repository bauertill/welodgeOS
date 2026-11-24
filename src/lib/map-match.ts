/**
 * Is a point coming onto the map already there? (doc §3.7, the owner
 * 2026-11-24: "does it compare what is already there to avoid duplicating?")
 * A point is the same as one of ours when its name is — stars in front,
 * capitals and punctuation aside, or one name's main words (two at least) all
 * in the other's (three at least), within 5 km — or when it stands on the same spot: a
 * property within 75 m, another point within 40 m sharing a word of its name;
 * a property up to 300 m away counts when the names share their main words
 * ("Courtyard by Marriott Culver City" and "Courtyard Culver City").
 */

export type Known = { id: string; name: string; latitude: number | null; longitude: number | null };
export type Match = { id: string; name: string; by: "name" | "similar" | "near"; metres: number | null };

const STOP = new Set(["the", "a", "an", "and", "of", "at", "by", "in", "on", "la", "los", "angeles", "hotel", "hotels", "inn", "suites", "suite", "resort", "station", "apartments", "apartment", "residence", "house", "an", "ihg", "marriott", "hilton", "hyatt", "airport", "downtown", "fka"]);

/** "5* The Langham, Pasadena" → "the langham pasadena". */
export const plainName = (name: string) =>
  name
    .normalize("NFKD")
    .replace(/[̀-ͯ]/g, "")
    .replace(/^\s*\d(?:[.,]\d)?\s*\*\s*/, "")
    .toLowerCase()
    .replace(/&/g, " and ")
    .replace(/[^a-z0-9]+/g, " ")
    .trim();

/**
 * The words of a name that tell it apart — not "hotel", "the", "suites", nor
 * any in `common`: words found in many names around (a town — "Santa
 * Monica", "Pasadena" — or a chain), which say where or whose, not which.
 */
export const mainWords = (name: string, common?: Set<string>) =>
  new Set(plainName(name).split(" ").filter((word) => word.length > 2 && !STOP.has(word) && !common?.has(word)));

/** Words in at least `times` of the names given — to leave out of `mainWords` (see there). */
export function commonWords(names: string[], times = 3) {
  const count = new Map<string, number>();
  for (const name of new Set(names.map(plainName))) for (const word of new Set(name.split(" "))) count.set(word, (count.get(word) ?? 0) + 1);
  return new Set([...count].filter(([, n]) => n >= times).map(([word]) => word));
}

/** Metres between two points on the Earth. */
export function metresBetween(a: { latitude: number; longitude: number }, b: { latitude: number; longitude: number }) {
  const rad = Math.PI / 180;
  const dLat = (b.latitude - a.latitude) * rad;
  const dLng = (b.longitude - a.longitude) * rad;
  const h = Math.sin(dLat / 2) ** 2 + Math.cos(a.latitude * rad) * Math.cos(b.latitude * rad) * Math.sin(dLng / 2) ** 2;
  return 2 * 6_371_000 * Math.asin(Math.sqrt(h));
}

const shared = (a: Set<string>, b: Set<string>) => [...a].filter((word) => b.has(word)).length;

/**
 * The first of `known` the point is the same as, if any. `kind` sets how near
 * counts: a property is a building, a point may be a station beside a venue.
 */
export function findMatch(point: { name: string; latitude: number | null; longitude: number | null }, known: Known[], kind: "property" | "point", only?: "name", common?: Set<string>): Match | null {
  const name = plainName(point.name);
  const words = mainWords(point.name, common);
  let best: (Match & { score: number }) | null = null;
  for (const one of known) {
    const metres =
      point.latitude !== null && point.longitude !== null && one.latitude !== null && one.longitude !== null
        ? metresBetween({ latitude: point.latitude, longitude: point.longitude }, { latitude: one.latitude, longitude: one.longitude })
        : null;
    if (name && plainName(one.name) === name) return { id: one.id, name: one.name, by: "name", metres: metres === null ? null : Math.round(metres) };
    // A name inside the other — "Courtyard Culver City" in "Courtyard by Marriott Culver City Los Angeles" — three main words at least, as two are often a town ("Long Beach").
    const theirs = mainWords(one.name, common);
    const [small, large] = theirs.size <= words.size ? [theirs, words] : [words, theirs];
    if (small.size >= (common ? 2 : 3) && [...small].every((word) => large.has(word)) && (metres === null || metres <= 5000)) {
      return { id: one.id, name: one.name, by: "similar", metres: metres === null ? null : Math.round(metres) };
    }
    if (metres === null || only === "name") continue;
    const both = shared(words, mainWords(one.name, common));
    const near =
      kind === "property"
        ? metres <= 40 || (metres <= 75 && both >= 1) || (metres <= 300 && both >= 2)
        : metres <= 40 && both > 0;
    if (near && (!best || metres < best.score)) best = { id: one.id, name: one.name, by: "near", metres: Math.round(metres), score: metres };
  }
  return best ? { id: best.id, name: best.name, by: best.by, metres: best.metres } : null;
}
