"use client";

import { useState } from "react";

/**
 * A card whose contents stay closed until asked for — for what is kept for
 * the record but rarely read, like a property's activity.
 */
export function DisclosureCard({ title, children }: { title: string; children: React.ReactNode }) {
  const [open, setOpen] = useState(false);
  return (
    <div className="border-ink-200/60 rounded-xl border bg-white p-5">
      <button
        type="button"
        onClick={() => setOpen((current) => !current)}
        aria-expanded={open}
        className="text-ink-900 hover:text-brand-700 flex w-full items-center justify-between gap-3 text-left text-[15px] font-medium"
      >
        {title}
        <span className="text-brand-700 text-[13px] font-light">{open ? "Hide" : "Show"}</span>
      </button>
      {open && <div className="mt-3">{children}</div>}
    </div>
  );
}
