/**
 * The icon a place shows on the map (doc §3.7, 2026-10-13): its sport, read
 * from its name or notes — the first sport mentioned, so a squash court gets
 * a racket and the Coliseum its ceremonies — or else what kind of place it
 * is: a broadcast centre, an airport, a village, a stadium.
 */
const sports: [RegExp, string][] = [
  [/table tennis|ping.?pong/i, "🏓"],
  [/badminton/i, "🏸"],
  [/squash|tennis|padel|pickleball/i, "🎾"],
  [/water polo/i, "🤽"],
  [/swim|aquatic|diving/i, "🏊"],
  [/basketball/i, "🏀"],
  [/volleyball/i, "🏐"],
  [/handball|goalball/i, "🤾"],
  [/flag football|american football/i, "🏈"],
  [/football|soccer/i, "⚽"],
  [/rugby/i, "🏉"],
  [/baseball|softball/i, "⚾"],
  [/cricket/i, "🏏"],
  [/lacrosse/i, "🥍"],
  [/hockey/i, "🏑"],
  [/golf/i, "⛳"],
  [/fencing/i, "🤺"],
  [/boxing/i, "🥊"],
  [/wrestling/i, "🤼"],
  [/judo|taekwondo|karate|martial/i, "🥋"],
  [/weightlift/i, "🏋️"],
  [/gymnast|trampoline/i, "🤸"],
  [/climb/i, "🧗"],
  [/skateboard/i, "🛹"],
  [/surf|windsurf|kite/i, "🏄"],
  [/sailing|regatta/i, "⛵"],
  [/rowing/i, "🚣"],
  [/canoe|kayak/i, "🛶"],
  [/cycl|bmx|velodrome|mountain bike|\bmtb\b/i, "🚴"],
  [/equestrian/i, "🏇"],
  [/archery/i, "🏹"],
  [/shooting/i, "🎯"],
  [/athletic|marathon|triathlon|pentathlon/i, "🏃"],
  [/ceremon/i, "🎆"],
  [/boccia/i, "🔴"],
];

const kinds: [RegExp, string][] = [
  [/\bibc\b|\bobs\b|broadcast|media|press|\btv\b|studio/i, "📺"],
  [/airport/i, "✈️"],
  [/station|metro|\brail/i, "🚉"],
  [/village/i, "🏘️"],
  [/universit|college|campus/i, "🎓"],
  [/\bhouses?\b|nation house/i, "🏠"],
  [/hotel/i, "🏨"],
  [/stadium|arena|venue|center|centre|court|field|park|theater|theatre|hall/i, "🏟️"],
];

const byCategory: Record<string, string> = { VENUE: "🏟️", TRAIN_STATION: "🚉", AIRPORT: "✈️", OTHER: "📍" };

/** The match that comes earliest in the text, or null. */
function firstIn(text: string, list: [RegExp, string][]) {
  let best: { at: number; icon: string } | null = null;
  for (const [words, icon] of list) {
    const found = words.exec(text);
    if (found && (!best || found.index < best.at)) best = { at: found.index, icon };
  }
  return best?.icon ?? null;
}

export function placeIcon(place: { name: string; notes?: string | null; layerName?: string | null; category?: string }) {
  if (place.category === "TRAIN_STATION") return "🚉";
  return (
    firstIn(place.name, sports) ??
    firstIn(place.notes ?? "", sports) ??
    firstIn(place.name, kinds) ??
    firstIn(place.notes ?? "", kinds) ??
    firstIn(place.layerName ?? "", kinds) ??
    byCategory[place.category ?? "OTHER"] ??
    "📍"
  );
}
