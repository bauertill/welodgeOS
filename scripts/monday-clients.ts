/**
 * Bringing monday.com's clients and their people into WeLodge OS (doc §4.10).
 *
 * monday kept people, not companies: its Contacts board is a flat list of
 * people with no "works at" column. WeLodge OS starts from the company and
 * hangs its people on it. So this works the companies out backwards, from
 * three clues on each person:
 *
 *   1. the deal they are linked to on a Sales Requests board — its name is
 *      the client ("New Zealand Olympic Committee");
 *   2. their email's domain — everyone @tv2.dk is at the same company;
 *   3. failing both, they are left for a colleague to place by hand.
 *
 * People who share a deal or a domain end up at the same company. Vendors and
 * suppliers are left out (Brandon, 2026-11-12), and monday's tags are dropped.
 *
 * DRY RUN ONLY, for now: it reads monday and the database and writes a review
 * — nothing in the database is changed. Run:
 *
 *   MONDAY_API_TOKEN=… pnpm tsx scripts/monday-clients.ts <output folder>
 *
 * What it reads from monday is kept in the output folder; add --cached to
 * build the review again from that copy without asking monday.
 */
import { mkdirSync, readFileSync, writeFileSync, existsSync } from "node:fs";
import { join } from "node:path";

import { PrismaClient } from "../generated/prisma";
import type { ClientCategory, ContactType, Priority } from "../generated/prisma";

const CONTACTS_BOARD = 1165882712;
/** Boards whose deals name a client. The acquisitions boards are the hotel side, so not here. */
const DEAL_BOARDS = [1594200627, 1165882705];

// ── monday ───────────────────────────────────────────────────────────────────

type MondayColumnValue = { id: string; type: string; text: string | null; linked_item_ids?: string[]; display_value?: string };
type MondayItem = { id: string; name: string; updated_at: string; group: { title: string }; column_values: MondayColumnValue[] };
type MondayBoard = { id: string; name: string; columns: { id: string; title: string; type: string }[]; items: MondayItem[] };

const ITEM_FIELDS = `id name updated_at group { title }
  column_values { id type text
    ... on BoardRelationValue { linked_item_ids display_value }
    ... on MirrorValue { display_value } }`;

async function monday<T>(query: string, variables: Record<string, unknown>): Promise<T> {
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
    const message = body.errors?.map((e) => e.message).join("; ") ?? body.error_message ?? response.statusText;
    if (attempt >= 4) throw new Error(`monday: ${message}`);
    await new Promise((resolve) => setTimeout(resolve, 3000 * attempt)); // rate limits ease off
  }
}

async function fetchBoard(id: number): Promise<MondayBoard> {
  type First = { boards: { id: string; name: string; columns: MondayBoard["columns"]; items_page: { cursor: string | null; items: MondayItem[] } }[] };
  const first = await monday<First>(
    `query ($id: [ID!]) { boards(ids: $id) { id name columns { id title type } items_page(limit: 500) { cursor items { ${ITEM_FIELDS} } } } }`,
    { id: [id] },
  );
  const board = first.boards[0];
  if (!board) throw new Error(`monday board ${id} not found`);
  const items = [...board.items_page.items];
  let cursor = board.items_page.cursor;
  while (cursor) {
    const next = await monday<{ next_items_page: { cursor: string | null; items: MondayItem[] } }>(
      `query ($cursor: String!) { next_items_page(limit: 500, cursor: $cursor) { cursor items { ${ITEM_FIELDS} } } }`,
      { cursor },
    );
    items.push(...next.next_items_page.items);
    cursor = next.next_items_page.cursor;
  }
  console.log(`  ${board.name} (${id}): ${items.length} items`);
  return { id: board.id, name: board.name, columns: board.columns, items };
}

/** A column's value by its title, so a renamed column id does not matter. */
function byTitle(board: MondayBoard) {
  const ids = new Map(board.columns.map((c) => [c.title.trim().toLowerCase(), c.id]));
  return (item: MondayItem, title: string) => {
    const id = ids.get(title.toLowerCase());
    const value = id ? item.column_values.find((v) => v.id === id) : undefined;
    return value;
  };
}
const clean = (value: string | null | undefined) => (value?.replace(/\s+/g, " ").trim() || null);

// ── Mappings agreed with Brandon (2026-11-12) ────────────────────────────────

const CATEGORY: Record<string, ClientCategory> = {
  federation: "FEDERATION",
  noc: "FEDERATION",
  olympics: "FEDERATION",
  "football association": "FEDERATION",
  sponsor: "SPONSOR",
  broadcaster: "BROADCASTER",
  "press/other media": "MEDIA",
  "technical supplier": "TECHNICAL_SUPPLIER",
  "travel agency": "AGENCY",
  "sports marketing": "AGENCY",
  expo: "OTHER",
  "america's cup": "OTHER",
  other: "OTHER",
};
const TYPE: Record<string, ContactType> = { customer: "CUSTOMER", "qualified lead": "QUALIFIED_LEAD" };
const LEFT_OUT_TYPES = new Set(["vendor", "supplier"]);
const PRIORITY: Record<string, Priority> = { high: "HIGH", medium: "MEDIUM", low: "LOW" };

/** Mailboxes anyone can have — they say nothing about where someone works. */
const FREE_MAIL = new Set(
  `gmail.com googlemail.com hotmail.com hotmail.co.uk hotmail.fr hotmail.it hotmail.de outlook.com outlook.fr outlook.de live.com live.co.uk live.fr
  msn.com yahoo.com yahoo.co.uk yahoo.fr yahoo.it yahoo.de yahoo.es ymail.com icloud.com me.com mac.com aol.com gmx.de gmx.net gmx.com gmx.at gmx.ch
  web.de t-online.de protonmail.com proton.me pm.me yandex.ru yandex.com mail.ru qq.com 163.com 126.com btinternet.com orange.fr free.fr sfr.fr
  wanadoo.fr laposte.net libero.it tiscali.it virgilio.it alice.it bigpond.com bigpond.net.au optusnet.com.au comcast.net verizon.net att.net
  sbcglobal.net bluewin.ch hispeed.ch sunrise.ch telenet.be skynet.be ziggo.nl kpnmail.nl xs4all.nl seznam.cz centrum.cz wp.pl o2.pl interia.pl
  rediffmail.com zoho.com fastmail.com hey.com tutanota.com vip.qq.com inbox.lv`.split(/\s+/),
);
/** yahoo.com.au, hotmail.es and the like: the big webmail names under any country's domain. */
const isFreeMail = (domain: string) => FREE_MAIL.has(domain) || /^(yahoo|ymail|hotmail|outlook|live|msn|gmx|aol|icloud)\./.test(domain);

const norm = (name: string) =>
  name
    .toLowerCase()
    .normalize("NFD")
    .replace(/[̀-ͯ]/g, "")
    .replace(/&/g, " and ")
    .replace(/[^a-z0-9]+/g, " ")
    .trim();

function domainOf(email: string | null) {
  const domain = email?.split("@")[1]?.trim().toLowerCase().replace(/^mail\./, "");
  if (!domain || !domain.includes(".")) return null;
  return domain;
}

/** "tv2.dk" → "Tv2", "olympic.org.nz" → "Olympic" — a guess, and said to be one. */
function nameFromDomain(domain: string) {
  const parts = domain.split(".");
  const secondLevel = new Set(["co", "com", "org", "net", "gov", "ac", "or", "ne", "gob", "edu", "tur", "uk", "us", "eu", "mil", "int", "nom"]);
  let core = parts.length >= 3 && secondLevel.has(parts[parts.length - 2]!) ? parts[parts.length - 3]! : parts[parts.length - 2]!;
  core = core.replace(/[-_]/g, " ");
  const name = core.length <= 4 ? core.toUpperCase() : core.replace(/\b\w/g, (c) => c.toUpperCase());
  // A country's domain says which country: hockey.be is not hockey.ca.
  const tld = parts[parts.length - 1]!;
  if (tld.length === 2 && !VANITY_TLDS.has(tld)) {
    const country = regions.of(tld === "uk" ? "GB" : tld.toUpperCase());
    if (country && country.toUpperCase() !== tld.toUpperCase()) return `${name} ${country}`;
  }
  return name;
}
/** Two-letter domains used for their look, not their country. */
const VANITY_TLDS = new Set(["io", "tv", "co", "me", "ai", "fm", "gg", "to", "cc", "ws", "am"]);
const regions = new Intl.DisplayNames(["en"], { type: "region" });

type Suggestion = { name: string | null; category: ClientCategory | null; override: ClientCategory | null; confidence: string; note: string };
const CATEGORY_CODES: Record<string, true> = Object.fromEntries(
  ["BROADCASTER", "FEDERATION", "SPONSOR", "EVENT_ORGANISER", "AGENCY", "CORPORATE", "TECHNICAL_SUPPLIER", "MEDIA", "OTHER"].map((c) => [c, true]),
);

/** Which group of people a suggestion is for: its email domains, or its deal's name. */
const groupKey = (domains: string[], dealNames: string[]) => (domains.length ? [...domains].sort().join(" ") : `deal:${norm(dealNames[0] ?? "")}`);

/** A plain CSV reader: quoted fields, doubled quotes, commas and line breaks inside quotes. */
function parseCsv(text: string) {
  const rows: string[][] = [];
  let row: string[] = [];
  let field = "";
  let quoted = false;
  for (let i = 0; i < text.length; i++) {
    const ch = text[i]!;
    if (quoted) {
      if (ch === '"' && text[i + 1] === '"') (field += '"'), i++;
      else if (ch === '"') quoted = false;
      else field += ch;
    } else if (ch === '"') quoted = true;
    else if (ch === ",") row.push(field), (field = "");
    else if (ch === "\n" || ch === "\r") {
      if (ch === "\r" && text[i + 1] === "\n") i++;
      row.push(field), rows.push(row), (row = []), (field = "");
    } else field += ch;
  }
  if (field || row.length) row.push(field), rows.push(row);
  return rows;
}

// ── Building the companies ───────────────────────────────────────────────────

type Person = {
  mondayId: string;
  name: string;
  title: string | null;
  email: string | null;
  mobile: string | null;
  phone: string | null;
  comments: string | null;
  type: ContactType | null;
  typeLabel: string | null;
  priority: Priority | null;
  category: ClientCategory | null;
  categoryLabel: string | null;
  manager: string | null;
  group: string;
  updatedAt: string;
  deals: { id: string; name: string }[];
  domain: string | null;
  mergedFrom: string[];
};

type Contracting = Partial<Record<"tradeName" | "companyAddress" | "vatNumber" | "registrationNumber" | "signatory1Name" | "signatory1Designation" | "signatory2Name" | "signatory2Designation", string>>;

class Groups {
  private parent = new Map<string, string>();
  find(key: string): string {
    if (!this.parent.has(key)) this.parent.set(key, key);
    const up = this.parent.get(key)!;
    if (up === key) return key;
    const root = this.find(up);
    this.parent.set(key, root);
    return root;
  }
  join(a: string, b: string) {
    this.parent.set(this.find(a), this.find(b));
  }
}

const mostCommon = <T,>(values: T[]) => {
  const counts = new Map<T, number>();
  for (const value of values) counts.set(value, (counts.get(value) ?? 0) + 1);
  return [...counts.entries()].sort((a, b) => b[1] - a[1])[0]?.[0] ?? null;
};

async function main() {
  const args = process.argv.slice(2);
  const outDir = args.find((a) => !a.startsWith("--"));
  if (!outDir) throw new Error("Give an output folder: pnpm tsx scripts/monday-clients.ts <folder>");
  mkdirSync(outDir, { recursive: true });
  // Kept out of sight (a hidden folder): the raw copy is for the script, not for reading.
  mkdirSync(join(outDir, ".monday-copy"), { recursive: true });
  const cacheFile = join(outDir, ".monday-copy", "monday-boards.json");

  let boards: MondayBoard[];
  if (args.includes("--cached")) {
    if (!existsSync(cacheFile)) throw new Error(`No copy at ${cacheFile} — run once without --cached.`);
    boards = JSON.parse(readFileSync(cacheFile, "utf8")) as MondayBoard[];
    console.log("Using the copy of monday from last time.");
  } else {
    console.log("Reading monday…");
    boards = [];
    for (const id of [CONTACTS_BOARD, ...DEAL_BOARDS]) boards.push(await fetchBoard(id));
    writeFileSync(cacheFile, JSON.stringify(boards));
  }
  const suggestionsFile = args[args.indexOf("--suggestions") + 1];
  const suggestions = new Map<string, Suggestion>();
  if (args.includes("--suggestions") && suggestionsFile) {
    const [header, ...rows] = parseCsv(readFileSync(suggestionsFile, "utf8").replace(/^\uFEFF/, ""));
    const at = (name: string) => header!.indexOf(name);
    for (const row of rows) {
      const key = row[at("key")]?.trim();
      if (!key) continue;
      suggestions.set(key, {
        name: row[at("suggested name")]?.trim() || null,
        category: (row[at("suggested category")]?.trim().toUpperCase().replace(/[ /]+/g, "_") || null) as ClientCategory | null,
        override: (at("category override") >= 0 ? row[at("category override")]?.trim() || null : null) as ClientCategory | null,
        confidence: row[at("confidence")]?.trim().toLowerCase() ?? "",
        note: row[at("note")]?.trim() ?? "",
      });
    }
    console.log(`Suggestions read: ${suggestions.size}`);
  }
  const contactsBoard = boards.find((b) => b.id === String(CONTACTS_BOARD))!;
  const dealBoards = boards.filter((b) => b.id !== String(CONTACTS_BOARD));

  // Deals: their names, and any contracting details typed on them.
  const deals = new Map<string, { name: string; board: string; updatedAt: string; contracting: Contracting }>();
  for (const board of dealBoards) {
    const col = byTitle(board);
    for (const item of board.items) {
      const get = (title: string) => clean(col(item, title)?.text) ?? undefined;
      const contracting: Contracting = {
        tradeName: get("Client Trade Name"),
        companyAddress: get("Client Address"),
        vatNumber: get("Client Vat Number"),
        registrationNumber: get("Client Registration Number"),
        signatory1Name: get("Name of Signatory 1"),
        signatory1Designation: get("Designation of Signatory 1"),
        signatory2Name: get("Name of Signatory 2"),
        signatory2Designation: get("Designation of Signatory 2"),
      };
      deals.set(item.id, { name: item.name.trim(), board: board.name, updatedAt: item.updated_at, contracting });
    }
  }

  // People.
  const col = byTitle(contactsBoard);
  const leftOut: { name: string; email: string | null; type: string; mondayId: string }[] = [];
  const raw: Person[] = [];
  for (const item of contactsBoard.items) {
    const text = (title: string) => clean(col(item, title)?.text);
    const typeLabel = text("Type");
    if (typeLabel && LEFT_OUT_TYPES.has(typeLabel.toLowerCase())) {
      leftOut.push({ name: item.name, email: text("Email"), type: typeLabel, mondayId: item.id });
      continue;
    }
    const categoryLabel = text("Category");
    const linked = col(item, "Deals")?.linked_item_ids ?? [];
    const email = text("Email")?.replace(/^mailto:/i, "").split(/[\s,;]+/)[0]?.toLowerCase() ?? null;
    raw.push({
      mondayId: item.id,
      name: item.name.replace(/\s+/g, " ").trim(),
      title: text("Title"),
      email,
      mobile: text("Mobile"),
      phone: text("Phone"),
      comments: clean(col(item, "Comments")?.text) ? col(item, "Comments")!.text!.trim() : null,
      type: typeLabel ? (TYPE[typeLabel.toLowerCase()] ?? null) : null,
      typeLabel,
      priority: PRIORITY[(text("Priority") ?? "").toLowerCase()] ?? null,
      category: categoryLabel ? (CATEGORY[categoryLabel.split(",")[0]!.trim().toLowerCase()] ?? "OTHER") : null,
      categoryLabel,
      manager: ((name) => (name && name.toLowerCase() !== "admin" ? name : null))(text("Account Manager")?.split(",")[0]?.trim()),
      group: item.group.title,
      updatedAt: item.updated_at,
      deals: linked.flatMap((id) => (deals.has(id) ? [{ id, name: deals.get(id)!.name }] : [])),
      domain: domainOf(email),
      mergedFrom: [],
    });
  }

  // The same person twice (same email): one person, newest first, gaps filled from the others.
  const people: Person[] = [];
  const byEmail = new Map<string, Person>();
  const duplicates: { kept: string; email: string; dropped: string }[] = [];
  for (const person of [...raw].sort((a, b) => b.updatedAt.localeCompare(a.updatedAt))) {
    const kept = person.email ? byEmail.get(person.email) : undefined;
    if (!kept) {
      if (person.email) byEmail.set(person.email, person);
      people.push(person);
      continue;
    }
    for (const key of ["title", "mobile", "phone", "comments", "type", "priority", "category", "categoryLabel", "manager"] as const) {
      if (!kept[key] && person[key]) (kept as Record<string, unknown>)[key] = person[key];
    }
    for (const deal of person.deals) if (!kept.deals.some((d) => d.id === deal.id)) kept.deals.push(deal);
    kept.mergedFrom.push(person.mondayId);
    duplicates.push({ kept: `${kept.name} (${kept.mondayId})`, email: person.email!, dropped: `${person.name} (${person.mondayId})` });
  }

  // Join people who share a deal's client name or a work email domain.
  const groups = new Groups();
  const corporate = (p: Person) => (p.domain && !isFreeMail(p.domain) ? p.domain : null);
  for (const person of people) {
    const key = `p:${person.mondayId}`;
    groups.find(key);
    const dealNames = [...new Set(person.deals.map((d) => norm(d.name)))];
    // Someone on deals for several clients (an agency, say) must not glue those clients together.
    if (dealNames.length === 1) groups.join(key, `d:${dealNames[0]}`);
    const domain = corporate(person);
    if (domain) groups.join(key, `m:${domain}`);
  }

  const companies = new Map<string, Person[]>();
  for (const person of people) {
    const root = groups.find(`p:${person.mondayId}`);
    companies.set(root, [...(companies.get(root) ?? []), person]);
  }

  // What is in WeLodge OS already, to add to rather than duplicate.
  const db = new PrismaClient();
  const osClients = await db.client.findMany({ select: { id: true, name: true, shortName: true, contacts: { select: { email: true, name: true, mondayId: true } } } });
  await db.$disconnect();
  const osByName = new Map<string, (typeof osClients)[number]>();
  const osByDomain = new Map<string, (typeof osClients)[number]>();
  const osEmails = new Set<string>();
  const osMondayIds = new Set<string>();
  for (const client of osClients) {
    osByName.set(norm(client.name), client);
    if (client.shortName) osByName.set(norm(client.shortName), client);
    for (const contact of client.contacts) {
      if (contact.email) osEmails.add(contact.email.toLowerCase());
      if (contact.mondayId) osMondayIds.add(contact.mondayId);
      const domain = domainOf(contact.email);
      if (domain && !isFreeMail(domain)) osByDomain.set(domain, client);
    }
  }

  type CompanyRow = {
    company: string;
    nameFrom: string;
    inOS: string;
    category: string;
    categoryFrom: string;
    existingId: string | null;
    categoryCode: ClientCategory | null;
    contractingData: Contracting | null;
    key: string;
    accountManager: string;
    people: number;
    newPeople: number;
    tradeName: string;
    contracting: string;
    check: string;
    members: Person[];
  };
  const companyRows: CompanyRow[] = [];
  const unplaced: Person[] = [];
  const managerCounts = new Map<string, number>();

  // First name each group of people; then groups that end up with the same
  // name are one company (a name must be unique here, and the same name from
  // two email domains is nearly always the same organisation).
  type Named = {
    members: Person[];
    dealNames: string[];
    domains: string[];
    company: string;
    nameFrom: string;
    existing: (typeof osClients)[number] | null;
    suggestion: Suggestion | null;
  };
  const byName = new Map<string, Named[]>();
  const forSuggestions: (string | number)[][] = [];
  for (const members of companies.values()) {
    const dealNames = members.flatMap((m) => (new Set(m.deals.map((d) => norm(d.name))).size === 1 ? m.deals.map((d) => d.name) : []));
    const domains = [...new Set(members.map(corporate).filter((d): d is string => Boolean(d)))];
    if (!dealNames.length && !domains.length) {
      unplaced.push(...members);
      continue;
    }
    const key = groupKey(domains, dealNames);
    const suggestion = suggestions.get(key) ?? null;
    let company = dealNames.length ? mostCommon(dealNames)! : nameFromDomain(domains[0]!);
    let nameFrom = dealNames.length ? "monday deal" : `guessed from ${domains[0]}`;
    const guessExisting = osByName.get(norm(company)) ?? domains.map((d) => osByDomain.get(d)).find(Boolean) ?? null;
    if (!dealNames.length && !guessExisting && suggestion?.name) {
      company = suggestion.name;
      nameFrom = `suggested (${suggestion.confidence || "?"} confidence) — from ${domains.join(", ")}`;
    }
    const existing = guessExisting ?? osByName.get(norm(company)) ?? null;
    const hasCategory = members.some((m) => m.category);
    if (!existing && (!dealNames.length || !hasCategory)) {
      forSuggestions.push([
        key,
        dealNames.length ? "" : company,
        dealNames.length ? mostCommon(dealNames)! : "",
        dealNames.length ? "category" : hasCategory ? "name" : "name and category",
        members.length,
        [...new Set(members.map((m) => m.categoryLabel).filter(Boolean))].join(", "),
        [...new Set(members.map((m) => m.title).filter(Boolean))].slice(0, 4).join(" | "),
        members.map((m) => m.comments).filter(Boolean).join(" | ").replace(/\s+/g, " ").slice(0, 200),
      ]);
    }
    const named: Named = { members, dealNames, domains, company, nameFrom, existing, suggestion };
    const nameKey = norm(existing?.name ?? company);
    byName.set(nameKey, [...(byName.get(nameKey) ?? []), named]);
  }

  for (const parts of byName.values()) {
    // The part with a deal or a match in OS gives the name; a guess only when nothing better.
    const lead = parts.find((p) => p.existing) ?? parts.find((p) => p.nameFrom === "monday deal") ?? parts[0]!;
    const members = parts.flatMap((p) => p.members);
    const dealNames = parts.flatMap((p) => p.dealNames);
    const domains = [...new Set(parts.flatMap((p) => p.domains))];
    const { company, existing } = lead;
    const nameFrom = lead.nameFrom;
    const check: string[] = [];
    if (nameFrom.startsWith("guessed") && !existing) check.push("Name guessed from the email domain — give it its proper name");
    if (nameFrom.startsWith("suggested") && !existing) if (lead.suggestion?.confidence === "low") check.push("Low-confidence name — check it");
    if (lead.suggestion?.note) check.push(`Note: ${lead.suggestion.note}`);
    const distinct = [...new Set(dealNames.map(norm))];
    if (distinct.length > 1) check.push(`Deals with different names joined by email domain: ${[...new Set(dealNames)].join(" / ")}`);
    if (parts.length > 1) check.push(`Joined because the names match — same organisation? ${domains.join(", ")}`);
    else if (domains.length > 1) check.push(`Several email domains: ${domains.join(", ")}`);

    const suggestedCategory = parts.map((p) => p.suggestion?.category).find((c): c is ClientCategory => Boolean(c && c in CATEGORY_CODES)) ?? null;
    const mondayCategory = mostCommon(members.map((m) => m.category).filter(Boolean));
    // A category corrected by hand (Brandon, 2026-11-12: "change the categories that are mismatched") wins over monday's.
    const override = parts.map((p) => p.suggestion?.override).find((c): c is ClientCategory => Boolean(c && c in CATEGORY_CODES)) ?? null;
    const category = override ?? mondayCategory ?? suggestedCategory;
    const categoryLabels = [...new Set(members.map((m) => m.categoryLabel).filter(Boolean))];
    if (new Set(members.map((m) => m.category).filter(Boolean)).size > 1) check.push(`People in different categories: ${categoryLabels.join(", ")}`);
    if (!category) check.push("No category — choose one");
    const managerName = mostCommon(members.map((m) => m.manager).filter(Boolean));
    if (managerName) managerCounts.set(managerName, (managerCounts.get(managerName) ?? 0) + 1);

    // Contracting details from the newest deal that has any.
    // Only this company's own deals count — not those of someone who works on several clients' deals.
    const ownDeals = new Set(dealNames.map(norm));
    const contracting = members
      .flatMap((m) => m.deals.filter((d) => ownDeals.has(norm(d.name))).map((d) => deals.get(d.id)!))
      .filter((d) => Object.values(d.contracting).some(Boolean))
      .sort((a, b) => b.updatedAt.localeCompare(a.updatedAt))[0]?.contracting;

    const newPeople = members.filter((m) => !(m.email && osEmails.has(m.email)) && !osMondayIds.has(m.mondayId)).length;
    companyRows.push({
      company: existing?.name ?? company,
      nameFrom: existing ? `already in OS${existing.name !== company ? ` (monday: ${company})` : ""}` : nameFrom,
      inOS: existing ? "yes — people added to it" : "no — new client",
      category: category ? category.toLowerCase().replace(/_/g, " ") : "",
      categoryFrom: override ? `corrected (monday said ${categoryLabels.join(", ") || "nothing"})` : mondayCategory ? "monday" : suggestedCategory ? "suggested" : "",
      existingId: existing?.id ?? null,
      categoryCode: category,
      contractingData: contracting ?? null,
      key: groupKey(domains, dealNames),
      accountManager: managerName ?? "",
      people: members.length,
      newPeople,
      tradeName: contracting?.tradeName ?? "",
      contracting: contracting ? Object.entries(contracting).filter(([, v]) => v).map(([k]) => k).join(", ") : "",
      check: check.join(" · "),
      members,
    });
  }
  companyRows.sort((a, b) => a.company.localeCompare(b.company));

  // ── Writing the review ─────────────────────────────────────────────────────
  const csv = (rows: (string | number | null | undefined)[][]) =>
    "﻿" + rows.map((row) => row.map((cell) => `"${String(cell ?? "").replace(/"/g, '""')}"`).join(",")).join("\r\n");

  writeFileSync(
    join(outDir, "1 companies.csv"),
    csv([
      ["Company", "Where the name comes from", "Already in OS?", "Category", "Category from", "Account manager", "People", "New people", "Trade name", "Contracting details found", "Check"],
      ...companyRows.map((r) => [r.company, r.nameFrom, r.inOS, r.category, r.categoryFrom, r.accountManager, r.people, r.newPeople, r.tradeName, r.contracting, r.check]),
    ]),
  );
  const personRow = (company: string, how: string, p: Person) => [
    company,
    p.name,
    p.title,
    p.email,
    p.mobile,
    p.phone,
    p.type ? p.type.toLowerCase().replace(/_/g, " ") : (p.typeLabel ?? ""),
    p.priority?.toLowerCase(),
    p.manager,
    p.comments,
    how,
    (p.email && osEmails.has(p.email)) || osMondayIds.has(p.mondayId) ? "already in OS — skipped" : "",
    p.mergedFrom.length ? `merged with ${p.mergedFrom.length} duplicate(s)` : "",
    `https://welodge.monday.com/boards/${CONTACTS_BOARD}/pulses/${p.mondayId}`,
  ];
  const personHeader = ["Company", "Name", "Title", "Email", "Mobile", "Phone", "Type", "Priority", "Account manager", "Comments", "Placed by", "In OS", "Duplicates", "monday link"];
  writeFileSync(
    join(outDir, "2 people by company.csv"),
    csv([
      personHeader,
      ...companyRows.flatMap((r) =>
        r.members
          .sort((a, b) => a.name.localeCompare(b.name))
          .map((p) => personRow(r.company, p.deals.length && new Set(p.deals.map((d) => norm(d.name))).size === 1 ? `deal: ${p.deals[0]!.name}` : p.deals.length ? `email (on several deals: ${[...new Set(p.deals.map((d) => d.name))].join(" / ")})` : `email: ${p.domain}`, p)),
      ),
    ]),
  );
  writeFileSync(
    join(outDir, "3 to place by hand.csv"),
    csv([
      personHeader.map((h) => (h === "Company" ? "Company (fill in)" : h)),
      ...unplaced.sort((a, b) => a.name.localeCompare(b.name)).map((p) => personRow("", p.email ? `personal email (${p.domain})` : "no email, no deal", p)),
    ]),
  );
  writeFileSync(join(outDir, "4 left out - vendors and suppliers.csv"), csv([["Name", "Email", "monday type", "monday link"], ...leftOut.map((p) => [p.name, p.email, p.type, `https://welodge.monday.com/boards/${CONTACTS_BOARD}/pulses/${p.mondayId}`])]));
  writeFileSync(join(outDir, "5 duplicates merged.csv"), csv([["Kept", "Email", "Merged into it"], ...duplicates.map((d) => [d.kept, d.email, d.dropped])]));

  if (args.includes("--list-for-suggestions")) {
    writeFileSync(
      join(outDir, "for-suggestions.csv"),
      csv([["key", "guessed name", "deal name", "needs", "people", "monday categories", "titles", "comments"], ...forSuggestions]),
    );
    console.log(`for-suggestions.csv: ${forSuggestions.length} companies`);
  }
  const placed = companyRows.reduce((n, r) => n + r.people, 0);
  const summary = [
    `monday contacts read: ${contactsBoard.items.length}`,
    `Left out (vendors / suppliers): ${leftOut.length}`,
    `Duplicates merged (same email): ${duplicates.length}`,
    `People placed at a company: ${placed}`,
    `  by a deal: ${companyRows.filter((r) => r.nameFrom === "monday deal" || r.nameFrom.startsWith("already")).length} companies`,
    `  name suggested from email domain — high confidence: ${companyRows.filter((r) => r.nameFrom.startsWith("suggested (high")).length}, medium: ${companyRows.filter((r) => r.nameFrom.startsWith("suggested (medium")).length}, low: ${companyRows.filter((r) => r.nameFrom.startsWith("suggested (low")).length} companies`,
    `  name only guessed from email domain: ${companyRows.filter((r) => r.nameFrom.startsWith("guessed")).length} companies`,
    `People to place by hand: ${unplaced.length}`,
    `Companies: ${companyRows.length} (${companyRows.filter((r) => r.inOS.startsWith("no")).length} new, ${companyRows.filter((r) => r.inOS.startsWith("yes")).length} already in OS)`,
    `Companies with something to check: ${companyRows.filter((r) => r.check).length}`,
    `Companies with contracting details from a deal: ${companyRows.filter((r) => r.contracting).length}`,
    `Categories suggested (none in monday): ${companyRows.filter((r) => r.categoryFrom === "suggested").length}; still no category: ${companyRows.filter((r) => !r.category).length}`,
    `Account managers named in monday (matched to the team's logins at import; no login = left blank): ${[...managerCounts.entries()].sort((a, b) => b[1] - a[1]).map(([n, c]) => `${n} (${c} companies)`).join(", ")}`,
  ].join("\n");
  writeFileSync(join(outDir, "0 summary.txt"), summary + "\n");
  console.log("\n" + summary + `\n\nReview written to ${outDir}`);

  if (args.includes("--apply")) await apply(companyRows, outDir);
}

// ── The import ───────────────────────────────────────────────────────────────

/** monday's names for colleagues who are one person here (Brandon, 2026-11-12: "Volki and Volkhard are the same person"). */
const SAME_PERSON: string[][] = [["volki", "volkhard bauer", "volkhard"]];

type Row = {
  company: string;
  existingId: string | null;
  categoryCode: ClientCategory | null;
  contractingData: Contracting | null;
  key: string;
  accountManager: string;
  members: Person[];
};

/**
 * Write the reviewed companies and their people into the database DATABASE_URL
 * points at. Adds, never changes what is there: a client already here keeps
 * its details and only has blanks filled; a person already here (same monday
 * contact, or same email) is skipped. Safe to run again.
 */
async function apply(rows: Row[], outDir: string) {
  const url = new URL(process.env.DATABASE_URL ?? "");
  console.log(`\nImporting into ${url.hostname}${url.pathname} …`);
  const db = new PrismaClient();
  const users = await db.user.findMany({ select: { id: true, name: true, email: true } });
  const managers = new Map<string, string | null>();
  const managerId = (name: string | null) => {
    if (!name) return null;
    if (managers.has(name)) return managers.get(name)!;
    const n = norm(name.includes("@") ? name.split("@")[0]! : name);
    const names = SAME_PERSON.find((group) => group.includes(n)) ?? [n];
    const user = users.find((u) => {
      const local = norm(u.email?.split("@")[0] ?? "");
      const full = norm(u.name ?? "");
      return (name.includes("@") && u.email?.toLowerCase() === name.toLowerCase()) || names.some((x) => x === full || x === local || (x.includes(" ") && x === full));
    });
    managers.set(name, user?.id ?? null);
    return user?.id ?? null;
  };

  const known = await db.clientContact.findMany({ select: { email: true, mondayId: true } });
  const takenEmails = new Set(known.flatMap((c) => (c.email ? [c.email.toLowerCase()] : [])));
  const takenMonday = new Set(known.flatMap((c) => (c.mondayId ? [c.mondayId] : [])));
  const log: (string | number)[][] = [];
  let clientsAdded = 0;
  let clientsFilled = 0;
  let peopleAdded = 0;
  let peopleSkipped = 0;

  for (const row of rows) {
    let fresh: Person[] = [];
    let result: { clientId: string; action: string } | null = null;
    // A hosted database drops a connection now and then: try the company again.
    // Each company is all or nothing, and who is already there is asked afresh,
    // so a retry never adds anyone twice.
    for (let attempt = 1; !result; attempt++) {
      try {
        const already = await db.clientContact.findMany({
          where: {
            OR: [
              { mondayId: { in: row.members.map((p) => p.mondayId) } },
              { email: { in: row.members.flatMap((p) => (p.email ? [p.email] : [])), mode: "insensitive" } },
            ],
          },
          select: { mondayId: true, email: true },
        });
        for (const c of already) {
          if (c.mondayId) takenMonday.add(c.mondayId);
          if (c.email) takenEmails.add(c.email.toLowerCase());
        }
        fresh = row.members.filter((p) => !takenMonday.has(p.mondayId) && !(p.email && takenEmails.has(p.email)));
        result = await db.$transaction(async (tx) => {
      const found =
        (row.existingId && (await tx.client.findUnique({ where: { id: row.existingId } }))) ||
        (await tx.client.findFirst({ where: { name: { equals: row.company, mode: "insensitive" } } }));
      const companyManager = managerId(row.accountManager);
      let clientId: string;
      let action: string;
      if (!found) {
        const client = await tx.client.create({
          data: { name: row.company, category: row.categoryCode, accountManagerId: companyManager, mondayRef: row.key, ...(row.contractingData ?? {}) },
        });
        clientId = client.id;
        action = "added";
        await tx.auditEntry.create({ data: { entity: "Client", entityId: clientId, summary: "Added — imported from monday.com" } });
      } else {
        clientId = found.id;
        // Only blanks are filled: what the team has typed here stays.
        const fill: Record<string, unknown> = {};
        if (!found.category && row.categoryCode) fill.category = row.categoryCode;
        if (!found.accountManagerId && companyManager) fill.accountManagerId = companyManager;
        for (const [key, value] of Object.entries(row.contractingData ?? {})) {
          if (value && !(found as Record<string, unknown>)[key]) fill[key] = value;
        }
        action = Object.keys(fill).length ? "filled in" : "kept";
        if (Object.keys(fill).length) {
          await tx.client.update({ where: { id: clientId }, data: fill });
          await tx.auditEntry.create({
            data: { entity: "Client", entityId: clientId, summary: "Details filled in from monday.com", changes: Object.keys(fill).join(", ") },
          });
        }
      }
      if (fresh.length) {
        await tx.clientContact.createMany({
          data: fresh.map((p) => ({
            clientId,
            mondayId: p.mondayId,
            name: p.name,
            title: p.title,
            email: p.email,
            mobile: p.mobile,
            phone: p.phone,
            type: p.type,
            priority: p.priority,
            comments: p.comments,
            accountManagerId: managerId(p.manager),
          })),
        });
      }
      if (fresh.length) {
        await tx.auditEntry.create({
          data: {
            entity: "Client",
            entityId: clientId,
            summary: `${fresh.length === 1 ? "1 person" : `${fresh.length} people`} imported from monday.com`,
            changes: fresh.map((p) => p.name).join("\n"),
          },
        });
      }
      return { clientId, action };
    }, { maxWait: 20_000, timeout: 60_000 }); // a hosted database is a round trip away
      } catch (error) {
        if (attempt >= 6) throw error;
        console.log(`  ${row.company}: try ${attempt} failed (${String((error as Error).message).split("\n").filter(Boolean).pop()}) — trying again`);
        await new Promise((resolve) => setTimeout(resolve, 5000 * attempt));
      }
    }
    peopleSkipped += row.members.length - fresh.length;
    for (const p of fresh) {
      takenMonday.add(p.mondayId);
      if (p.email) takenEmails.add(p.email);
    }
    if (result.action === "added") clientsAdded++;
    if (result.action === "filled in") clientsFilled++;
    peopleAdded += fresh.length;
    log.push([row.company, result.action, fresh.length, row.members.length - fresh.length, result.clientId]);
  }
  await db.$disconnect();

  const csv = (data: (string | number)[][]) => "\uFEFF" + data.map((r) => r.map((c) => `"${String(c).replace(/"/g, '""')}"`).join(",")).join("\r\n");
  writeFileSync(join(outDir, `6 import log ${url.hostname}.csv`), csv([["Company", "Client", "People added", "People already there", "OS id"], ...log]));
  const matched = [...managers.entries()].map(([name, id]) => `${name} → ${id ? (users.find((u) => u.id === id)?.name ?? id) : "blank (no login)"}`);
  console.log(
    [
      `Clients added: ${clientsAdded}`,
      `Clients already there, blanks filled in: ${clientsFilled}`,
      `People added: ${peopleAdded}`,
      `People already there, skipped: ${peopleSkipped}`,
      `Account managers: ${matched.join("; ")}`,
    ].join("\n"),
  );
}

main().catch((error) => {
  console.error(error);
  process.exit(1);
});
