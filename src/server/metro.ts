/**
 * Metro and light-rail lines with their stations around an event (doc §3.7),
 * from OpenStreetMap's Overpass service — several servers tried in turn, as
 * one is often busy. A line comes once, whichever direction is mapped more
 * fully; its path is thinned to about 25 m between points.
 */

const servers = [
  "https://overpass.private.coffee/api/interpreter",
  "https://overpass-api.de/api/interpreter",
  "https://overpass.kumi.systems/api/interpreter",
  "https://maps.mail.ru/osm/tools/overpass/api/interpreter",
];

type Box = { south: number; west: number; north: number; east: number };
type OsmGeometry = { lat: number; lon: number }[];
type OsmRelation = { type: "relation"; tags?: Record<string, string>; members: { type: string; role: string; geometry?: OsmGeometry }[] };
type OsmNode = { type: "node"; lat: number; lon: number; tags?: Record<string, string> };

/** All the servers asked at once; the first good answer wins (a busy one answers with an error, or not at all). */
async function overpass<T>(query: string): Promise<T[] | null> {
  const ask = async (server: string) => {
    const response = await fetch(server, {
      method: "POST",
      headers: { "Content-Type": "application/x-www-form-urlencoded", Accept: "application/json", "User-Agent": "WeLodgeOS (os@welodge.net)" },
      body: new URLSearchParams({ data: query }),
      signal: AbortSignal.timeout(120_000),
    });
    if (!response.ok) throw new Error(`${server}: ${response.status}`);
    const data = (await response.json()) as { elements?: T[]; remark?: string };
    if (!data.elements || (data.remark && /error|timeout|busy/i.test(data.remark))) throw new Error(`${server}: ${data.remark ?? "no elements"}`);
    return data.elements;
  };
  return Promise.any(servers.map(ask)).catch(() => null);
}

const metres = (a: [number, number], b: [number, number]) => {
  const rad = Math.PI / 180;
  const x = (b[1] - a[1]) * rad * Math.cos(((a[0] + b[0]) / 2) * rad);
  const y = (b[0] - a[0]) * rad;
  return Math.sqrt(x * x + y * y) * 6_371_000;
};

/** Every ~25 m kept, and the ends. */
function thin(points: [number, number][]) {
  const kept: [number, number][] = [];
  for (const [index, point] of points.entries()) {
    if (index === 0 || index === points.length - 1 || metres(kept[kept.length - 1]!, point) >= 25) kept.push(point);
  }
  return kept;
}

export type MetroLine = { name: string; ref: string | null; color: string; path: [number, number][][] };
export type MetroStation = { name: string; latitude: number; longitude: number; lines: string[] };

export async function fetchMetro(box: Box): Promise<{ lines: MetroLine[]; stations: MetroStation[] } | null> {
  const bbox = `${box.south},${box.west},${box.north},${box.east}`;
  const [relations, nodes] = await Promise.all([
    overpass<OsmRelation>(`[out:json][timeout:90];relation["type"="route"]["route"~"^(subway|light_rail)$"](${bbox});out geom;`),
    overpass<OsmNode>(`[out:json][timeout:60];node["railway"="station"]["station"~"^(subway|light_rail)$"](${bbox});out tags;`),
  ]);
  if (!relations || !nodes) return null;

  // One per line: the direction mapped with the most track.
  const byLine = new Map<string, { relation: OsmRelation; length: number }>();
  for (const relation of relations) {
    const key = relation.tags?.ref ?? relation.tags?.name ?? "";
    const length = relation.members.filter((member) => member.type === "way" && member.role === "").reduce((sum, member) => sum + (member.geometry?.length ?? 0), 0);
    if (!byLine.has(key) || byLine.get(key)!.length < length) byLine.set(key, { relation, length });
  }
  const lines: MetroLine[] = [...byLine.values()].map(({ relation }) => {
    const tags = relation.tags ?? {};
    const ref = tags.ref ?? null;
    return {
      name: ref ? `Metro ${ref} Line` : (tags.name ?? "Metro line").split(":")[0]!,
      ref,
      color: /^#[0-9a-fA-F]{6}$/.test(tags.colour ?? "") ? tags.colour!.toLowerCase() : "#1d5fa8",
      path: relation.members
        .filter((member) => member.type === "way" && member.role === "" && member.geometry?.length)
        .map((member) => thin(member.geometry!.map((point) => [Number(point.lat.toFixed(5)), Number(point.lon.toFixed(5))] as [number, number]))),
    };
  });

  // A station's lines: those whose track passes within 200 m of it.
  const stations: MetroStation[] = nodes
    .filter((node) => node.tags?.name)
    .map((node) => ({
      name: node.tags!.name!,
      latitude: node.lat,
      longitude: node.lon,
      lines: lines
        .filter((line) => line.ref && line.path.some((run) => run.some((point) => metres(point, [node.lat, node.lon]) < 200)))
        .map((line) => line.ref!)
        .sort(),
    }));
  // The same station mapped twice (one node per line) is one place.
  const seen = new Map<string, MetroStation>();
  for (const station of stations) {
    const known = seen.get(station.name.toLowerCase());
    if (known) known.lines = [...new Set([...known.lines, ...station.lines])].sort();
    else seen.set(station.name.toLowerCase(), station);
  }
  return { lines, stations: [...seen.values()] };
}
