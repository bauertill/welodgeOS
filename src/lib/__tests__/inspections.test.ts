import { describe, expect, it } from "vitest";

import { blocksCheckIn, checklistInput, missingText, readinessOf, standardChecklist } from "~/lib/inspections";

describe("apartment readiness (doc §6.10)", () => {
  it("follows the inspection until it is done", () => {
    expect(readinessOf(null, [])).toBe("NOT_PLANNED");
    expect(readinessOf({ status: "PLANNED" }, [])).toBe("PLANNED");
    expect(readinessOf({ status: "IN_PROGRESS" }, [])).toBe("IN_PROGRESS");
    expect(readinessOf({ status: "DONE" }, [])).toBe("READY");
  });

  it("is held back by fix-before-check-in and unjudged defects only", () => {
    expect(readinessOf({ status: "DONE" }, [{ severity: "MUST_FIX", status: "OPEN" }, { severity: "DOCUMENT", status: "OPEN" }])).toBe("READY");
    expect(readinessOf({ status: "DONE" }, [{ severity: "BEFORE_CHECK_IN", status: "OPEN" }])).toBe("TO_FIX");
    expect(readinessOf({ status: "DONE" }, [{ severity: "NOT_SURE", status: "OPEN" }])).toBe("TO_FIX");
    expect(readinessOf({ status: "DONE" }, [{ severity: "BEFORE_CHECK_IN", status: "FIXED" }])).toBe("TO_CHECK");
    expect(readinessOf({ status: "DONE" }, [{ severity: "BEFORE_CHECK_IN", status: "CHECKED" }])).toBe("READY");
    expect(blocksCheckIn({ severity: "NOT_SURE", status: "CHECKED" })).toBe(false);
  });

  it("writes a missing item for the defect", () => {
    expect(missingText("Knives", 2, "Kitchen")).toBe("2 missing Knives (Kitchen)");
    expect(missingText("Room slippers ( 4 )", 1, "Entrance")).toBe("1 missing Room slippers (Entrance)");
  });

  it("starts from a valid standard checklist", () => {
    const sections = standardChecklist();
    expect(checklistInput.safeParse(sections).success).toBe(true);
    expect(sections.some((section) => section.kind === "facility")).toBe(true);
    expect(sections.some((section) => section.kind === "inventory" && section.items.some((item) => item.label === "Knives" && item.expected === 4))).toBe(true);
  });
});
