import { addDays, nightsBetween } from "~/lib/dates";
import { longDate, missing, months, plainDate } from "~/lib/agreement";

/**
 * Filling our agreement with a hotel — US events only for now (doc §4.11,
 * 2026-10-14) — from the hotel, its quote and the contract made from it.
 * Gaps are written [missing: …], as in the client's agreement.
 */

export type HotelAgreementData = {
  date: Date;
  hotel: {
    name: string;
    /** The legal entity the contract is with — its contracting details. */
    company: string | null;
    address: string | null;
    registration: string | null;
    signatoryName: string | null;
    signatoryTitle: string | null;
    contractEmail: string | null;
    /** The chain or management company, for a copy of every notice. */
    group: string | null;
  };
  event: { name: string; startDate: Date; endDate: Date };
  totalCents: number | null;
  payments: { dueOn: Date; percentBasisPoints: number | null; amountCents: number | null; description: string }[];
  /** Cancellation fees, each charged from its cut-off. */
  fees: { cutoffOn: Date; feeBasisPoints: number }[];
  inclusions: string[];
  lines: { room: string; rooms: number; checkIn: Date; checkOut: Date; rateCents: number }[];
};

/** "$175,770.00" — US dollars as an American contract writes them. */
const dollars = (cents: number) => `$${(cents / 100).toLocaleString("en-US", { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;
/** "December 10, 2026". */
const usDate = (date: Date) => `${months[date.getUTCMonth()]} ${date.getUTCDate()}, ${date.getUTCFullYear()}`;
const pct = (basisPoints: number) => `${Number((basisPoints / 100).toFixed(2))}`;

function payments(data: HotelAgreementData, under: string) {
  if (!data.payments.length) return [`${under}.1 ${missing("the payment schedule — on the hotel's contract")}`];
  return data.payments.map((payment, index) => {
    const amount = payment.amountCents ?? (payment.percentBasisPoints !== null && data.totalCents !== null ? Math.round((data.totalCents * payment.percentBasisPoints) / 10_000) : null);
    const share = payment.percentBasisPoints !== null ? ` (${pct(payment.percentBasisPoints)} per cent)` : "";
    const last = index === data.payments.length - 1;
    const end = last
      ? " plus any applicable sales tax, transient occupancy tax and any and all other taxes/levies (local, state or federal) estimated to be applicable to the Lease Period."
      : ";";
    return `${under}.${index + 1} on or before ${plainDate(payment.dueOn)}, the sum equal to ${amount !== null ? dollars(amount) : missing("the amount")}${share} of the Remuneration${end}`;
  });
}

function cancellation(data: HotelAgreementData) {
  if (!data.fees.length) return [missing("the cancellation fees — add them to the hotel's quote or contract")];
  const fees = [...data.fees].sort((a, b) => a.cutoffOn.getTime() - b.cutoffOn.getTime());
  const arrival = data.lines.length ? new Date(Math.min(...data.lines.map((line) => line.checkIn.getTime()))) : null;
  return fees.map((fee, index) => {
    const from = index === 0 && fee.cutoffOn <= data.date ? "Date of Agreement" : usDate(fee.cutoffOn);
    const next = fees[index + 1];
    const to = next ? usDate(addDays(next.cutoffOn, -1)) : arrival ? usDate(arrival) : "the Arrival Date";
    const amount = data.totalCents !== null ? `${dollars(Math.round((data.totalCents * fee.feeBasisPoints) / 10_000))} ` : "";
    return `- ${from} to ${to}: ${amount}(${pct(fee.feeBasisPoints)}%)`;
  });
}

function scheduleTwoOne(data: HotelAgreementData) {
  if (!data.lines.length) return [missing("the rooms — the quote's lines")];
  const total = data.lines.reduce((sum, line) => sum + line.rooms * nightsBetween(line.checkIn, line.checkOut) * line.rateCents, 0);
  return [
    "| Unit type | Units | Arrival | Departure | Nights | Rate per room per night | Total |",
    ...data.lines.map((line) => {
      const nights = nightsBetween(line.checkIn, line.checkOut);
      return `| ${line.room} | ${line.rooms} | ${usDate(line.checkIn)} | ${usDate(line.checkOut)} | ${nights} | ${dollars(line.rateCents)} | ${dollars(line.rooms * nights * line.rateCents)} |`;
    }),
    `| **Total** |  |  |  |  |  | **${dollars(total)}** |`,
  ];
}

export function fillHotelAgreement(template: string, data: HotelAgreementData) {
  const { hotel } = data;
  const company = hotel.company ?? hotel.name;
  const blocks: Record<string, () => string[]> = {
    "{{hotel.notice}}": () => [
      `**The Provider: ${company}**`,
      `Address: ${hotel.address ?? missing("the hotel's address")}`,
      `ATTN: General Manager of ${hotel.name}${hotel.contractEmail ? ` — ${hotel.contractEmail}` : ""}`,
      ...(hotel.group ? [`**To copy: ${hotel.group}**`, `Address: ${missing(`${hotel.group}'s address`)}`, "ATTN: General Counsel"] : []),
    ],
    "{{welodge.signature}}": () => ["@sign We Lodge Corp. — by Volkhard Bauer | CEO"],
    "{{hotel.signature}}": () => [
      `@sign ${company} — by ${hotel.signatoryName ?? missing("who signs for the hotel")} | ${hotel.signatoryTitle ?? missing("their title")}`,
    ],
    "{{parking}}": () => [`11.1 ${missing("the parking spaces included")} Parking spaces are included in this Contract.`, `11.2 Any additional parking spots required by We Lodge will be charged at ${missing("the daily rate")} per day.`],
    "{{inclusions}}": () => (data.inclusions.length ? data.inclusions.map((item) => `- ${item}`) : [`- ${missing("what the rate includes — on the quote")}`]),
    "{{cancellation}}": () => cancellation(data),
    "{{schedule2.1}}": () => scheduleTwoOne(data),
  };
  const fields: Record<string, string> = {
    "{{date}}": plainDate(data.date),
    "{{hotel.party}}": `${company}, a ${missing("the company's state and type — a Delaware limited liability company, say")}, with its principal place of business at ${hotel.address ?? missing("the hotel's address")}`,
    "{{hotel.name}}": hotel.name,
    "{{hotel.registration}}": hotel.registration ?? missing("the hotel's registration number"),
    "{{event.name}}": data.event.name,
    "{{event.dates}}": `${data.event.name}, currently scheduled to take place from ${longDate(data.event.startDate)} until ${longDate(data.event.endDate)}.`,
    "{{total}}": data.totalCents !== null ? dollars(data.totalCents) : missing("the total — on the hotel's contract"),
  };
  return template
    .split("\n")
    .flatMap((line) => {
      const trimmed = line.trim();
      const pay = /^\{\{payments:([\d.]+)\}\}$/.exec(trimmed);
      if (pay) return payments(data, pay[1]!);
      if (blocks[trimmed]) return blocks[trimmed]();
      return [line.replace(/\{\{[a-z0-9.]+\}\}/g, (field) => fields[field] ?? field)];
    })
    .join("\n");
}
