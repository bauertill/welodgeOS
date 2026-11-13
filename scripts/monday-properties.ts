/**
 * Bringing monday.com's LA28 properties board into WeLodge OS (doc §3.9).
 *
 * monday's "(LA28) Accommodation Overview" board: one item per property, its
 * subitems the room categories, and the team's updates on each. Here a
 * property is kept once (the same on every event), with an entry on the LA28
 * board for what was agreed for LA28, its room categories, and the rates the
 * hotel quoted as a quotation — so the board's stage is worked out from them,
 * as for any property added by hand.
 *
 * The owner's decisions (2026-11-11 / 2026-11-12):
 *   - LA28 only; FIFA and the Club World Cup are left out.
 *   - Rating is stars only — monday's review scores are dropped.
 *   - A room type listed once per period ("ROH – Between Olympics &
 *     Paralympics") becomes one room category; each period's rate is a line
 *     of the quotation.
 *   - "Rates Received" properties with only monday's Daily Rate get a
 *     quotation from it, on a "Run of house" room category.
 *   - The updates written on each property in monday come across.
 *   - Tags are dropped.
 *
 * DRY RUN by default: reads monday and the database, writes a review, changes
 * nothing. --apply writes into the database DATABASE_URL points at — adding
 * only: a property already here keeps what the team typed and has blanks
 * filled. Safe to run again.
 *
 *   MONDAY_API_TOKEN=… pnpm tsx scripts/monday-properties.ts <folder> [--cached] [--apply]
 */
import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";

import { PrismaClient, type GroupColour, type PropertyType, type ScoutingStatus } from "../generated/prisma";

const BOARD = 5097705868;
const CONTACTS_BOARD = 1513734251;
const PROVIDERS_BOARD = 1940843663;
const IMPORTER_EMAIL = process.env.IMPORT_AS ?? "brandon@welodge.net";

// ── monday ───────────────────────────────────────────────────────────────────

type CV = { id: string; type: string; text: string | null; value: string | null; linked_item_ids?: string[]; display_value?: string };
type MUpdate = { id: string; text_body: string | null; created_at: string; creator: { name: string; email: string } | null; replies: { id: string; text_body: string | null; created_at: string; creator: { name: string; email: string } | null }[] };
type MItem = { id: string; name: string; updated_at: string; group?: { title: string }; column_values: CV[]; subitems?: MItem[]; updates?: MUpdate[] };
type MBoard = { columns: { id: string; title: string }[]; items: MItem[] };

async function monday<T>(query: string, variables: Record<string, unknown> = {}): Promise<T> {
  const token = process.env.MONDAY_API_TOKEN;
  if (!token) throw new Error("MONDAY_API_TOKEN is not set — or add --cached to use the copy from last time.");
  for (let attempt = 1; ; attempt++) {
    const response = await fetch("https://api.monday.com/v2", {
      method: "POST",
      headers: { "Content-Type": "application/json", Authorization: token, "API-Version": "2025-04" },
      body: JSON.stringify({ query, variables }),
    });
    const body = (await response.json()) as { data?: T; errors?: { message: string }[]; error_message?: string };
    if (response.ok && body.data && !body.errors) return body.data;
    if (attempt >= 5) throw new Error(`monday: ${body.errors?.map((e) => e.message).join("; ") ?? body.error_message ?? response.statusText}`);
    await new Promise((resolve) => setTimeout(resolve, 4000 * attempt));
  }
}

const CVF = `id type text value ... on BoardRelationValue { linked_item_ids display_value } ... on MirrorValue { display_value }`;
const UPD = `updates(limit: 100) { id text_body created_at creator { name email } replies { id text_body created_at creator { name email } } }`;

async function fetchBoard(id: number, withSubitems: boolean): Promise<MBoard> {
  const fields = `id name updated_at group { title } column_values { ${CVF} }${withSubitems ? ` subitems { id name updated_at column_values { ${CVF} } } ${UPD}` : ""}`;
  type Page = { cursor: string | null; items: MItem[] };
  const first = await monday<{ boards: { columns: MBoard["columns"]; items_page: Page }[] }>(
    `query ($id: [ID!]) { boards(ids: $id) { columns { id title } items_page(limit: ${withSubitems ? 50 : 500}) { cursor items { ${fields} } } } }`,
    { id: [id] },
  );
  const board = first.boards[0]!;
  const items = [...board.items_page.items];
  let cursor = board.items_page.cursor;
  while (cursor) {
    const next = await monday<{ next_items_page: Page }>(
      `query ($c: String!) { next_items_page(limit: ${withSubitems ? 50 : 500}, cursor: $c) { cursor items { ${fields} } } }`,
      { c: cursor },
    );
    items.push(...next.next_items_page.items);
    cursor = next.next_items_page.cursor;
  }
  console.log(`  board ${id}: ${items.length} items`);
  return { columns: board.columns, items };
}

function reader(board: MBoard) {
  const ids = new Map(board.columns.map((c) => [c.title.trim().toLowerCase(), c.id]));
  return (item: MItem, title: string) => {
    const id = ids.get(title.toLowerCase());
    return id ? item.column_values.find((v) => v.id === id) : undefined;
  };
}
const clean = (value: string | null | undefined) => {
  const text = value?.replace(/\r/g, "").trim();
  return text && text !== "{'ids': []}" ? text : null;
};

// ── Reading monday's values ──────────────────────────────────────────────────

/** The owner, 2026-11-11 and 2026-11-12. */
const TYPE: Record<string, PropertyType> = {
  hotel: "HOTEL",
  "budget hotel": "HOTEL",
  apartment: "APARTMENT",
  "apartment complex": "APARTMENT",
  "furnished apartments": "APARTMENT",
  "luxury apartment": "APARTMENT",
  aparthotel: "APARTHOTEL",
  motel: "MOTEL",
  hostel: "HOSTEL",
  "bed & breakfast": "BED_AND_BREAKFAST",
  "extended stay": "EXTENDED_STAY",
  "student housing": "STUDENT_HOUSING",
  others: "OTHER",
};

/** monday's hand-set status → the entry's status; the board's stage then follows from tasks and quotes. */
function statusOf(label: string | null): { status: ScoutingStatus; contactTask: boolean; contacted: boolean } {
  switch ((label ?? "").toLowerCase()) {
    case "to contact":
      return { status: "PROSPECT", contactTask: true, contacted: false };
    case "in progress":
    case "follow up":
    case "rates requested":
      return { status: "CONTACTED", contactTask: false, contacted: true };
    case "rates received":
      return { status: "CONTACTED", contactTask: false, contacted: true };
    case "not relevant":
    case "no availability":
    case "block not possible":
      return { status: "REJECTED", contactTask: false, contacted: false };
    case "oc contracted":
      return { status: "ORGANISER", contactTask: false, contacted: false };
    case "contracted":
      return { status: "CONTRACTED", contactTask: false, contacted: true };
    default:
      return { status: "PROSPECT", contactTask: false, contacted: false };
  }
}

const MONTHS: Record<string, number> = { jan: 0, feb: 1, mar: 2, apr: 3, may: 4, jun: 5, jul: 6, aug: 7, sep: 8, sept: 8, oct: 9, nov: 10, dec: 11 };
const utc = (y: number, m: number, d: number) => new Date(Date.UTC(y, m, d));

/**
 * "10-30 Jul", "Jul 12–30, 2028", "31 Jul - 14 Aug", "May 15 – Jul 31, 2028",
 * "10 Jul - 1 Aug", "Jul 10–25, 2028 (16 nights)" → check-in and check-out.
 * The second date is read as the check-out day. Anything else: null.
 */
function parsePeriod(text: string | null, year = 2028): { checkIn: Date; checkOut: Date } | null {
  if (!text) return null;
  const t = text.toLowerCase().replace(/[–—]/g, "-").replace(/\(.*?\)/g, " ").replace(/,/g, " ").replace(/\s+/g, " ").trim();
  const y = Number(/\b(20\d\d)\b/.exec(t)?.[1] ?? year);
  const mon = "(jan|feb|mar|apr|may|jun|jul|aug|sept?|oct|nov|dec)[a-z]*";
  const patterns: [RegExp, (m: RegExpExecArray) => [number, number, number, number]][] = [
    [new RegExp(`^(\\d{1,2}) ?- ?(\\d{1,2}) ${mon}`), (m) => [MONTHS[m[3]!]!, +m[1]!, MONTHS[m[3]!]!, +m[2]!]], // 10-30 Jul
    [new RegExp(`^${mon} (\\d{1,2}) ?- ?(\\d{1,2})\\b`), (m) => [MONTHS[m[1]!]!, +m[2]!, MONTHS[m[1]!]!, +m[3]!]], // Jul 12-30
    [new RegExp(`^(\\d{1,2}) ${mon} ?- ?(\\d{1,2}) ${mon}`), (m) => [MONTHS[m[2]!]!, +m[1]!, MONTHS[m[4]!]!, +m[3]!]], // 31 Jul - 14 Aug
    [new RegExp(`^${mon} (\\d{1,2}) ?- ?${mon} (\\d{1,2})`), (m) => [MONTHS[m[1]!]!, +m[2]!, MONTHS[m[3]!]!, +m[4]!]], // May 15 - Jul 31
  ];
  for (const [re, pick] of patterns) {
    const m = re.exec(t);
    if (!m) continue;
    const [m1, d1, m2, d2] = pick(m);
    const checkIn = utc(y, m1, d1);
    const checkOut = utc(y, m2, d2);
    if (checkOut > checkIn) return { checkIn, checkOut };
  }
  return null;
}

/** "ROH - Between Olympics & Paralympics", "Paralympics – King Room" → the room, and the period it names. */
function splitPeriod(name: string): { room: string; period: string | null } {
  const parts = name.split(/\s+[-–—]\s+/);
  if (parts.length < 2) return { room: name.trim(), period: null };
  const isPeriod = (p: string) => /olympic|paralympic|between/i.test(p);
  const period = parts.find(isPeriod) ?? null;
  if (!period) return { room: name.trim(), period: null };
  return { room: parts.filter((p) => p !== period).join(" - ").trim() || name.trim(), period: period.trim() };
}

const money = (text: string | null) => {
  const n = Number((text ?? "").replace(/[^0-9.]/g, ""));
  return Number.isFinite(n) && n > 0 ? Math.round(n * 100) : null;
};
const int = (text: string | null) => {
  const n = parseInt((text ?? "").replace(/[^0-9]/g, ""), 10);
  return Number.isFinite(n) ? n : null;
};
const url = (text: string | null) => /https?:\/\/\S+/.exec(text ?? "")?.[0] ?? null;
const norm = (s: string) => s.toLowerCase().normalize("NFD").replace(/[̀-ͯ]/g, "").replace(/&/g, " and ").replace(/[^a-z0-9]+/g, " ").trim();
const stripHtml = (s: string | null) => (s ?? "").replace(/\r/g, "").trim();

const GROUP_COLOURS: GroupColour[] = ["GREEN", "TEAL", "BLUE", "PURPLE", "YELLOW", "ORANGE", "PINK", "LIME", "RED", "GREY"];

// ── Planning ─────────────────────────────────────────────────────────────────

type RoomPlan = { name: string; units: number; beds: string | null; size: string | null; notes: string[]; mondayIds: string[] };
type LinePlan = { room: string; checkIn: Date; checkOut: Date; rooms: number; rateCents: number; note: string };
type PropertyPlan = {
  mondayId: string;
  name: string;
  group: string;
  statusLabel: string | null;
  plan: ReturnType<typeof statusOf>;
  property: Record<string, unknown>;
  amenities: string[];
  provider: string | null;
  contacts: { name: string; role: string | null; email: string | null; phone: string | null }[];
  entry: Record<string, unknown>;
  manager: string | null;
  rooms: RoomPlan[];
  quote: { lines: LinePlan[]; tot: number | null; otherTaxes: string | null; includes: string | null; fromDailyRate: boolean } | null;
  updates: { mondayId: string; author: string; authorEmail: string | null; at: Date; body: string }[];
  check: string[];
};

async function main() {
  const args = process.argv.slice(2);
  const outDir = args.find((a) => !a.startsWith("--"));
  if (!outDir) throw new Error("Give an output folder.");
  mkdirSync(outDir, { recursive: true });
  // Kept out of sight (a hidden folder): the raw copy is for the script, not for reading.
  mkdirSync(join(outDir, ".monday-copy"), { recursive: true });
  const cacheFile = join(outDir, ".monday-copy", "monday-la28.json");

  let data: { board: MBoard; contacts: MBoard; providers: MBoard };
  if (args.includes("--cached") && existsSync(cacheFile)) {
    data = JSON.parse(readFileSync(cacheFile, "utf8")) as typeof data;
    console.log("Using the copy of monday from last time.");
  } else {
    console.log("Reading monday…");
    data = { board: await fetchBoard(BOARD, true), contacts: await fetchBoard(CONTACTS_BOARD, false), providers: await fetchBoard(PROVIDERS_BOARD, false) };
    writeFileSync(cacheFile, JSON.stringify(data));
  }
  const col = reader(data.board);
  const subCol = (item: MItem, id: string) => item.column_values.find((v) => v.id === id);
  const contactCol = reader(data.contacts);
  const contactsById = new Map(data.contacts.items.map((c) => [c.id, c]));
  const providersById = new Map(data.providers.items.map((p) => [p.id, p.name.trim()]));

  const db = new PrismaClient();
  const event = await db.event.findFirst({ where: { name: { contains: "LA28", mode: "insensitive" } }, include: { periods: true } });
  if (!event) throw new Error("No LA28 event in this database.");
  const existing = await db.property.findMany({ select: { id: true, name: true, mondayId: true } });
  const byName = new Map(existing.map((p) => [norm(p.name), p]));
  const amenityRows = await db.amenity.findMany({ select: { id: true, key: true, label: true } });

  const plans: PropertyPlan[] = [];
  for (const item of data.board.items) {
    const text = (title: string) => clean(col(item, title)?.text);
    const check: string[] = [];
    const statusLabel = text("Status");
    const typeLabel = text("Property Type");
    const type = typeLabel ? TYPE[typeLabel.toLowerCase()] : undefined;
    if (!type) check.push(`Type "${typeLabel ?? "none"}" — set to Hotel`);
    // Stars only (the owner, 2026-11-11).
    const rating = text("Rating");
    const stars = rating && /^\d\s*\*$/.test(rating) ? Number(rating[0]) : null;
    // The map position from monday's location, when it has one.
    let lat: number | null = null;
    let lng: number | null = null;
    try {
      const loc = JSON.parse(col(item, "Location")?.value ?? "null") as { lat?: string | number; lng?: string | number } | null;
      if (loc?.lat && loc.lng) (lat = Number(loc.lat)), (lng = Number(loc.lng));
    } catch {
      /* no position */
    }
    const address = text("Location");
    if (!lat) check.push("No map position in monday — place it on the map");
    const ibanBic = text("IBAN + BIC");
    const bic = ibanBic ? /\b([A-Z]{6}[A-Z0-9]{2}(?:[A-Z0-9]{3})?)\b/.exec(ibanBic.replace(/IBAN|BIC/gi, " "))?.[1] ?? null : null;
    const iban = ibanBic ? ibanBic.replace(bic ?? "", "").replace(/IBAN|BIC|[:/,+]/gi, " ").replace(/\s+/g, " ").trim() || null : null;
    const hour = (title: string) => text(title);
    const otherAmenities = text("Other Amenities");
    const amenities = otherAmenities
      ? amenityRows.filter((a) => norm(otherAmenities).includes(norm(a.label)) || (a.key === "wifi" && /wi-?fi/i.test(otherAmenities))).map((a) => a.id)
      : [];
    const gym = text("Gym");

    const property: Record<string, unknown> = {
      name: item.name.trim(),
      type: type ?? "HOTEL",
      address,
      city: text("City") ?? (address ? address.split(",").slice(-3, -2)[0]?.trim() ?? null : null),
      country: address && /usa|united states/i.test(address) ? "United States" : "United States",
      latitude: lat,
      longitude: lng,
      stars,
      totalRooms: int(text("Total # of Rooms")),
      website: text("Website"),
      phone: text("General Phone"),
      generalEmail: text("General Email"),
      videoUrl: url(text("Video")),
      area: text("Area"),
      yearBuilt: int(text("Year it was built")),
      checkInTime: hour("CI time"),
      checkOutTime: hour("CO time"),
      breakfast: text("Breakfast"),
      cleaning: text("Cleaning"),
      laundry: text("Laundry"),
      gym,
      publicTransport: text("Public transport"),
      tradeName: text("Trade Name"),
      vatNumber: text("VAT Number"),
      registrationNumber: text("Registration Number"),
      iban,
      bic,
      signatoryName: text("Name of Signatory"),
      signatoryTitle: text("Designation of Signatory"),
      contractEmail: text("Email Address for Contract"),
    };

    // Contacts, from monday's Contact Details board.
    const contacts = (col(item, "Contact Person")?.linked_item_ids ?? []).flatMap((id) => {
      const c = contactsById.get(id);
      if (!c) return [];
      const ct = (title: string) => clean(contactCol(c, title)?.text);
      return [{ name: c.name.trim(), role: ct("Title") ?? ct("Position") ?? ct("Role"), email: ct("Email") ?? ct("Email Address"), phone: ct("Mobile") ?? ct("Phone") }];
    });
    const providerIds = col(item, "Provider")?.linked_item_ids ?? [];
    const provider = providerIds.map((id) => providersById.get(id)).find(Boolean) ?? null;

    // What was agreed for LA28.
    const comments = text("Comments");
    const proposed = text("Proposed Rates");
    const notes = [comments, proposed ? `Proposed rates (from monday):\n${proposed}` : null, otherAmenities && !amenities.length ? `Other amenities (from monday): ${otherAmenities}` : null]
      .filter(Boolean)
      .join("\n\n");
    const date = (title: string) => {
      const t = text(title);
      return t && /^\d{4}-\d{2}-\d{2}/.test(t) ? new Date(`${t.slice(0, 10)}T00:00:00Z`) : null;
    };
    const entry: Record<string, unknown> = {
      applicablePeriod: text("Applicable Period"),
      ratesInclude: text("Rates Include:") ?? text("Rates Include"),
      deposit: text("Deposit"),
      cancellationTerms: text("Cancellation Terms"),
      paymentTerms: text("Payment Terms"),
      blockExpiry: date("Block Expiration Date"),
      roomingListDeadline: date("Deadline for RL"),
      minimumStayNights: int(text("Minimum stay if applicable (with dates)")),
      notes: notes || null,
    };

    // Room categories: one per room type, each period's rate a quotation line.
    const roomsByName = new Map<string, RoomPlan>();
    const lines: LinePlan[] = [];
    let tot: number | null = null;
    const taxes = new Set<string>();
    const includes = new Set<string>();
    const entryPeriod = parsePeriod(text("Applicable Period"));
    const periodByLabel = (label: string | null) => {
      if (!label) return null;
      const l = label.toLowerCase();
      const pick = event.periods.find((p) =>
        /between/.test(l) ? /between|transition/i.test(p.name) : /paralympic/.test(l) ? /paralympic/i.test(p.name) : /olympic/.test(l) ? /olympic/i.test(p.name) && !/paralympic/i.test(p.name) : false,
      );
      return pick ? { checkIn: pick.startDate, checkOut: new Date(pick.endDate.getTime() + 86_400_000) } : null;
    };
    for (const sub of item.subitems ?? []) {
      const s = (id: string) => clean(subCol(sub, id)?.text);
      const { room, period } = splitPeriod(sub.name);
      if (/function room|meeting room|outside contract/i.test(sub.name)) check.push(`Subitem "${sub.name}" may not be a room type — check it`);
      const units = int(s("numeric_mkq15rmy")) ?? 0;
      const key = norm(room);
      const plan = roomsByName.get(key) ?? { name: room, units: 0, beds: null, size: null, notes: [], mondayIds: [] };
      plan.units = Math.max(plan.units, units);
      plan.beds ??= s("long_text30__1");
      plan.size ??= s("text_mm3zvm70");
      const note = s("text_mm3y4c8n");
      if (note) plan.notes.push(period ? `${period}: ${note}` : note);
      plan.mondayIds.push(sub.id);
      roomsByName.set(key, plan);
      const rate = money(s("numeric_mkq2csjs"));
      if (rate) {
        const subPeriodText = s("text_mm3y5z27");
        const when = parsePeriod(subPeriodText) ?? periodByLabel(period) ?? entryPeriod;
        if (!when) check.push(`"${sub.name}": no period to read ("${subPeriodText ?? ""}") — rate kept on the LA28 dates`);
        const dates = when ?? { checkIn: event.startDate, checkOut: event.endDate };
        if (/\/mo\b/i.test(s("text_mm3znvsy") ?? "")) check.push(`"${sub.name}": looks like a monthly price — check the rate`);
        lines.push({ room, ...dates, rooms: units || 1, rateCents: rate, note: subPeriodText ?? period ?? "" });
      }
      const t = s("numeric_mm3zsamk");
      if (t) tot = Math.round(Number(t) * 100);
      const other = s("text_mm3znbt0");
      if (other) taxes.add(other);
      const inc = s("text_mm3znvsy");
      if (inc) includes.add(inc);
    }
    let fromDailyRate = false;
    const daily = money(text("Daily Rate"));
    if (!lines.length && daily) {
      // Only monday's property-wide Daily Rate (the owner, 2026-11-12: those rates are the quote).
      fromDailyRate = true;
      const room = roomsByName.size === 1 ? [...roomsByName.values()][0]!.name : "Run of house";
      if (!roomsByName.size) roomsByName.set(norm(room), { name: room, units: 0, beds: null, size: null, notes: ["Made from monday's Daily Rate — the hotel's room types are still to be added."], mondayIds: [] });
      if (!entryPeriod) check.push(`Daily rate with no period to read ("${text("Applicable Period") ?? ""}") — kept on the LA28 dates`);
      const dates = entryPeriod ?? { checkIn: event.startDate, checkOut: event.endDate };
      lines.push({ room, ...dates, rooms: int(text("Total # of Rooms")) && roomsByName.size === 1 ? 1 : 1, rateCents: daily, note: "monday's Daily Rate" });
    }
    const quote = lines.length ? { lines, tot, otherTaxes: [...taxes].join("; ") || null, includes: [...includes].join("; ") || null, fromDailyRate } : null;
    const plan = statusOf(statusLabel);
    if (statusLabel?.toLowerCase() === "rates received" && !quote) check.push("Rates Received in monday, but no rate to bring — shows as Pending quote");

    const updates = (item.updates ?? []).map((u) => {
      const replies = u.replies
        .filter((r) => stripHtml(r.text_body))
        .map((r) => `↳ ${r.creator?.name ?? "Someone"}, ${r.created_at.slice(0, 10)}: ${stripHtml(r.text_body)}`);
      return {
        mondayId: u.id,
        author: u.creator?.name ?? "Someone",
        authorEmail: u.creator?.email ?? null,
        at: new Date(u.created_at),
        body: [stripHtml(u.text_body), ...replies].filter(Boolean).join("\n\n"),
      };
    }).filter((u) => u.body);

    plans.push({
      mondayId: item.id,
      name: item.name.trim(),
      group: item.group?.title ?? "",
      statusLabel,
      plan,
      property,
      amenities,
      provider,
      contacts,
      entry,
      manager: text("Account Manager")?.split(",")[0]?.trim() ?? null,
      rooms: [...roomsByName.values()],
      quote,
      updates,
      check,
    });
  }

  // ── The review ─────────────────────────────────────────────────────────────
  const csv = (rows: (string | number | null | undefined)[][]) =>
    "﻿" + rows.map((r) => r.map((c) => `"${String(c ?? "").replace(/"/g, '""')}"`).join(",")).join("\r\n");
  const fmt = (d: Date) => d.toISOString().slice(0, 10);
  writeFileSync(
    join(outDir, "1 properties.csv"),
    csv([
      ["Property", "Already in OS?", "monday status", "Becomes", "Group", "Type", "Stars", "Room types", "Quote lines", "Updates", "Contacts", "Provider", "Account manager", "Check"],
      ...plans.map((p) => [
        p.name,
        p.mondayId && existing.some((e) => e.mondayId === p.mondayId) ? "yes (imported before)" : byName.has(norm(p.name)) ? "yes — blanks filled" : "no — new",
        p.statusLabel ?? "",
        p.plan.contactTask ? "To be contacted (task made)" : p.plan.status === "CONTACTED" ? (p.quote ? "Quote received" : "Pending quote") : p.plan.status === "REJECTED" ? "Ruled out" : p.plan.status === "ORGANISER" ? "Organising committee" : p.plan.status === "CONTRACTED" ? "Contracted" : p.quote ? "Quote received" : "Prospect",
        p.group,
        String(p.property.type).toLowerCase().replace(/_/g, " "),
        (p.property.stars as number | null) ?? "",
        p.rooms.map((r) => `${r.name}${r.units ? ` (${r.units})` : ""}`).join("; "),
        p.quote ? p.quote.lines.length + (p.quote.fromDailyRate ? " (from Daily Rate)" : "") : "",
        p.updates.length,
        p.contacts.length,
        p.provider ?? "",
        p.manager ?? "",
        p.check.join(" · "),
      ]),
    ]),
  );
  writeFileSync(
    join(outDir, "2 rates.csv"),
    csv([
      ["Property", "Room type", "Check-in", "Check-out", "Rooms", "Rate per night (USD)", "monday's period / note"],
      ...plans.flatMap((p) => (p.quote?.lines ?? []).map((l) => [p.name, l.room, fmt(l.checkIn), fmt(l.checkOut), l.rooms, (l.rateCents / 100).toFixed(2), l.note])),
    ]),
  );
  const totals = {
    properties: plans.length,
    existing: plans.filter((p) => byName.has(norm(p.name))).length,
    rooms: plans.reduce((n, p) => n + p.rooms.length, 0),
    quotes: plans.filter((p) => p.quote).length,
    fromDaily: plans.filter((p) => p.quote?.fromDailyRate).length,
    updates: plans.reduce((n, p) => n + p.updates.length, 0),
    contacts: plans.reduce((n, p) => n + p.contacts.length, 0),
    tasks: plans.filter((p) => p.plan.contactTask).length,
    checks: plans.filter((p) => p.check.length).length,
  };
  const summary = [
    `Properties on monday's LA28 board: ${totals.properties} (${totals.existing} already in OS — blanks filled, nothing overwritten)`,
    `Room categories: ${totals.rooms}`,
    `Quotations: ${totals.quotes} (${totals.fromDaily} made from monday's Daily Rate)`,
    `Updates to bring across: ${totals.updates}`,
    `Contacts: ${totals.contacts}`,
    `Contact tasks to make ("To contact"): ${totals.tasks}`,
    `Properties with something to check: ${totals.checks}`,
    `Statuses: ${Object.entries(plans.reduce<Record<string, number>>((m, p) => ((m[p.statusLabel ?? "(blank)"] = (m[p.statusLabel ?? "(blank)"] ?? 0) + 1), m), {})).map(([k, v]) => `${k} ${v}`).join(", ")}`,
  ].join("\n");
  writeFileSync(join(outDir, "0 summary.txt"), summary + "\n");
  console.log("\n" + summary + `\n\nReview written to ${outDir}`);

  if (args.includes("--apply")) await apply(db, plans, event.id);
  await db.$disconnect();
}

// ── The import ───────────────────────────────────────────────────────────────

async function apply(db: PrismaClient, plans: PropertyPlan[], eventId: string) {
  const host = new URL(process.env.DATABASE_URL ?? "").hostname;
  console.log(`\nImporting into ${host} …`);
  const users = await db.user.findMany({ select: { id: true, name: true, email: true } });
  const importer = users.find((u) => u.email?.toLowerCase() === IMPORTER_EMAIL.toLowerCase());
  if (!importer) throw new Error(`No user ${IMPORTER_EMAIL} in this database to import as.`);
  const SAME: string[][] = [["volki", "volkhard bauer", "volkhard"]];
  const userFor = (name: string | null, email?: string | null) => {
    if (email) {
      const byEmail = users.find((u) => u.email?.toLowerCase() === email.toLowerCase());
      if (byEmail) return byEmail.id;
    }
    if (!name) return null;
    const n = norm(name.includes("@") ? name.split("@")[0]! : name);
    const names = SAME.find((g) => g.includes(n)) ?? [n];
    return users.find((u) => names.some((x) => x === norm(u.name ?? "") || x === norm(u.email?.split("@")[0] ?? "")))?.id ?? null;
  };
  const contactType = (await db.taskType.findFirst({ where: { name: { equals: "Hotel contact", mode: "insensitive" } } })) ?? (await db.taskType.create({ data: { name: "Hotel contact" } }));

  // monday's groups → the LA28 board's groups, by name.
  const groups = new Map((await db.propertyGroup.findMany({ where: { eventId } })).map((g) => [norm(g.name), g.id]));
  let position = groups.size;
  for (const name of [...new Set(plans.map((p) => p.group).filter(Boolean))]) {
    if (groups.has(norm(name))) continue;
    const g = await db.propertyGroup.create({ data: { eventId, name, colour: GROUP_COLOURS[position % GROUP_COLOURS.length]!, position: position++ } });
    groups.set(norm(name), g.id);
  }

  const stats = { added: 0, filled: 0, rooms: 0, quotes: 0, updates: 0, tasks: 0 };
  for (const p of plans) {
    for (let attempt = 1; ; attempt++) {
      try {
        await db.$transaction(
          async (tx) => {
            // The property: matched by monday id, then by name; filled, never overwritten.
            let property =
              (await tx.property.findUnique({ where: { mondayId: p.mondayId } })) ??
              (await tx.property.findFirst({ where: { name: { equals: p.name, mode: "insensitive" } } }));
            const providerId = p.provider
              ? ((await tx.provider.findUnique({ where: { name: p.provider } })) ?? (await tx.provider.create({ data: { name: p.provider } }))).id
              : null;
            const fresh = !property;
            if (!property) {
              property = await tx.property.create({
                data: { ...(p.property as object), name: p.name, type: p.property.type as PropertyType, mondayId: p.mondayId, providerId, scoutedById: importer.id, amenities: { connect: p.amenities.map((id) => ({ id })) } },
              });
              await tx.auditEntry.create({ data: { actorId: importer.id, entity: "Property", entityId: property.id, summary: "Added — imported from monday.com (LA28 board)" } });
              stats.added++;
            } else {
              const fill: Record<string, unknown> = {};
              for (const [key, value] of Object.entries(p.property)) {
                if (value !== null && value !== undefined && (property as Record<string, unknown>)[key] == null && key !== "name") fill[key] = value;
              }
              if (!property.mondayId) fill.mondayId = p.mondayId;
              if (!property.providerId && providerId) fill.providerId = providerId;
              if (Object.keys(fill).length) {
                await tx.property.update({ where: { id: property.id }, data: fill });
                await tx.auditEntry.create({ data: { actorId: importer.id, entity: "Property", entityId: property.id, summary: "Details filled in from monday.com", changes: Object.keys(fill).join(", ") } });
                stats.filled++;
              }
            }
            // Contacts not already there (by name).
            const known = await tx.propertyContact.findMany({ where: { propertyId: property.id }, select: { name: true } });
            for (const c of p.contacts) {
              if (known.some((k) => norm(k.name) === norm(c.name))) continue;
              await tx.propertyContact.create({ data: { ...c, propertyId: property.id } });
            }
            // Its LA28 entry.
            let entry = await tx.scoutingEntry.findUnique({ where: { eventId_propertyId: { eventId, propertyId: property.id } } });
            const managerId = userFor(p.manager);
            if (!entry) {
              entry = await tx.scoutingEntry.create({
                data: {
                  eventId,
                  propertyId: property.id,
                  status: p.plan.status,
                  groupId: groups.get(norm(p.group)) ?? null,
                  accountManagerId: managerId,
                  addedById: importer.id,
                  ...(Object.fromEntries(Object.entries(p.entry).filter(([, v]) => v !== null)) as object),
                },
              });
            } else {
              const fill: Record<string, unknown> = {};
              for (const [key, value] of Object.entries(p.entry)) if (value !== null && (entry as Record<string, unknown>)[key] == null) fill[key] = value;
              if (!entry.accountManagerId && managerId) fill.accountManagerId = managerId;
              if (!entry.groupId && groups.get(norm(p.group))) fill.groupId = groups.get(norm(p.group));
              if (Object.keys(fill).length) await tx.scoutingEntry.update({ where: { id: entry.id }, data: fill });
            }
            // Room categories — only for a property this import added, so the team's own are never doubled.
            const categories = new Map<string, string>();
            const have = await tx.roomCategory.findMany({ where: { propertyId: property.id }, select: { id: true, name: true } });
            for (const c of have) categories.set(norm(c.name), c.id);
            let order = have.length;
            for (const r of p.rooms) {
              if (categories.has(norm(r.name))) continue;
              const c = await tx.roomCategory.create({
                data: { propertyId: property.id, name: r.name, unitCount: r.units, bedConfiguration: r.beds, size: r.size, notes: r.notes.join("\n") || null, currency: "USD", sortOrder: order++ },
              });
              categories.set(norm(r.name), c.id);
              stats.rooms++;
            }
            // The quoted rates, as one quotation — once.
            if (p.quote) {
              const already = await tx.quotation.findFirst({ where: { scoutingEntryId: entry.id, name: { startsWith: "From monday" } } });
              if (!already) {
                await tx.quotation.create({
                  data: {
                    scoutingEntryId: entry.id,
                    name: p.quote.fromDailyRate ? "From monday — Daily Rate" : "From monday — LA28 rates",
                    status: p.plan.status === "CONTRACTED" ? "ACCEPTED" : "RECEIVED",
                    currency: "USD",
                    totBasisPoints: p.quote.tot,
                    otherTaxes: p.quote.otherTaxes,
                    rateIncludesOther: p.quote.includes,
                    notes: "Brought across from monday.com's LA28 board, 2026-11.",
                    addedById: importer.id,
                    lines: {
                      create: p.quote.lines.map((l, i) => ({ categoryId: categories.get(norm(l.room))!, checkIn: l.checkIn, checkOut: l.checkOut, rooms: l.rooms, rateCents: l.rateCents, position: i })),
                    },
                  },
                });
                stats.quotes++;
              }
            }
            // "To contact": its contact task, for the account manager — once.
            if (p.plan.contactTask && fresh) {
              await tx.task.create({
                data: {
                  title: `Contact ${p.name} — LA28`,
                  details: "Marked To contact on monday.com's LA28 board.",
                  status: "TODO",
                  typeId: contactType.id,
                  requestedById: importer.id,
                  createdById: importer.id,
                  eventId,
                  propertyId: property.id,
                  assignees: { connect: [{ id: managerId ?? importer.id }] },
                },
              });
              stats.tasks++;
            }
            // The team's updates, under their own names where they have a login.
            for (const u of p.updates) {
              if (await tx.update.findUnique({ where: { mondayId: u.mondayId } })) continue;
              const authorId = userFor(u.author, u.authorEmail);
              await tx.update.create({
                data: {
                  propertyId: property.id,
                  mondayId: u.mondayId,
                  authorId,
                  body: authorId ? u.body : `${u.author} (on monday): ${u.body}`,
                  happenedOn: new Date(`${u.at.toISOString().slice(0, 10)}T00:00:00Z`),
                  createdAt: u.at,
                },
              });
              stats.updates++;
            }
          },
          { maxWait: 20_000, timeout: 120_000 },
        );
        break;
      } catch (error) {
        if (attempt >= 6) throw error;
        console.log(`  ${p.name}: try ${attempt} failed (${String((error as Error).message).split("\n").filter(Boolean).pop()}) — trying again`);
        await new Promise((resolve) => setTimeout(resolve, 5000 * attempt));
      }
    }
  }
  console.log(
    `Properties added: ${stats.added}; existing ones filled in: ${stats.filled}; room categories: ${stats.rooms}; quotations: ${stats.quotes}; updates: ${stats.updates}; contact tasks: ${stats.tasks}`,
  );
}

main().catch((error) => {
  console.error(error);
  process.exit(1);
});
