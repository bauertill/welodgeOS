import { describe, expect, it } from "vitest";

import { addMonths, basis, compute, defaults, facts, gen, iso, lede, normalise, NPM, pageTitle, regen, setStay, setTotal, split, ud } from "~/lib/stagger-model";

const full = () => {
  const c = compute(defaults());
  if (c.empty) throw new Error("empty");
  return c;
};

describe("dates", () => {
  it("clamps addMonths to the month's end", () => {
    expect(iso(addMonths(ud("2028-01-31"), 1))).toBe("2028-02-29");
    expect(iso(addMonths(ud("2027-01-31"), 1))).toBe("2027-02-28");
    expect(iso(addMonths(ud("2028-03-15"), 6))).toBe("2028-09-15");
  });
});

describe("split", () => {
  it("spreads by largest remainder, ties to the earlier", () => {
    expect(split(50, [1, 1, 1, 1, 1, 1])).toEqual([9, 9, 8, 8, 8, 8]);
    expect(split(50, [20, 80])).toEqual([10, 40]);
    expect(split(10, [1, 1, 1])).toEqual([4, 3, 3]);
    expect(split(5, [0, 0])).toEqual([3, 2]);
  });
});

describe("the default 50-unit scenario", () => {
  it("arrives in waves of 9, 9, 8, 8, 8, 8 a fortnight apart from Mar 1, 2028", () => {
    const s = defaults();
    expect(s.rows.map((r) => r.units)).toEqual([9, 9, 8, 8, 8, 8]);
    expect(s.rows.map((r) => r.date)).toEqual(["2028-03-01", "2028-03-15", "2028-03-29", "2028-04-12", "2028-04-26", "2028-05-10"]);
  });

  it("departs Sep 1 to Nov 10", () => {
    const c = full();
    expect(iso(c.minD)).toBe("2028-09-01");
    expect(iso(c.maxD)).toBe("2028-11-10");
  });

  it("is 10 studios, 40 one-beds and 300 lease months", () => {
    const c = full();
    expect(c.counts).toEqual([10, 40]);
    expect(c.unitMonths).toBe(300);
  });

  it("blends to $4,400 a month (≈ $144.66 a night) and $1,320,000 in all", () => {
    const c = full();
    expect(c.rateEff).toBe(4400);
    expect(Math.round((c.rateEff / NPM) * 100) / 100).toBe(144.66);
    expect(c.totalRent).toBe(1320000);
  });

  it("spreads the rent by day so the months add up to the total", () => {
    const c = full();
    const sum = c.months.reduce((t, m) => t + m.rent, 0);
    expect(sum).toBeCloseTo(1320000, 6);
    // March: wave 1 all month, wave 2 from the 15th, wave 3 from the 29th — each lease month split by its days.
    const march = c.months.find((m) => iso(m.m) === "2028-03-01")!;
    expect(march.arr).toBe(26);
  });

  it("is in-house for nights arrival ≤ d < departure", () => {
    const c = full();
    const day = (d: string) => Math.round((ud(d).getTime() - c.start.getTime()) / 86400000);
    expect(c.occ[day("2028-02-29")]).toBe(0);
    expect(c.occ[day("2028-03-01")]).toBe(9);
    expect(c.occ[day("2028-08-31")]).toBe(50);
    expect(c.occ[day("2028-09-01")]).toBe(41);
    expect(c.occ[day("2028-11-10")]).toBe(0);
  });
});

describe("lede and figures", () => {
  it("tells the staggered story and keeps three figures", () => {
    const c = full();
    expect(lede(c)).toBe("We take 50 apartments for 6 months, with staggered arrivals and departures. Move-ins run from Mar 1 to May 10, 2028 and hand-backs from Sep 1 to Nov 10, 2028.");
    expect(facts(c, { showRent: true }, "Decron").map((f) => f.small)).toEqual(["apartments across 6 waves", "lease months", "gross rent to Decron"]);
    expect(facts(c, { showRent: false }, "Decron")).toHaveLength(2);
    expect(basis().map((b) => b.label)).toEqual(["Scenario", "Hand-back"]);
    expect(pageTitle("Decron Properties")).toBe("Decron Apartments OBS");
  });
});

describe("scenarios saved with 2-beds", () => {
  it("drops the 2-bed share and rent without failing", () => {
    const old = { ...defaults(), mix: { studio: 20, one: 60, two: 20 }, rates: { studio: 4000, one: 4500, two: 5500 } };
    const s = normalise(JSON.parse(JSON.stringify(old)));
    expect(s.mix).toEqual({ studio: 20, one: 60 });
    expect(s.rates).toEqual({ studio: 4000, one: 4500 });
    const c = compute(s);
    if (c.empty) throw new Error("empty");
    expect(c.counts).toEqual([13, 37]);
  });
});

describe("the generator's rules", () => {
  it("changing only the total keeps the dates and rescales", () => {
    const s = setTotal(defaults(), 100);
    expect(s.rows.map((r) => r.date)).toEqual(defaults().rows.map((r) => r.date));
    expect(s.rows.map((r) => r.units)).toEqual([18, 18, 16, 16, 16, 16]);
  });
  it("changing waves or gap rebuilds evenly", () => {
    const s = regen({ ...defaults(), waves: 5, gap: 7 });
    expect(s.rows.map((r) => r.units)).toEqual([10, 10, 10, 10, 10]);
    expect(s.rows.map((r) => r.date)).toEqual(gen({ units: 50, waves: 5, first: "2028-03-01", gap: 7, stay: 6 }).map((r) => r.date));
    expect(s.rows[4]!.date).toBe("2028-03-29");
  });
  it("changing the stay applies to every wave", () => {
    expect(setStay(defaults(), 4).rows.every((r) => r.stay === 4)).toBe(true);
  });
});
