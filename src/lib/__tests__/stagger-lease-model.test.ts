import { describe, expect, it } from "vitest";

import {
  computeLease,
  fd,
  iso,
  leaseDefaults,
  leaseWarnings,
  normaliseLease,
  normaliseReservations,
  parseReservationCsv,
  setCount,
  setUnits,
  split,
  ud,
} from "~/lib/stagger-lease-model";
import { SEED_RESERVATIONS } from "~/lib/stagger-lease-seed";

const seed = SEED_RESERVATIONS.map(([checkIn, checkOut]) => ({ checkIn, checkOut }));
// The reference's figures are for Monday hand-backs; the default is now Thursday (the owner, 2026-11-24).
const reference = () => ({ ...leaseDefaults(), dow: 1 });
const c = computeLease(reference(), seed);

describe("the seed scenario (docs/reference/staggered-lease-reference.html)", () => {
  it("uses all 195 reservations", () => {
    expect(seed).toHaveLength(195);
    expect(c.resCount).toBe(195);
  });

  it("has 60 apartments at a blended $2,733.33", () => {
    expect(c.N).toBe(60);
    expect(c.counts).toEqual([10, 40, 10]);
    expect(leaseDefaults().mix.map((m) => m.r)).toEqual([2400, 2700, 3200]);
    expect(c.blended.toFixed(2)).toBe("2733.33");
  });

  it("moves in over 8 waves from Mar 1 to Jun 15, 2028, in 32 groups", () => {
    expect(c.nWaves).toBe(8);
    expect(iso(c.minStart)).toBe("2028-03-01");
    expect(iso(c.maxStart)).toBe("2028-06-15");
    expect(c.groups).toHaveLength(32);
  });

  it("hands back no more than 8 a week, on Mondays", () => {
    expect(c.weeks.map((w) => `${fd(w.t)}: ${w.c}`)).toEqual([
      "Jul 31: 2",
      "Aug 7: 8",
      "Aug 14: 8",
      "Aug 21: 2",
      "Aug 28: 1",
      "Sep 4: 8",
      "Sep 11: 8",
      "Sep 18: 8",
      "Sep 25: 8",
      "Oct 2: 3",
      "Oct 9: 1",
      "Oct 16: 3",
    ]);
    expect(c.weeks.every((w) => new Date(w.t).getUTCDay() === 1)).toBe(true);
    expect(c.weeks.at(-1)!.left).toBe(0);
  });

  it("charges Mar–Oct 2028 month by month, each month rounded, the total their sum", () => {
    expect(c.months.map((m) => iso(m.t).slice(0, 7))).toEqual(["2028-03", "2028-04", "2028-05", "2028-06", "2028-07", "2028-08", "2028-09", "2028-10"]);
    expect(c.months.map((m) => m.rent)).toEqual([43848, 105847, 154997, 160478, 166947, 128310, 57686, 5032]);
    expect(c.gross).toBe(823145);
    expect(c.months.reduce((s, m) => s + m.rent, 0)).toBe(c.gross);
  });

  it("is 301.2 lease months, 5.02 on average, from 1.74 to 7.53", () => {
    expect(c.leaseMonths.toFixed(1)).toBe("301.2");
    expect(c.avg.toFixed(2)).toBe("5.02");
    expect(c.minLen.toFixed(2)).toBe("1.74");
    expect(c.maxLen.toFixed(2)).toBe("7.53");
  });

  it("reconciles and warns of nothing", () => {
    expect(c.ok).toBe(true);
    expect(c.months.reduce((s, m) => s + m.inn, 0)).toBe(60);
    expect(c.months.reduce((s, m) => s + m.out, 0)).toBe(60);
    expect(leaseWarnings(c)).toEqual([]);
  });
});

describe("the rules", () => {
  it("starts a lease on the latest move-in day on or before arrival, else the previous month's last", () => {
    const s = { ...reference(), units: 1, earliest: "2000-01-01" };
    // Reference opening Feb 6 → target Jul 14; check in on the reference's Feb 10 → Jul 18 → the 15th.
    const one = (checkIn: string) => computeLease(s, [{ checkIn, checkOut: "2026-03-20" }, { checkIn, checkOut: "2026-03-20" }]).apts[0]!;
    expect(iso(one("2026-02-10").start)).toBe("2028-07-15");
    // Feb 2 → Jul 10 → the 1st.
    expect(iso(one("2026-02-02").start)).toBe("2028-07-01");
    // With move-in days 10 and 20, Jul 5 has none in its month → the 20th of June.
    const early = computeLease({ ...s, waves: "10, 20" }, [{ checkIn: "2026-01-28", checkOut: "2026-03-20" }, { checkIn: "2026-01-28", checkOut: "2026-03-20" }]).apts[0]!;
    expect(iso(early.a)).toBe("2028-07-05");
    expect(iso(early.start)).toBe("2028-06-20");
  });

  it("never starts before the earliest move-in", () => {
    const s = { ...reference(), units: 1, earliest: "2028-07-10" };
    const p = computeLease(s, [{ checkIn: "2026-02-02", checkOut: "2026-03-20" }, { checkIn: "2026-02-02", checkOut: "2026-03-20" }]).apts[0]!;
    expect(iso(p.start)).toBe("2028-07-10");
  });

  it("maps an early check-out from the first closing, a later one from the second", () => {
    const s = { ...reference(), units: 2, minback: "none" as const, earliest: "2000-01-01" };
    const r = computeLease(s, [
      { checkIn: "2026-02-01", checkOut: "2026-03-08" }, // ≤ Feb 22 + 14 days → Jul 30 + 14 = Aug 13
      { checkIn: "2026-02-01", checkOut: "2026-03-09" }, // after → Aug 27 − 6 = Aug 21
    ]);
    expect(r.apts.map((p) => iso(p.d))).toEqual(["2028-08-13", "2028-08-21"]);
  });

  it("holds check-outs to the end of a Games period and caps them at the latest hand-back", () => {
    const s = { ...reference(), units: 2, earliest: "2000-01-01", minback: "g2" as const, latest: "2028-09-01" };
    const r = computeLease(s, [
      { checkIn: "2026-02-01", checkOut: "2026-02-10" }, // Jul 18 → held to Aug 27
      { checkIn: "2026-02-01", checkOut: "2026-05-30" }, // far later → capped at Sep 1
    ]);
    expect(r.apts.map((p) => iso(p.co))).toEqual(["2028-08-27", "2028-09-01"]);
    expect(r.held).toBe(1);
    // Ends: the Monday on or after — Aug 28 and Sep 4.
    expect(r.apts.map((p) => iso(p.end))).toEqual(["2028-08-28", "2028-09-04"]);
  });

  it("pushes a hand-back a week while that Monday is full", () => {
    const s = { ...reference(), units: 3, cap: 2, minback: "none" as const, earliest: "2000-01-01" };
    const same = { checkIn: "2026-02-01", checkOut: "2026-03-08" };
    const r = computeLease(s, [same, same, same]);
    expect(r.weeks.map((w) => [iso(w.t), w.c])).toEqual([
      ["2028-08-14", 2],
      ["2028-08-21", 1],
    ]);
  });

  it("counts a month's leased apartments at its last day, the end day not charged", () => {
    const m = c.months[0]!;
    expect(m.inn).toBeGreaterThan(0);
    expect(c.months.at(-1)!.endL).toBe(0);
  });

  it("warns of a lease under 30 nights, a late hand-back and counts that do not match", () => {
    const s = { ...reference(), units: 4, cap: 1, earliest: "2000-01-01", minback: "none" as const, latest: "2028-08-14" };
    const same = { checkIn: "2026-02-20", checkOut: "2026-02-25" };
    const r = computeLease(s, [same, same, same, same]);
    const warn = leaseWarnings(r).join(" ");
    expect(warn).toContain("Unit counts add up to 60, not 4");
    expect(warn).toContain("handed back after the latest hand-back date");
    expect(warn).toContain("shorter than 30 nights");
  });
});

describe("the default hand-back day", () => {
  it("is Thursday, and the seed still reconciles under the cap", () => {
    expect(leaseDefaults().dow).toBe(4);
    const t = computeLease(leaseDefaults(), seed);
    expect(t.weeks.every((w) => new Date(w.t).getUTCDay() === 4)).toBe(true);
    expect(t.ok).toBe(true);
    expect(t.N).toBe(60);
    expect(leaseWarnings(t)).toEqual([]);
  });
});

describe("the unit mix", () => {
  it("rescales by largest remainder when the total changes", () => {
    expect(split(7, [10, 40, 10])).toEqual([1, 5, 1]);
    const s = setUnits(leaseDefaults(), 50);
    expect(s.mix.map((m) => m.n)).toEqual([8, 34, 8]);
    expect(s.units).toBe(50);
  });
  it("changes the total when a count changes", () => {
    expect(setCount(leaseDefaults(), 2, 20).units).toBe(70);
  });
});

describe("the CSV", () => {
  it("reads check-in and check-out, skipping the heading", () => {
    const r = parseReservationCsv("check_in,check_out\n2025-06-30,2026-05-30\r\n2025-07-06,2026-04-01\n\n");
    expect(r).toEqual({ rows: [{ checkIn: "2025-06-30", checkOut: "2026-05-30" }, { checkIn: "2025-07-06", checkOut: "2026-04-01" }] });
  });
  it("refuses a check-out not after the check-in, naming the line", () => {
    const r = parseReservationCsv("check_in,check_out\n2025-06-30,2026-05-30\n2025-07-06,2025-07-06\n");
    expect("problem" in r && r.problem).toContain("Line 3");
  });
  it("refuses a line with one date, and a date that does not exist", () => {
    expect("problem" in parseReservationCsv("2025-06-30\n2025-07-06,2026-04-01\n")).toBe(true);
    expect("problem" in parseReservationCsv("2025-02-30,2026-04-01\n2025-07-06,2026-04-01\n")).toBe(true);
  });
  it("needs at least two reservations", () => {
    expect("problem" in parseReservationCsv("check_in,check_out\n")).toBe(true);
  });
});

describe("saved data", () => {
  it("reads back missing or broken settings as the defaults", () => {
    expect(normaliseLease(null)).toEqual(leaseDefaults());
    const s = normaliseLease({ cap: "x", earliest: "2028-02-31", minback: "g9", units: 12 });
    expect(s.cap).toBe(8);
    expect(s.earliest).toBe("2028-03-01");
    expect(s.minback).toBe("g1");
    expect(s.units).toBe(12);
  });
  it("keeps only well-formed reservations", () => {
    expect(normaliseReservations([{ checkIn: "2025-01-01", checkOut: "2025-02-01" }, { checkIn: "2025-03-01", checkOut: "2025-02-01" }, "x"])).toEqual([
      { checkIn: "2025-01-01", checkOut: "2025-02-01" },
    ]);
  });
  it("works in UTC days", () => {
    expect(ud("2028-03-01")).toBe(Date.UTC(2028, 2, 1));
  });
});
