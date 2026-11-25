import { describe, expect, it } from "vitest";

import { placeInColumn } from "~/lib/task-order";

describe("a Kanban column's new order", () => {
  it("is the order shown when everything is shown", () => {
    expect(placeInColumn(["a", "b", "c"], ["c", "a", "b"])).toEqual(["c", "a", "b"]);
  });
  it("keeps a hidden card just after the card it followed", () => {
    // x follows a, y leads: moving a to the end takes x with it, y stays on top.
    expect(placeInColumn(["y", "a", "x", "b", "c"], ["b", "c", "a"])).toEqual(["y", "b", "c", "a", "x"]);
  });
  it("leaves out ids no longer in the column, and repeats", () => {
    expect(placeInColumn(["a", "b"], ["b", "gone", "a", "b"])).toEqual(["b", "a"]);
  });
});
