import { distanceKm } from "~/lib/scouting";

/**
 * Whether a property being scouted is one we already have (doc §3.1) — told by
 * its name's own words, its street address, or where it is on the map, since
 * the same hotel is often typed two ways: "Residence Inn Burbank Downtown"
 * and "Residence Inn by Marriott Los Angeles Burbank/Downtown".
 */

/** Words that say what kind of place it is, not which one. */
const generic = new Set([
  "the", "by", "and", "a", "an", "of", "at", "on", "in", "de", "la", "le", "el",
  "hotel", "hotels", "inn", "suites", "suite", "resort", "residence", "residences", "apartments",
  "apartment", "aparthotel", "hostel", "lodge", "house", "collection", "autograph", "curio",
  "marriott", "hilton", "hyatt", "sheraton", "westin", "holiday", "express", "courtyard", "garden",
  "best", "western", "plus", "premier", "home2", "homewood", "hampton", "doubletree", "embassy",
  "springhill", "fairfield", "towneplace", "ihg", "accor", "novotel", "ibis", "mercure",
]);

/** The words of a name or address, without accents, punctuation or case. */
export function words(value: string) {
  return value
    .normalize("NFD")
    .replace(/[̀-ͯ]/g, "")
    .toLowerCase()
    .replace(/&/g, " and ")
    .split(/[^a-z0-9]+/)
    .filter(Boolean);
}

/** "401 S 1st St, Burbank" → "401 s 1st st": the street part, as words. */
const street = (address: string) => words(address.split(",")[0] ?? "").join(" ");

export type Candidate = { id: string; name: string; address: string | null; latitude: number | null; longitude: number | null };
export type Scouted = { name: string; address?: string | null; latitude?: number | null; longitude?: number | null };

/** Why a candidate looks like the one being scouted, in words; null when it does not. */
export function looksLike(scouted: Scouted, candidate: Candidate): string | null {
  const reasons: string[] = [];
  const a = new Set(words(scouted.name));
  const b = new Set(words(candidate.name));
  const shared = [...a].filter((word) => b.has(word));
  const distinctive = shared.filter((word) => !generic.has(word));
  const containment = shared.length / Math.max(1, Math.min(a.size, b.size));
  if (a.size && [...a].join(" ") === [...b].join(" ")) reasons.push("the same name");
  else if (containment >= 0.75 && distinctive.length >= 1 && shared.length >= 2) reasons.push("a very similar name");

  if (scouted.address?.trim() && candidate.address?.trim()) {
    const here = street(scouted.address);
    if (here.length >= 6 && here === street(candidate.address) && /\d/.test(here)) reasons.push("the same address");
  }
  if (scouted.latitude != null && scouted.longitude != null && candidate.latitude != null && candidate.longitude != null) {
    const metres = distanceKm(
      { latitude: scouted.latitude, longitude: scouted.longitude },
      { latitude: candidate.latitude, longitude: candidate.longitude },
    ) * 1000;
    if (metres <= 150) reasons.push(metres < 15 ? "the same spot on the map" : `${Math.round(metres)} m away on the map`);
  }
  return reasons.length ? reasons.join(", ") : null;
}
