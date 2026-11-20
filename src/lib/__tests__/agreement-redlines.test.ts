import { describe, expect, it } from "vitest";

import { applyRedlines, readRedlines, type WordUnit } from "~/lib/agreement-redlines";

const text = ["= AGREEMENT", "[[contents]]", "# 1. PAYMENT", "1.1 The Client pays **in full** by [missing: the date].", "1.2 Late payment is charged.", "| Room | Nights |", "| Double | 10 |", "@sign For We Lodge by Volki | CEO"].join("\n");

const p = (original: string, accepted = original, comments: WordUnit["comments"] = []): WordUnit => ({ original: [[original]], accepted: [[accepted]], table: false, comments });
const row = (original: string[], accepted = original): WordUnit => ({ original: original.map((c) => [c]), accepted: accepted.map((c) => [c]), table: true, comments: [] });
/** The draft as we send it, before anyone touches it. */
const draft = (): WordUnit[] => [
  p("AGREEMENT"),
  p("CONTENTS"),
  p("1. PAYMENT"),
  p(""),
  p("1. PAYMENT"),
  p("1.1\tThe Client pays in full by missing: the date."),
  p("1.2\tLate payment is charged."),
  row(["Room", "Nights"]),
  row(["Double", "10"]),
  { original: [["", "For We Lodge by Volki", "CEO"], ["", "DATE"]], accepted: [["", "For We Lodge by Volki", "CEO"], ["", "DATE"]], table: true, comments: [] },
];

describe("reading redlines", () => {
  it("finds nothing in an untouched draft", () => {
    const reading = readRedlines(text, draft());
    expect(reading.changes).toEqual([]);
    expect(reading.matched).toBe(reading.total);
  });

  it("takes a tracked change, keeping the number, bold and open gaps", () => {
    const units = draft();
    units[5] = p("1.1\tThe Client pays in full by missing: the date.", "1.1\tThe Client pays in full within 30 days by missing: the date.");
    const reading = readRedlines(text, units);
    expect(reading.changes).toHaveLength(1);
    expect(reading.changes[0]!.lines).toEqual(["1.1 The Client pays **in full** within 30 days by [missing: the date]."]);
    expect(applyRedlines(text, reading.changes)).toContain("1.1 The Client pays **in full** within 30 days by [missing: the date].");
  });

  it("takes a struck-out paragraph, an added one and a changed table cell", () => {
    const units = draft();
    units[6] = p("1.2\tLate payment is charged.", "");
    units.splice(7, 0, p("", "1.3\tInterest is 2% a month."));
    units[9] = row(["Double", "10"], ["Double", "12"]);
    const reading = readRedlines(text, units);
    expect(reading.changes.map((c) => c.kind).sort()).toEqual(["change", "delete", "insert"]);
    const after = applyRedlines(text, reading.changes).split("\n");
    expect(after).not.toContain("1.2 Late payment is charged.");
    expect(after).toContain("1.3 Interest is 2% a month.");
    expect(after).toContain("| Double | 12 |");
  });

  it("sees an edit made without tracking as a change", () => {
    const units = draft();
    units[6] = p("1.2\tLate payment is not charged.");
    const reading = readRedlines(text, units);
    expect(reading.changes).toHaveLength(1);
    expect(reading.changes[0]!.lines).toEqual(["1.2 Late payment is not charged."]);
  });

  it("lists a comment on unchanged text to answer", () => {
    const units = draft();
    units[6] = p("1.2\tLate payment is charged.", undefined, [{ author: "Jane", text: "How much?" }]);
    const reading = readRedlines(text, units);
    expect(reading.changes).toEqual([]);
    expect(reading.comments).toEqual([{ where: "1. PAYMENT", on: "1.2 Late payment is charged.", author: "Jane", text: "How much?" }]);
  });
});
