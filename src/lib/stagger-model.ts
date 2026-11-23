/**
 * The Stagger Planner's model (doc §4.12): how a client's apartments arrive
 * and leave in waves, and the rent the owner earns. A faithful port of the
 * reference page (docs/reference/stagger-planner-reference.html) — every rule
 * there is kept here, with no React, d3 or database, so the editor, the
 * client's view and the tests all run the same sums.
 *
 * Dates are calendar days handled in UTC throughout. Amounts are US dollars;
 * rates are stored per month, entered per month or per night.
 */

export const DAY = 86400000;
/** Nights per month, for nightly equivalents (365 ÷ 12 ≈ 30.4). */
export const NPM = 365 / 12;

/** Studio, 1-bed and 2-bed (the reference, as updated 2026-11-23). */
export type UnitType = "studio" | "one" | "two";
export const TYPES: { k: UnitType; label: string }[] = [
  { k: "studio", label: "Studio" },
  { k: "one", label: "1-bed" },
  { k: "two", label: "2-bed" },
];
export const MON = ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"];
export const MONL = ["January", "February", "March", "April", "May", "June", "July", "August", "September", "October", "November", "December"];

/** One arrival wave: move-in day, how many apartments, and months each stays. */
export type WaveRow = { date: string; units: number; stay: number };

/** A scenario as stored (doc §4.12). `presenting` is a viewer's own toggle, never stored. */
export type StaggerData = {
  units: number;
  first: string;
  waves: number;
  gap: number;
  stay: number;
  /** Share of each unit type, in percent. */
  mix: Record<UnitType, number>;
  /** Owner's rent per apartment, US$ per month (may be fractional). */
  rates: Record<UnitType, number>;
  rateBasis: "month" | "night";
  /** Kept for scenarios saved before 2026-11-20; the single-block chart it switched is gone. */
  showBlock: boolean;
  showRent: boolean;
  rows: WaveRow[];
};

// ---------- dates ----------
export function ud(s: string) {
  const p = String(s).split("-").map(Number);
  return new Date(Date.UTC(p[0]!, p[1]! - 1, p[2]));
}
export const iso = (dt: Date) => dt.toISOString().slice(0, 10);
export const addDays = (dt: Date, n: number) => new Date(dt.getTime() + n * DAY);
export const dim = (y: number, m: number) => new Date(Date.UTC(y, m + 1, 0)).getUTCDate();
/** Calendar months later, clamped to the month's end (Jan 31 + 1 month = Feb 29 in 2028). */
export function addMonths(dt: Date, n: number) {
  const t = new Date(Date.UTC(dt.getUTCFullYear(), dt.getUTCMonth() + n, 1));
  return new Date(Date.UTC(t.getUTCFullYear(), t.getUTCMonth(), Math.min(dt.getUTCDate(), dim(t.getUTCFullYear(), t.getUTCMonth()))));
}
export const firstOfMonth = (dt: Date) => new Date(Date.UTC(dt.getUTCFullYear(), dt.getUTCMonth(), 1));
export const fd = (dt: Date) => `${MON[dt.getUTCMonth()]} ${dt.getUTCDate()}`;
export const fdy = (dt: Date) => `${fd(dt)}, ${dt.getUTCFullYear()}`;

// ---------- numbers ----------
export const money = (n: number) => "$" + Math.round(n).toLocaleString("en-US");
export function moneyShort(n: number) {
  if (n >= 1e6) return "$" + (n / 1e6).toFixed(2).replace(/\.?0+$/, "") + "M";
  if (n >= 1e3) return "$" + Math.round(n / 1e3) + "k";
  return money(n);
}
export const num = (n: number) => Math.round(n).toLocaleString("en-US");
export function clampInt(v: unknown, lo: number, hi: number, dflt: number) {
  const n = parseInt(String(v), 10);
  if (isNaN(n)) return dflt;
  return Math.max(lo, Math.min(hi, n));
}
/** The reference's `x|0`: a whole number, 0 for anything else. */
const int = (v: unknown) => (Number(v) | 0);

/** The Games (LA28), Jul 14 – 30, 2028; the end is the first day after. */
export const GAMES: [Date, Date] = [ud("2028-07-14"), ud("2028-07-31")];

/** Spread a whole total by weights, by largest remainder; ties go to the earlier one. */
export function split(total: number, weights: number[]) {
  let w = weights.map((x) => Math.max(0, +x || 0));
  let s = w.reduce((a, b) => a + b, 0);
  if (!s) {
    w = w.map(() => 1);
    s = w.length;
  }
  const raw = w.map((x) => (x / s) * total);
  const base = raw.map(Math.floor);
  const rem = total - base.reduce((a, b) => a + b, 0);
  const order = raw.map((r, i) => [r - Math.floor(r), i] as const).sort((a, b) => b[0] - a[0] || a[1] - b[1]);
  for (let j = 0; j < rem; j++) base[order[j % order.length]![1]]!++;
  return base;
}

/** Waves rebuilt evenly from the total, first date, number of waves, gap and stay. */
export function gen(s: Pick<StaggerData, "units" | "waves" | "first" | "gap" | "stay">): WaveRow[] {
  const n = clampInt(s.waves, 1, 40, 6);
  const u = split(s.units, new Array<number>(n).fill(1));
  const f = ud(s.first);
  return u.map((x, i) => ({ date: iso(addDays(f, i * s.gap)), units: x, stay: s.stay }));
}

/** The 50-unit scenario. */
export function defaults(): StaggerData {
  const s: StaggerData = {
    units: 50,
    first: "2028-03-01",
    waves: 6,
    gap: 14,
    stay: 6,
    mix: { studio: 20, one: 60, two: 20 },
    rates: { studio: 4000, one: 4500, two: 5500 },
    showBlock: true,
    showRent: true,
    rateBasis: "month",
    rows: [],
  };
  s.rows = gen(s);
  return s;
}

/**
 * Each unit type's figure as stored, or the fallback where a scenario has
 * none — a scenario saved before 2-beds came back has no 2-bed share (0) and
 * takes the default 2-bed rate.
 */
const perType = (fallback: Record<UnitType, number>, stored: unknown): Record<UnitType, number> => {
  const s = (stored && typeof stored === "object" ? stored : {}) as Partial<Record<string, unknown>>;
  const pick = (k: UnitType) => (typeof s[k] === "number" && isFinite(s[k]) ? s[k] : fallback[k]);
  return { studio: pick("studio"), one: pick("one"), two: pick("two") };
};

/** Whatever was stored, made whole: anything missing comes from the defaults; anything no longer used is dropped. */
export function normalise(input: unknown): StaggerData {
  const base = defaults();
  if (!input || typeof input !== "object") return base;
  const s = input as Partial<StaggerData>;
  if (!Array.isArray(s.rows) || !s.mix || !s.rates) return base;
  const { presenting: _presenting, ...rest } = s as Partial<StaggerData> & { presenting?: unknown };
  return { ...base, ...rest, mix: perType({ studio: 0, one: 0, two: 0 }, s.mix), rates: perType(base.rates, s.rates), rows: s.rows.map((r) => ({ date: String(r.date), units: int(r.units), stay: int(r.stay) || 1 })) };
}

// ---------- the generator's rules, as the settings panel applies them ----------
/** The total and the number of waves follow the wave rows. */
export function syncTotal(s: StaggerData): StaggerData {
  return { ...s, units: s.rows.reduce((t, r) => t + int(r.units), 0), waves: s.rows.length || 1 };
}
/** Changing only the total keeps the wave dates and rescales the units in proportion. */
export function setTotal(s: StaggerData, n: number): StaggerData {
  const next = { ...s, units: n };
  const rows = next.rows.length ? next.rows : gen(next);
  const u = split(n, rows.map((r) => r.units));
  return { ...next, rows: rows.map((r, i) => ({ ...r, units: u[i]! })) };
}
/** Changing waves, gap or first date rebuilds the waves evenly. */
export const regen = (s: StaggerData): StaggerData => ({ ...s, rows: gen(s) });
/** Changing the stay sets it on every wave. */
export const setStay = (s: StaggerData, stay: number): StaggerData => ({ ...s, stay, rows: s.rows.map((r) => ({ ...r, stay })) });
/** A wave after the last, a gap later, as big as the last. */
export function addWave(s: StaggerData): StaggerData {
  const last = s.rows[s.rows.length - 1];
  const date = last ? iso(addDays(ud(last.date), s.gap)) : s.first;
  return syncTotal({ ...s, rows: [...s.rows, { date, units: last ? last.units : 10, stay: s.stay }] });
}
export const removeWave = (s: StaggerData, i: number): StaggerData => syncTotal({ ...s, rows: s.rows.filter((_, j) => j !== i) });

// ---------- the sums ----------
export type Wave = { a: Date; d: Date; units: number; stay: number };
export type MonthRow = { m: Date; arr: number; dep: number; endOcc: number; rent: number };
export type Computed =
  | { empty: true }
  | {
      empty: false;
      rows: Wave[];
      N: number;
      minA: Date;
      lastA: Date;
      minD: Date;
      maxD: Date;
      start: Date;
      end: Date;
      days: number;
      /** Apartments in-house each day from `start` (for the month-end column). */
      occ: number[];
      counts: number[];
      /** Blended monthly rent per apartment. */
      rateEff: number;
      months: MonthRow[];
      unitMonths: number;
      totalRent: number;
    };

const max = (xs: number[]) => xs.reduce((a, b) => (b > a ? b : a), -Infinity);

export function compute(state: StaggerData): Computed {
  const rows = state.rows
    .filter((r) => int(r.units) > 0 && /^\d{4}-\d{2}-\d{2}$/.test(r.date))
    .map((r) => {
      const a = ud(r.date);
      const st = clampInt(r.stay, 1, 24, 6);
      return { a, d: addMonths(a, st), units: int(r.units), stay: st };
    })
    .sort((x, y) => x.a.getTime() - y.a.getTime());
  if (!rows.length) return { empty: true };
  const N = rows.reduce((t, r) => t + r.units, 0);
  const minA = rows[0]!.a;
  const lastA = rows[rows.length - 1]!.a;
  const maxD = new Date(max(rows.map((r) => r.d.getTime())));
  const minD = new Date(-max(rows.map((r) => -r.d.getTime())));
  const start = firstOfMonth(new Date(Math.min(addDays(minA, -10).getTime(), GAMES[0].getTime())));
  const endRaw = new Date(Math.max(addDays(maxD, 10).getTime(), GAMES[1].getTime()));
  const end = new Date(Date.UTC(endRaw.getUTCFullYear(), endRaw.getUTCMonth() + 1, 1));
  const days = Math.round((end.getTime() - start.getTime()) / DAY);
  const occ = new Array<number>(days + 1).fill(0);
  // In-house for the nights arrival ≤ d < departure.
  for (const r of rows) {
    const ia = Math.round((r.a.getTime() - start.getTime()) / DAY);
    const id = Math.round((r.d.getTime() - start.getTime()) / DAY);
    for (let i = ia; i < id; i++) occ[i]! += r.units;
  }

  const counts = split(N, TYPES.map((t) => state.mix[t.k]));
  const rentSum = TYPES.reduce((s, t, k) => s + counts[k]! * (+state.rates[t.k] || 0), 0);
  const rateEff = N ? rentSum / N : 0;

  const months: MonthRow[] = [];
  const idx: Record<number, number> = {};
  for (let m = new Date(start); m < end; m = new Date(Date.UTC(m.getUTCFullYear(), m.getUTCMonth() + 1, 1))) {
    idx[m.getUTCFullYear() * 12 + m.getUTCMonth()] = months.length;
    months.push({ m, arr: 0, dep: 0, endOcc: 0, rent: 0 });
  }
  const mk = (dt: Date) => months[idx[dt.getUTCFullYear() * 12 + dt.getUTCMonth()]!];
  for (const r of rows) {
    const A = mk(r.a);
    if (A) A.arr += r.units;
    const D = mk(r.d);
    if (D) D.dep += r.units;
    // Each lease month's rent, spread over the calendar months it covers, by day.
    for (let k = 0; k < r.stay; k++) {
      const ls = addMonths(r.a, k);
      const le = addMonths(r.a, k + 1);
      const ld = (le.getTime() - ls.getTime()) / DAY;
      const perDay = (r.units * rateEff) / ld;
      let cur = ls;
      while (cur < le) {
        const mEnd = new Date(Date.UTC(cur.getUTCFullYear(), cur.getUTCMonth() + 1, 1));
        const seg = mEnd < le ? mEnd : le;
        const M = mk(cur);
        if (M) M.rent += (perDay * (seg.getTime() - cur.getTime())) / DAY;
        cur = seg;
      }
    }
  }
  for (const M of months) {
    const last = new Date(Date.UTC(M.m.getUTCFullYear(), M.m.getUTCMonth() + 1, 0));
    const li = Math.round((last.getTime() - start.getTime()) / DAY);
    M.endOcc = occ[li] ?? 0;
  }
  const unitMonths = rows.reduce((t, r) => t + r.units * r.stay, 0);
  return {
    empty: false,
    rows,
    N,
    minA,
    lastA,
    minD,
    maxD,
    start,
    end,
    days,
    occ,
    counts,
    rateEff,
    months,
    unitMonths,
    totalRent: unitMonths * rateEff,
  };
}

// ---------- the words ----------
type Full = Extract<Computed, { empty: false }>;

/** The opening paragraph. */
export function lede(c: Computed) {
  if (c.empty) return "Add at least one wave with apartments to see the plan.";
  const stays = c.rows.map((r) => r.stay);
  const sMin = Math.min(...stays);
  const sMax = Math.max(...stays);
  const stayTxt = sMin === sMax ? `${sMin}${sMin === 1 ? " month" : " months"}` : `${sMin}–${sMax} months`;
  if (c.rows.length > 1) {
    return `We take ${c.N} apartments for ${stayTxt}, with staggered arrivals and departures. Move-ins run from ${fd(c.minA)} to ${fdy(c.lastA)} and hand-backs from ${fd(c.minD)} to ${fdy(c.maxD)}.`;
  }
  return `We take ${c.N} apartments for ${stayTxt}, all moving in on ${fdy(c.minA)} and handed back on ${fdy(c.maxD)}. Add more waves to stagger arrivals and departures.`;
}

/** The three headline figures: apartments, lease months, gross rent. `owner` is the short name in the copy ("Decron"). */
export function facts(c: Full, state: Pick<StaggerData, "showRent">, owner: string) {
  const nW = c.rows.length;
  const out: { big: string; small: string; key?: boolean }[] = [];
  out.push({ big: num(c.N), small: `apartments across ${nW}${nW === 1 ? " wave" : " waves"}` });
  out.push({ big: num(c.unitMonths), small: "lease months" });
  if (state.showRent) out.push({ big: moneyShort(c.totalRent), small: `gross rent to ${owner}` });
  return out;
}

/** "How these figures are built": the Scenario and Hand-back notes, as in the reference. */
export function basis() {
  const out: { tag: "assume" | "ok"; label: string; text: string }[] = [];
  out.push({ tag: "assume", label: "Scenario", text: "Move-in dates and wave sizes are a planning scenario to agree the shape of the hand-back. OBS’s final arrival list will set the exact dates." });
  out.push({ tag: "ok", label: "Hand-back", text: "Check-outs are staggered and each apartment is professionally cleaned on departure, so it can be shown to new tenants straight away." });
  return out;
}

/** The page's title, as the reference's: "Decron Apartments OBS". */
export const pageTitle = (label: string | null | undefined) => (label?.trim() ? `${ownerShort(label)} Apartments OBS` : "Apartments OBS");

/** The reference's short name for the owner in its copy ("Decron" for "Decron Properties"). */
export const ownerShort = (label: string) => label.trim().replace(/\s+(Properties|Property|Group|Holdings|LLC|Inc\.?)$/i, "") || "the owner";
