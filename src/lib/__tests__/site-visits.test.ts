import { describe, expect, it } from "vitest";

import { glanceLabels, glanceRow, readRows } from "~/lib/site-visits";

describe("site visit reports", () => {
  it("reads back only well-formed rows", () => {
    expect(readRows([{ label: "Sleeps", value: "4" }, { label: "" }, "x"], glanceRow)).toEqual([{ label: "Sleeps", value: "4" }]);
    expect(readRows(null, glanceRow)).toEqual([]);
  });
  it("lines up the side-by-side by every label used, in order, skipping empty ones", () => {
    const units = [
      { glance: [{ label: "Building", value: "1540 6th St" }, { label: "Outdoor", value: "" }] },
      { glance: [{ label: "Sleeps", value: "4" }, { label: "Building", value: "Living at SM" }, { label: "Outdoor", value: "None" }] },
    ];
    expect(glanceLabels(units)).toEqual(["Building", "Sleeps", "Outdoor"]);
  });
});
