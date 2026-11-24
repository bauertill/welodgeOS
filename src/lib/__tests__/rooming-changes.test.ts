import { describe, expect, it } from "vitest";

import { changeCount, listChanges, type SubmittedStay } from "~/lib/rooming";

const stay = (id: string, over: Partial<SubmittedStay> = {}): SubmittedStay => ({
  stayId: id,
  slotId: "slot1",
  propertyId: "p1",
  property: "Hotel Carmel",
  room: "Room 1 · King",
  slotNumber: 1,
  checkIn: "2028-07-08",
  checkOut: "2028-07-31",
  guests: [{ firstName: "Ana", lastName: "Silva" }],
  arrival: null,
  notes: null,
  ...over,
});

describe("what changed between two submitted rooming lists (doc §6.9)", () => {
  it("is everything new the first time", () => {
    const changes = listChanges(null, [stay("a"), stay("b", { slotId: "slot2", room: "Room 2 · King", slotNumber: 2 })]);
    expect(changes.map((one) => one.kind)).toEqual(["new", "new"]);
    expect(changeCount(changes)).toBe("2 new");
  });

  it("names a change, a stay taken out and a new one", () => {
    const before = [stay("a"), stay("b", { slotNumber: 2, room: "Room 2 · King", slotId: "slot2" })];
    const now = [stay("a", { checkIn: "2028-07-10", arrival: "BA 283" }), stay("c", { slotNumber: 3, room: "Room 3 · King", slotId: "slot3", guests: [{ firstName: "Li", lastName: "Wei" }] })];
    const changes = listChanges(before, now);
    expect(changes.map((one) => [one.kind, one.room])).toEqual([
      ["changed", "Room 1 · King"],
      ["new", "Room 3 · King"],
      ["removed", "Room 2 · King"],
    ]);
    expect(changes[0]!.detail.join("; ")).toContain("dates:");
    expect(changes[0]!.detail.join("; ")).toContain("arriving: — → BA 283");
    expect(changeCount(changes)).toBe("1 new, 1 changed, 1 taken out");
  });

  it("finds nothing when nothing changed", () => {
    expect(listChanges([stay("a")], [stay("a")])).toEqual([]);
    expect(changeCount([])).toBe("no changes");
  });
});
