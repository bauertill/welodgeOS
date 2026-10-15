"use client";

import { useState } from "react";
import { createPortal } from "react-dom";

/**
 * A small "i" that explains something on hover or focus, instead of a line of
 * text on the page. The explanation floats over the page, so a table's frame
 * never cuts it off.
 */
export function InfoTip({ text }: { text: string }) {
  const [at, setAt] = useState<{ left: number; top: number } | null>(null);
  const show = (e: React.SyntheticEvent<HTMLElement>) => {
    const box = e.currentTarget.getBoundingClientRect();
    setAt({ left: Math.max(8, Math.min(box.left - 8, window.innerWidth - 256)), top: box.top - 6 });
  };
  return (
    <span className="inline-flex align-middle">
      <button
        type="button"
        aria-label={text}
        onClick={(e) => e.preventDefault()}
        onMouseEnter={show}
        onFocus={show}
        onMouseLeave={() => setAt(null)}
        onBlur={() => setAt(null)}
        className="border-ink-300 text-ink-500 hover:border-brand-400 hover:text-brand-700 focus:border-brand-400 ml-1 inline-flex h-3.5 w-3.5 items-center justify-center rounded-full border text-[9px] leading-none font-semibold normal-case"
      >
        i
      </button>
      {at &&
        createPortal(
          <span
            role="tooltip"
            style={{ left: at.left, top: at.top }}
            className="bg-ink-900 pointer-events-none fixed z-[1100] w-60 -translate-y-full rounded-md px-2.5 py-1.5 text-[11px] leading-snug font-light tracking-normal whitespace-normal text-white normal-case shadow-lg"
          >
            {text}
          </span>,
          document.body,
        )}
    </span>
  );
}
