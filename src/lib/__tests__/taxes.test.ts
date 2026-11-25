import { describe, expect, it } from "vitest";

import { extrasLabel, ExtrasLabel } from "~/lib/taxes";

describe("what the amounts on top of a quotation are called (doc §3.10)", () => {
  it("names one by its own name", () => {
    expect(extrasLabel([{ kind: "OTHER", label: "International Bank Transfer" }])).toBe("International Bank Transfer");
    expect(ExtrasLabel([{ kind: "OCCUPANCY", label: null }])).toBe("Occupancy tax (TOT)");
  });
  it("says taxes, fees, or taxes and fees", () => {
    expect(extrasLabel([{ kind: "OCCUPANCY", label: null }, { kind: "CITY", label: null }])).toBe("taxes");
    expect(extrasLabel([{ kind: "SERVICE_CHARGE", label: null }, { kind: "OTHER", label: "International Bank Transfer" }])).toBe("fees");
    expect(ExtrasLabel([{ kind: "ISS", label: null }, { kind: "OTHER", label: "International Bank Transfer" }])).toBe("Taxes and fees");
    expect(extrasLabel([{ kind: "OTHER", label: "Taxa de turismo" }, { kind: "VAT", label: null }])).toBe("taxes");
  });
});
