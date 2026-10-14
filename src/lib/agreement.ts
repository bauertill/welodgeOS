import { nightsBetween } from "~/lib/dates";
import { formatMoney } from "~/lib/format";

/**
 * Filling the framework agreement (doc §4.11, 2026-10-14): its {{fields}}
 * from the client's contracting details, the offer and the event, and reading
 * the result back as a document. Anything missing is written as
 * [missing: …], highlighted on screen, so it is seen before the agreement goes.
 */

const missing = (what: string) => `[missing: ${what}]`;

/**
 * Who signs for We Lodge (the owner, 2026-10-14): Volkhard Bauer, CEO, for an
 * event in the United States; Raphael Angelo Dornier for every other.
 */
const SIGNATORIES = {
  world: {
    represented:
      "herein represented by Raphael Angelo Dornier, in his capacity as President of the Board of Directors, he being duly authorised hereto by resolution of the directors of We Lodge",
    signature: "@sign For and on behalf of We Lodge AG by Raphael Angelo Dornier | in his capacity as President of the Board of Directors of We Lodge AG, he being duly authorised hereto.",
  },
  us: {
    represented: "herein represented by Volkhard Bauer, CEO, being duly authorised hereto by resolution of the directors of We Lodge",
    signature: "@sign For and on behalf of We Lodge AG by Volkhard Bauer | CEO of We Lodge AG, duly authorised hereto.",
  },
};
const inUnitedStates = (country: string | null) => /^(us|usa|u\.s\.a?\.?|united states( of america)?)$/i.test(country?.trim() ?? "");

export type AgreementData = {
  client: { name: string | null; address: string | null; signatories: { name: string; designation: string | null }[] };
  currency: string;
  event: { name: string; startDate: Date; endDate: Date; country: string | null };
  lines: { property: string; propertyAddress: string | null; room: string; rooms: number; checkIn: Date; checkOut: Date; rateCents: number }[];
  payments: { onSignature: boolean; dueOn: Date | null; percentBasisPoints: number }[];
  cancellations: { kind: string; cutoffOn: Date; percentBasisPoints: number | null; feeBasisPoints: number | null; remarks: string | null }[];
  inclusions: string[];
  conditions: string[];
  validUntil: Date;
};


/** What a currency is, as the definitions put it. */
const currencies: Record<string, string> = {
  USD: "the United States Dollar, the lawful currency of the United States of America",
  EUR: "the Euro, the lawful currency of the member states of the euro area",
  CHF: "the Swiss Franc, the lawful currency of Switzerland",
  GBP: "the Pound Sterling, the lawful currency of the United Kingdom",
};

/**
 * Where clients pay, by currency. Only USD for now (the owner, 2026-10-14);
 * each event is to ask for its own account (docs/todos.md).
 */
const bankAccounts: Record<string, string[]> = {
  USD: ["**Account Name:** Current Account USD", "**Account Number:** 786158761406", "**IBAN:** CH43 0078 7786 1587 6140 6", "**BIC (SWIFT):** KBZGCH22XXX"],
};

const ones = ["", "One", "Two", "Three", "Four", "Five", "Six", "Seven", "Eight", "Nine", "Ten", "Eleven", "Twelve", "Thirteen", "Fourteen", "Fifteen", "Sixteen", "Seventeen", "Eighteen", "Nineteen"];
const tens = ["", "", "Twenty", "Thirty", "Forty", "Fifty", "Sixty", "Seventy", "Eighty", "Ninety"];

/** 35 → "Thirty Five", 100 → "One Hundred", 12.5 → "Twelve point Five". */
export function numberInWords(value: number): string {
  if (!Number.isInteger(value)) {
    const [whole, fraction] = String(value).split(".");
    return `${numberInWords(Number(whole))} point ${[...fraction!].map((digit) => (digit === "0" ? "Zero" : ones[Number(digit)])).join(" ")}`;
  }
  if (value === 0) return "Zero";
  if (value === 100) return "One Hundred";
  if (value < 20) return ones[value]!;
  return [tens[Math.floor(value / 10)], ones[value % 10]].filter(Boolean).join(" ");
}

const share = (basisPoints: number) => {
  const value = basisPoints / 100;
  return `${value}% (${numberInWords(value)} per centum)`;
};

const months = ["January", "February", "March", "April", "May", "June", "July", "August", "September", "October", "November", "December"];
const ordinal = (day: number) => `${day}${day % 10 === 1 && day !== 11 ? "st" : day % 10 === 2 && day !== 12 ? "nd" : day % 10 === 3 && day !== 13 ? "rd" : "th"}`;
/** "the 15th of June 2027" — the agreement's way with dates. */
const longDate = (date: Date) => `the ${ordinal(date.getUTCDate())} of ${months[date.getUTCMonth()]} ${date.getUTCFullYear()}`;
/** "21 October 2026". */
const plainDate = (date: Date) => `${date.getUTCDate()} ${months[date.getUTCMonth()]} ${date.getUTCFullYear()}`;

/** The payment schedule, numbered under the clause it sits in. */
function paymentLines(data: AgreementData, under: string) {
  if (!data.payments.length) return [`${under}.1 ${missing("the payment schedule — add the payments to the offer")}`];
  return data.payments.map((payment, index) => {
    const when = payment.onSignature ? "on signature of this Agreement" : `on or before ${longDate(payment.dueOn!)}`;
    const end = index === data.payments.length - 1 ? "." : index === data.payments.length - 2 ? "; and" : ";";
    return `${under}.${index + 1} An amount equal to ${share(payment.percentBasisPoints)} of the total amount referred to in all applicable Cost Analysis (from time to time) ${when}${end}`;
  });
}

function cancellationText(cut: AgreementData["cancellations"][number]) {
  const by = `up to and including ${plainDate(cut.cutoffOn)}`;
  const said =
    cut.feeBasisPoints !== null
      ? `From ${plainDate(cut.cutoffOn)}, a cancellation fee of ${share(cut.feeBasisPoints)} of the full value of the Booking applies.`
      : cut.kind === "ATTRITION"
        ? `Up to ${cut.percentBasisPoints !== null ? share(cut.percentBasisPoints) : "an agreed share"} of the rooms may be reduced free of charge ${by}.`
        : cut.kind === "RELEASE"
          ? `Up to ${cut.percentBasisPoints !== null ? share(cut.percentBasisPoints) : "an agreed share"} of the rooms may be released free of charge ${by}.`
          : `${cut.percentBasisPoints !== null ? `${share(cut.percentBasisPoints)}, ` : ""}${by}.`;
  return cut.remarks ? `${said} ${cut.remarks}` : said;
}

function scheduleTwo(data: AgreementData) {
  const properties = [...new Map(data.lines.map((line) => [line.property, line.propertyAddress])).entries()];
  const parts: [string, string[]][] = [
    ["Accommodation:", properties.map(([name, address]) => `${name} - ${address ?? missing(`the address of ${name}`)}`)],
    ["Number of Units and Unit Type: See Schedule 2.1 attached hereto; and", []],
    ["Arrival Date and Departure Date: See Schedule 2.1 attached hereto; and", []],
    [`Rate Per Room Per Night: See Schedule 2.1 attached hereto${data.inclusions.length ? ", which includes the following:" : "."}`, data.inclusions],
    ["Payment Terms:", paymentLines(data, "x").map((line) => line.replace(/^x\.\d+ /, ""))],
    ["Cancellation Policy:", data.cancellations.length ? data.cancellations.map(cancellationText) : ["As set out in clause 8 of this Agreement."]],
    ...(data.conditions.length ? ([["Special Conditions:", data.conditions]] as [string, string[]][]) : []),
    ["Validity of this offer:", [`This offer is valid until ${plainDate(data.validUntil)}. The rooms are held for the Client until then.`]],
  ];
  return parts.flatMap(([head, items], index) => [`${index + 1}. ${head}`, ...items.map((item, i) => `${index + 1}.${i + 1} ${item}`)]);
}

function scheduleTwoOne(data: AgreementData) {
  const rows = data.lines.map((line) => {
    const nights = nightsBetween(line.checkIn, line.checkOut);
    return `| ${line.property} | ${line.room} | ${line.rooms} | ${plainDate(line.checkIn)} | ${plainDate(line.checkOut)} | ${nights} | ${formatMoney(line.rateCents, data.currency)} | ${formatMoney(line.rooms * nights * line.rateCents, data.currency)} |`;
  });
  const total = data.lines.reduce((sum, line) => sum + line.rooms * nightsBetween(line.checkIn, line.checkOut) * line.rateCents, 0);
  return [
    "| Accommodation | Unit type | Units | Arrival | Departure | Nights | Rate per room per night | Total |",
    ...rows,
    `| **Total** |  |  |  |  |  |  | **${formatMoney(total, data.currency)}** |`,
  ];
}

function represented(data: AgreementData) {
  const people = data.client.signatories.filter((person) => person.name.trim());
  if (!people.length) return `herein represented by ${missing("who signs for the client — their contracting details")}, duly authorised thereto by the Client.`;
  const named = people.map((person) => (person.designation ? `${person.name}, ${person.designation}` : person.name));
  return `herein represented by ${named.join(", and ")}, ${people.length > 1 ? "both " : ""}being duly authorised thereto by the Client.`;
}

function signatures(data: AgreementData) {
  const client = data.client.name ?? missing("the client's company name");
  const people = data.client.signatories.filter((person) => person.name.trim());
  if (!people.length) return [`@sign For and on behalf of ${client} by ${missing("the signatory")} | duly authorised hereto.`];
  return people.map((person) => `@sign For and on behalf of ${client} by ${person.name} | ${person.designation ? `${person.designation}, ` : ""}duly authorised hereto.`);
}

/** The template with its fields filled in. */
export function fillAgreement(template: string, data: AgreementData) {
  const signatory = inUnitedStates(data.event.country) ? SIGNATORIES.us : SIGNATORIES.world;
  const blocks: Record<string, () => string[]> = {
    "{{welodge.represented}}": () => [signatory.represented],
    "{{welodge.signature}}": () => [signatory.signature],
    "{{client.signatures}}": () => signatures(data),
    "{{bank}}": () => bankAccounts[data.currency] ?? [missing(`the bank account for payments in ${data.currency}`)],
    "{{schedule2}}": () => scheduleTwo(data),
    "{{schedule2.1}}": () => scheduleTwoOne(data),
  };
  const fields: Record<string, string> = {
    "{{client.name}}": data.client.name ?? missing("the client's company name"),
    "{{client.address}}": data.client.address?.replace(/\s*\n\s*/g, ", ") ?? missing("the client's registered address"),
    "{{client.represented}}": represented(data),
    "{{currency}}": data.currency,
    "{{currency.definition}}": currencies[data.currency] ?? missing(`what ${data.currency} is`),
    "{{event.dates}}": `${data.event.name}, currently scheduled to take place from ${longDate(data.event.startDate)} until ${longDate(data.event.endDate)}.`,
  };
  return template
    .split("\n")
    .flatMap((line) => {
      const trimmed = line.trim();
      const payments = /^\{\{payments:([\d.]+)\}\}$/.exec(trimmed);
      if (payments) return paymentLines(data, payments[1]!);
      if (blocks[trimmed]) return blocks[trimmed]();
      return [line.replace(/\{\{[a-z0-9.]+\}\}/g, (field) => fields[field] ?? field)];
    })
    .join("\n");
}

export type AgreementBlock =
  | { kind: "title"; text: string }
  | { kind: "clause"; text: string }
  | { kind: "schedule"; text: string }
  | { kind: "subheading"; text: string }
  | { kind: "numbered"; number: string; depth: number; text: string }
  | { kind: "bullet"; text: string }
  | { kind: "table"; rows: string[][] }
  | { kind: "sign"; who: string; how: string }
  | { kind: "contents"; clauses: string[] }
  | { kind: "paragraph"; text: string };

/** The filled agreement as the blocks it is drawn with. */
export function readAgreement(text: string): AgreementBlock[] {
  const lines = text.split("\n");
  const clauses = lines.filter((line) => /^# /.test(line)).map((line) => line.slice(2).trim());
  const blocks: AgreementBlock[] = [];
  for (const raw of lines) {
    const line = raw.trimEnd();
    if (!line.trim()) continue;
    const numbered = /^(\d+(?:\.\d+)*)\.?\s+(.*)$/.exec(line);
    if (line.startsWith("= ")) blocks.push({ kind: "title", text: line.slice(2) });
    else if (line.startsWith("### ")) blocks.push({ kind: "subheading", text: line.slice(4) });
    else if (line.startsWith("## ")) blocks.push({ kind: "schedule", text: line.slice(3) });
    else if (line.startsWith("# ")) blocks.push({ kind: "clause", text: line.slice(2) });
    else if (line.trim() === "[[contents]]") blocks.push({ kind: "contents", clauses });
    else if (line.startsWith("@sign ")) {
      const [who, how] = line.slice(6).split("|");
      blocks.push({ kind: "sign", who: who!.trim(), how: (how ?? "").trim() });
    } else if (line.startsWith("|")) {
      const cells = line.replace(/^\||\|$/g, "").split("|").map((cell) => cell.trim());
      const last = blocks.at(-1);
      if (last?.kind === "table") last.rows.push(cells);
      else blocks.push({ kind: "table", rows: [cells] });
    } else if (line.startsWith("- ")) blocks.push({ kind: "bullet", text: line.slice(2) });
    else if (numbered) blocks.push({ kind: "numbered", number: numbered[1]!, depth: numbered[1]!.split(".").length, text: numbered[2]! });
    else blocks.push({ kind: "paragraph", text: line });
  }
  return blocks;
}

/** The [missing: …] gaps left in a filled agreement. */
export const agreementGaps = (text: string) => [...new Set([...text.matchAll(/\[missing: ([^\]]+)\]/g)].map((match) => match[1]!))];
