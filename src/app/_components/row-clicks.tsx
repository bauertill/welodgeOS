"use client";

import { useEffect } from "react";

/**
 * Click anywhere on a board's row to open it (the owner, 2026-11-27: "it's much
 * faster to just click on the row instead of getting the name exactly"). On a
 * table marked `data-row-click`, a click on a row that is not on a link,
 * button, box or menu of its own opens what the row's name opens — the element
 * marked `data-row-open`, else the first link or button in its first cell, else
 * its first link. Cmd/Ctrl-click opens a link in a new tab, as on the name.
 * Selecting text does not open anything.
 */
export function RowClicks() {
  useEffect(() => {
    const onClick = (e: MouseEvent) => {
      if (e.defaultPrevented || e.button !== 0) return;
      const target = e.target as HTMLElement | null;
      const row = target?.closest("tr");
      if (!row || !row.closest("table[data-row-click]") || row.closest("thead")) return;
      if (target!.closest("a, button, input, select, textarea, label, summary, [role=button], [data-no-row-click]")) return;
      if (window.getSelection()?.toString()) return;
      const open =
        row.querySelector<HTMLElement>("[data-row-open]") ??
        row.cells[0]?.querySelector<HTMLElement>("a[href], button:not([disabled])") ??
        row.querySelector<HTMLElement>("a[href]");
      if (!open) return;
      open.dispatchEvent(new MouseEvent("click", { bubbles: true, cancelable: true, metaKey: e.metaKey, ctrlKey: e.ctrlKey, shiftKey: e.shiftKey }));
    };
    document.addEventListener("click", onClick);
    return () => document.removeEventListener("click", onClick);
  }, []);
  return null;
}
