import { describe, expect, it } from "vitest";

import { quantityText, spanEnd, unitsOf } from "~/lib/charged-per";
import { dayKey, parseDay } from "~/lib/dates";

describe("charged per night or per day", () => {
  const line = { checkIn: parseDay("2027-06-18"), checkOut: parseDay("2027-07-25") };
  it("counts nights to check-out day, and days to the last day included", () => {
    expect(unitsOf({ ...line, per: "NIGHT" })).toBe(37);
    expect(unitsOf({ ...line, per: "DAY" })).toBe(38);
    expect(unitsOf({ checkIn: line.checkIn, checkOut: line.checkIn, per: "DAY" })).toBe(1);
  });
  it("runs a day line on the stock sheet through its last day", () => {
    expect(dayKey(spanEnd({ ...line, per: "DAY" }))).toBe("2027-07-26");
    expect(dayKey(spanEnd({ ...line, per: "NIGHT" }))).toBe("2027-07-25");
  });
  it("says room-nights, room-days or both", () => {
    expect(quantityText(37, 0)).toBe("37 room-nights");
    expect(quantityText(0, 38)).toBe("38 room-days");
    expect(quantityText(120, 38)).toBe("120 room-nights · 38 room-days");
  });
});
