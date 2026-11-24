/**
 * The Stagger Planner's second kind of scenario (doc §4.12): a **staggered
 * lease**, built from a client's real arrivals and departures at a recent
 * event. Ported from docs/reference/staggered-lease-reference.html, step for
 * step, with no framework in it — the editor and the owner's view both ask it.
 *
 * Every date is a UTC day (milliseconds at 00:00 UTC), so nothing shifts with
 * the viewer's time zone. Only the provider's rent is ever worked out here —
 * never a margin, a sell rate or a cost.
 */

export const DAY = 864e5;
/** Days in an average month, as the reference: monthly rent ÷ 30.42 is a day's rent. */
export const MONTH_DAYS = 30.42;

export const MON = ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"];
export const MONL = ["January", "February", "March", "April", "May", "June", "July", "August", "September", "October", "November", "December"];
export const DOW = ["Sunday", "Monday", "Tuesday", "Wednesday", "Thursday", "Friday", "Saturday"];

export type MinBack = "none" | "g1" | "g2";
export type MixRow = { t: string; n: number; r: number };
/** A reservation at the reference event: check-in and check-out, YYYY-MM-DD. */
export type Reservation = { checkIn: string; checkOut: string };

/** Everything on the reference's *Edit numbers* panel. */
export type LeaseSettings = {
  provider: string;
  client: string;
  version: string;
  units: number;
  mix: MixRow[];
  /** The most apartments handed back in one week. */
  cap: number;
  /** Move-in days of the month, as typed: "1, 15". */
  waves: string;
  /** The hand-back weekday, 0 = Sunday … 6 = Saturday. */
  dow: number;
  earliest: string;
  latest: string;
  minback: MinBack;
  /** Days a move-in wave may move once the final list is in — said in the terms only. */
  flex: number;
  r_open: string;
  r_close1: string;
  r_close2: string;
  t_open: string;
  t_close1: string;
  t_open2: string;
  t_close2: string;
};

export function leaseDefaults(): LeaseSettings {
  return {
    provider: "Decron Properties",
    client: "OBS",
    version: "Staggered lease option, draft 3, November 2026",
    units: 60,
    mix: [
      { t: "Studio", n: 10, r: 2400 },
      { t: "1-bed", n: 40, r: 2700 },
      { t: "2-bed", n: 10, r: 3200 },
    ],
    cap: 8,
    waves: "1, 15",
    dow: 1,
    earliest: "2028-03-01",
    latest: "2028-10-16",
    minback: "g1",
    flex: 14,
    r_open: "2026-02-06",
    r_close1: "2026-02-22",
    r_close2: "2026-03-15",
    t_open: "2028-07-14",
    t_close1: "2028-07-30",
    t_open2: "2028-08-15",
    t_close2: "2028-08-27",
  };
}

const DATE_KEYS = ["earliest", "latest", "r_open", "r_close1", "r_close2", "t_open", "t_close1", "t_open2", "t_close2"] as const;

/** A YYYY-MM-DD as its UTC day. */
export function ud(s: string) {
  const [y, m, d] = String(s).split("-").map(Number);
  return Date.UTC(y!, m! - 1, d!);
}
/** A real calendar day written YYYY-MM-DD. */
export function okDate(s: unknown): s is string {
  if (typeof s !== "string" || !/^\d{4}-\d{2}-\d{2}$/.test(s)) return false;
  const t = ud(s);
  return !Number.isNaN(t) && new Date(t).toISOString().slice(0, 10) === s;
}
export const iso = (t: number) => new Date(t).toISOString().slice(0, 10);
const dd = (a: number, b: number) => Math.round((b - a) / DAY);
/** "Mar 1". */
export const fd = (t: number) => `${MON[new Date(t).getUTCMonth()]} ${new Date(t).getUTCDate()}`;
/** "Mar 1, 2028". */
export const fdy = (t: number) => `${fd(t)}, ${new Date(t).getUTCFullYear()}`;
export const money = (n: number) => `$${Math.round(n).toLocaleString("en-US")}`;
/** One decimal, always: "5.0". */
export const one = (n: number) => (Math.round(n * 10) / 10).toFixed(1);
export function ord(n: number) {
  const s = ["th", "st", "nd", "rd"];
  const v = n % 100;
  return n + (s[(v - 20) % 10] ?? s[v] ?? s[0]!);
}
export const listJoin = (a: string[]) => (a.length < 2 ? a.join("") : `${a.slice(0, -1).join(", ")} or ${a[a.length - 1]}`);

/** Whole numbers in proportion to the weights that add up to the total — largest remainder, ties to the earlier. */
export function split(total: number, weights: number[]) {
  const sum = weights.reduce((s, w) => s + w, 0) || 1;
  const raw = weights.map((w) => (total * w) / sum);
  const out = raw.map(Math.floor);
  const left = total - out.reduce((s, v) => s + v, 0);
  raw
    .map((v, i) => [v - Math.floor(v), i] as const)
    .sort((a, b) => b[0] - a[0])
    .slice(0, left)
    .forEach(([, i]) => out[i]!++);
  return out;
}

/** Changing the total rescales the unit mix (largest remainder). */
export function setUnits(s: LeaseSettings, units: number): LeaseSettings {
  const v = Math.round(units);
  if (!(v >= 1)) return s;
  const counts = split(v, s.mix.map((m) => m.n || 0));
  return { ...s, units: v, mix: s.mix.map((m, k) => ({ ...m, n: counts[k]! })) };
}
/** Changing a unit count changes the total. */
export function setCount(s: LeaseSettings, index: number, count: number): LeaseSettings {
  const mix = s.mix.map((m, k) => (k === index ? { ...m, n: Math.max(0, Math.round(count) || 0) } : m));
  return { ...s, mix, units: mix.reduce((sum, m) => sum + m.n, 0) || 1 };
}

/** Saved settings read back safely: anything missing or wrong takes the default. */
export function normaliseLease(raw: unknown): LeaseSettings {
  const d = leaseDefaults();
  const o = raw && typeof raw === "object" ? (raw as Record<string, unknown>) : {};
  const str = (k: keyof LeaseSettings) => (typeof o[k] === "string" ? (o[k] as string) : (d[k] as string));
  const num = (k: keyof LeaseSettings, min: number, max: number) => {
    const v = Number(o[k]);
    return Number.isFinite(v) && v >= min && v <= max ? v : (d[k] as number);
  };
  const mix = Array.isArray(o.mix)
    ? (o.mix as unknown[])
        .filter((m): m is Record<string, unknown> => !!m && typeof m === "object")
        .map((m) => ({ t: typeof m.t === "string" ? m.t : "", n: Math.max(0, Math.round(Number(m.n)) || 0), r: Math.max(0, Number(m.r) || 0) }))
        .slice(0, 12)
    : d.mix;
  const out: LeaseSettings = {
    provider: str("provider"),
    client: str("client"),
    version: str("version"),
    units: Math.round(num("units", 1, 2000)),
    mix: mix.length ? mix : d.mix,
    cap: Math.round(num("cap", 1, 500)),
    waves: str("waves"),
    dow: Math.round(num("dow", 0, 6)),
    earliest: d.earliest,
    latest: d.latest,
    minback: o.minback === "none" || o.minback === "g1" || o.minback === "g2" ? o.minback : d.minback,
    flex: Math.round(num("flex", 0, 60)),
    r_open: d.r_open,
    r_close1: d.r_close1,
    r_close2: d.r_close2,
    t_open: d.t_open,
    t_close1: d.t_close1,
    t_open2: d.t_open2,
    t_close2: d.t_close2,
  };
  for (const k of DATE_KEYS) if (okDate(o[k])) out[k] = o[k] as string;
  return out;
}

/** A saved reservation list read back safely; only well-formed stays are kept. */
export function normaliseReservations(raw: unknown): Reservation[] {
  if (!Array.isArray(raw)) return [];
  return raw
    .map((r) => (r && typeof r === "object" ? (r as Record<string, unknown>) : {}))
    .filter((r) => okDate(r.checkIn) && okDate(r.checkOut) && ud(r.checkOut as string) > ud(r.checkIn as string))
    .map((r) => ({ checkIn: r.checkIn as string, checkOut: r.checkOut as string }));
}

/**
 * A reservation list from a CSV: each line with dates needs a check-in and a
 * check-out (YYYY-MM-DD), the check-out after the check-in. Lines with no date
 * at all — a heading, a blank — are skipped; a line with a bad date is refused
 * with its number, so nothing is half-loaded.
 */
export function parseReservationCsv(text: string): { rows: Reservation[] } | { problem: string } {
  const rows: Reservation[] = [];
  const lines = String(text).split(/\r?\n/);
  for (const [i, line] of lines.entries()) {
    const found = line.match(/\d{4}-\d{2}-\d{2}/g);
    if (!found) continue;
    const [checkIn, checkOut] = found;
    if (!checkIn || !checkOut) return { problem: `Line ${i + 1} has one date; each line needs a check-in and a check-out (YYYY-MM-DD).` };
    if (!okDate(checkIn) || !okDate(checkOut)) return { problem: `Line ${i + 1}: ${!okDate(checkIn) ? checkIn : checkOut} is not a real date.` };
    if (ud(checkOut) <= ud(checkIn)) return { problem: `Line ${i + 1}: the check-out (${checkOut}) must be after the check-in (${checkIn}).` };
    rows.push({ checkIn, checkOut });
  }
  if (rows.length < 2) return { problem: "No reservations found in that file. Each line needs a check-in and a check-out date as YYYY-MM-DD." };
  return { rows };
}

export type Apartment = { a: number; d: number; start: number; co: number; held: boolean; end: number; days: number; months: number };
export type MonthRow = { t: number; inn: number; out: number; endL: number; days: number; rent: number };
export type WeekRow = { t: number; c: number; back: number; left: number };
export type Group = { s: number; e: number; n: number };

/** Steps 1–8 of the reference, unchanged. */
export function computeLease(S: LeaseSettings, reservations: Reservation[]) {
  const res = reservations.length ? reservations : [];
  const N = Math.max(1, Math.min(Math.max(1, res.length) * 50, Math.round(+S.units) || 1));
  const CAP = Math.max(1, Math.round(+S.cap) || 1);
  const R = { open: ud(S.r_open), c1: ud(S.r_close1), c2: ud(S.r_close2) };
  const T = { open: ud(S.t_open), c1: ud(S.t_close1), o2: ud(S.t_open2), c2: ud(S.t_close2) };
  const EARLY = ud(S.earliest);
  const LATEST = ud(S.latest);
  const MINBACK = S.minback === "g1" ? T.c1 : S.minback === "g2" ? T.c2 : null;
  let waveDays = String(S.waves)
    .split(/[^0-9]+/)
    .map(Number)
    .filter((d) => d >= 1 && d <= 28);
  waveDays = waveDays.filter((d, i) => waveDays.indexOf(d) === i).sort((a, b) => a - b);
  if (!waveDays.length) waveDays = [1];
  const dow = +S.dow;

  // 1–2: each stay moved to the target calendar.
  const mapped = res
    .map((r) => {
      const ci = ud(r.checkIn);
      const co = ud(r.checkOut);
      const a = T.open + (ci - R.open);
      const d = co <= R.c1 + 14 * DAY ? T.c1 + (co - R.c1) : T.c2 + (co - R.c2);
      return { a, d };
    })
    .sort((x, y) => x.a - y.a || x.d - y.d);
  // 3: N evenly spaced through the list.
  const n = mapped.length;
  const apts: Apartment[] = [];
  for (let i = 0; i < N && n; i++) {
    const m = mapped[Math.floor(((i + 0.5) * n) / N)]!;
    apts.push({ a: m.a, d: m.d, start: 0, co: 0, held: false, end: 0, days: 0, months: 0 });
  }
  // 4–5: lease start on a move-in day; check-out held, capped, after the start.
  for (const p of apts) {
    const d = new Date(p.a);
    const y = d.getUTCFullYear();
    const mo = d.getUTCMonth();
    const day = d.getUTCDate();
    const cand = waveDays.filter((w) => w <= day);
    const w = cand.length ? Date.UTC(y, mo, cand[cand.length - 1]!) : Date.UTC(y, mo - 1, waveDays[waveDays.length - 1]!);
    p.start = Math.max(w, EARLY);
    p.co = p.d;
    p.held = MINBACK !== null && p.co < MINBACK;
    if (p.held) p.co = MINBACK!;
    p.co = Math.min(p.co, LATEST);
    if (p.co <= p.start) p.co = p.start + DAY;
  }
  // 6: the hand-back weekday on or after check-out, a week later while that one is full.
  const used = new Map<number, number>();
  apts
    .slice()
    .sort((x, y) => x.co - y.co || x.a - y.a)
    .forEach((p) => {
      const wd = new Date(p.co).getUTCDay();
      let e = p.co + ((dow - wd + 7) % 7) * DAY;
      while ((used.get(e) ?? 0) >= CAP) e += 7 * DAY;
      used.set(e, (used.get(e) ?? 0) + 1);
      p.end = e;
    });
  // Mix and rent.
  const counts = S.mix.map((x) => Math.max(0, Math.round(+x.n) || 0));
  const mixN = counts.reduce((s, v) => s + v, 0) || 1;
  const blended = S.mix.reduce((s, x, k) => s + counts[k]! * (+x.r || 0), 0) / mixN;
  const perDay = blended / MONTH_DAYS;
  // 8: lengths (the end day is not charged).
  for (const p of apts) {
    p.days = dd(p.start, p.end);
    p.months = p.days / MONTH_DAYS;
  }
  const totalDays = apts.reduce((s, p) => s + p.days, 0);
  const leaseMonths = totalDays / MONTH_DAYS;
  const lens = apts.map((p) => p.months);
  const min = (k: "start" | "end") => Math.min(...apts.map((p) => p[k]));
  const max = (k: "start" | "end") => Math.max(...apts.map((p) => p[k]));
  const minStart = min("start");
  const maxStart = max("start");
  const minEnd = min("end");
  const maxEnd = max("end");
  const nWaves = new Set(apts.map((p) => p.start)).size;
  // 7: month by month, each month's rent rounded, the total their sum.
  const months: MonthRow[] = [];
  if (apts.length) {
    const sd = new Date(minStart);
    for (let y = sd.getUTCFullYear(), mo = sd.getUTCMonth(); Date.UTC(y, mo, 1) <= maxEnd; mo++) {
      if (mo > 11) {
        mo = 0;
        y++;
      }
      const m0 = Date.UTC(y, mo, 1);
      const m1 = Date.UTC(y, mo + 1, 1);
      const last = m1 - DAY;
      const row: MonthRow = { t: m0, inn: 0, out: 0, endL: 0, days: 0, rent: 0 };
      for (const p of apts) {
        if (p.start >= m0 && p.start < m1) row.inn++;
        if (p.end >= m0 && p.end < m1) row.out++;
        if (p.start <= last && p.end > last) row.endL++;
        const o = Math.min(p.end, m1) - Math.max(p.start, m0);
        if (o > 0) row.days += o / DAY;
      }
      row.rent = Math.round(row.days * perDay);
      months.push(row);
    }
  }
  const gross = months.reduce((s, r) => s + r.rent, 0);
  // Every hand-back weekday from the first to the last, empty weeks too.
  const weeks: WeekRow[] = [];
  let back = 0;
  if (apts.length) {
    for (let w = minEnd; w <= maxEnd; w += 7 * DAY) {
      const c = used.get(w) ?? 0;
      back += c;
      weeks.push({ t: w, c, back, left: N - back });
    }
  }
  // Bars: apartments sharing a start and an end.
  const gm = new Map<string, Group>();
  for (const p of apts) {
    const k = `${p.start}|${p.end}`;
    const g = gm.get(k) ?? { s: p.start, e: p.end, n: 0 };
    g.n++;
    gm.set(k, g);
  }
  const groups = [...gm.values()].sort((a, b) => a.s - b.s || a.e - b.e);
  const sum = <T>(list: T[], f: (x: T) => number) => list.reduce((s, x) => s + f(x), 0);
  const ok =
    apts.length > 0 &&
    sum(months, (r) => r.inn) === N &&
    sum(months, (r) => r.out) === N &&
    sum(weeks, (r) => r.c) === N &&
    sum(groups, (g) => g.n) === N &&
    Math.max(...weeks.map((x) => x.c)) <= CAP;
  return {
    N,
    CAP,
    T,
    resCount: res.length,
    apts,
    counts,
    mixN,
    blended,
    perDay,
    leaseMonths,
    avg: apts.length ? leaseMonths / N : 0,
    minLen: lens.length ? Math.min(...lens) : 0,
    maxLen: lens.length ? Math.max(...lens) : 0,
    minStart,
    maxStart,
    minEnd,
    maxEnd,
    nWaves,
    months,
    gross,
    weeks,
    groups,
    ok,
    waveDays,
    dow,
    LATEST,
    MINBACK,
    held: apts.filter((p) => p.held).length,
    // As the reference: past the latest date by more than the week to the next hand-back day.
    late: apts.filter((p) => p.end > LATEST + 6 * DAY).length,
  };
}

export type LeaseComputed = ReturnType<typeof computeLease>;

/** The editor's warnings, in words; empty when all is well. */
export function leaseWarnings(c: LeaseComputed): string[] {
  const warn: string[] = [];
  if (c.resCount < 2) warn.push("There is no reservation list. Load a CSV or use the original list.");
  if (c.mixN !== c.N) warn.push(`Unit counts add up to ${c.mixN}, not ${c.N}. Rent uses the blended rate of the mix.`);
  if (c.late) warn.push(`${c.late} apartment${c.late === 1 ? " is" : "s are"} handed back after the latest hand-back date because the weekly cap is full. Raise the cap or move the date.`);
  if (c.apts.length && c.minLen * MONTH_DAYS < 30) warn.push("At least one lease is shorter than 30 nights.");
  if (c.resCount >= 2 && !c.ok) warn.push("Totals do not reconcile. Check the inputs.");
  return warn;
}

/** The provider's short name in the copy: "Decron" for "Decron Properties". */
export const providerShort = (provider: string) => (provider.trim() || "the provider").split(" ")[0]!;

/** The page's title — and the saved PDF's name. */
export const leaseTitle = (s: Pick<LeaseSettings, "provider" | "client">) => `${providerShort(s.provider)} apartments for ${s.client.trim() || "the client"}: staggered lease option`;

/** The page's words, as the reference writes them. */
export function leaseCopy(S: LeaseSettings, c: LeaseComputed) {
  const cl = S.client.trim() || "the client";
  const short = providerShort(S.provider);
  const day = DOW[c.dow]!;
  const days = `${day}s`;
  const waveTxt = listJoin(c.waveDays.map(ord));
  const which = S.minback === "g1" ? "the first" : "the second";
  return {
    short,
    day,
    h1: `${c.N} apartments in with ${cl}, back to you no more than ${c.CAP} a week`,
    lede: `We lease ${c.N} apartments for the ${cl} team, moving in on the ${waveTxt} of the month from ${fd(c.minStart)} to ${fdy(c.maxStart)}. They come back to you on ${days} between ${fd(c.minEnd)} and ${fdy(c.maxEnd)}, never more than ${c.CAP} in one week.`,
    facts: [
      { cap: true, b: String(c.CAP), s: "apartments handed back in any one week, at most" },
      { cap: false, b: String(c.N), s: `apartments, moving in over ${c.nWaves}${c.nWaves === 1 ? " wave" : " waves"}` },
      {
        cap: false,
        b: c.gross >= 1e6 ? `$${(c.gross / 1e6).toFixed(2)}M` : `$${(c.gross / 1e3).toFixed(0)}k`,
        s: `${money(c.gross)} gross rent over ${one(c.leaseMonths)} lease months`,
      },
    ],
    weeklySub: `Every hand-back falls on a ${day}. The meter shows how many of the ${c.CAP} weekly slots are used.`,
    why1: `Apartments come back over ${c.weeks.length} weeks, from ${fd(c.minEnd)} to ${fdy(c.maxEnd)}. No week has more than ${c.CAP}, so your leasing and cleaning teams can plan a steady weekly turnover instead of re-letting a whole block at once.`,
    why2: `All ${c.N} apartments are back by ${fdy(c.maxEnd)}, in the late-summer and early-autumn leasing season, not in winter when units are hardest to fill.${c.MINBACK !== null ? ` None come back before the end of ${which} Games period.` : ""}`,
    why3: `Each lease starts with the move-in wave just before the person arrives and ends on the ${day} after they leave, so there are no empty months before or after. Apartments move in from ${fd(c.minStart)} and are back with you as soon as each person leaves.`,
    flex: ` Each move-in wave can move by up to ${Math.round(+S.flex) || 0} days once the final arrival list is in. The weekly hand-back cap does not change.`,
    note1: `This scenario is based on ${cl}’s arrival and departure pattern at a recent event (${c.resCount} reservations), shifted to the ${new Date(c.T.open).getUTCFullYear()} calendar and scaled to ${c.N} apartments. ${cl}’s final arrival list will set the exact dates.`,
    note2: `Each lease ends on the first ${day} after the person checks out${c.MINBACK !== null ? `, and not before ${fdy(c.MINBACK)}, the close of ${which} Games period` : ""}. If that ${day} already has ${c.CAP} hand-backs, the lease runs to the next ${day} with a free slot. Rent is charged by the day at the blended rate (${money(c.blended)} a month, about ${money(c.perDay)} a day).`,
    note3: "All leases are 30 nights or longer and are fully insured. Rates are proposals and are subject to agreement. All amounts in USD.",
  };
}
