"use client";

import { useEffect, useState } from "react";

/**
 * The working side of a property's page, as tabs rather than a stack of cards
 * (doc §3.10): updates first, then the room categories, quotations, contracts
 * and the log. The address's #hash names the tab, so a link can open one —
 * the Properties tab's "2 quotations" opens #quotations.
 */
export function PropertyTabs({
  tabs,
}: {
  tabs: { key: string; label: string; count?: number | null; highlight?: boolean; content: React.ReactNode }[];
}) {
  const [active, setActive] = useState(tabs[0]!.key);

  useEffect(() => {
    const fromHash = window.location.hash.slice(1);
    if (tabs.some((tab) => tab.key === fromHash)) setActive(fromHash);
    // Only on arrival: afterwards the tab is chosen by clicking.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const choose = (key: string) => {
    setActive(key);
    window.history.replaceState(null, "", `#${key}`);
  };

  return (
    <div className="border-ink-200/60 rounded-xl border bg-white">
      <div role="tablist" className="border-ink-200/60 flex gap-1 overflow-x-auto border-b px-3 pt-3">
        {tabs.map((tab) => {
          const selected = tab.key === active;
          return (
            <button
              key={tab.key}
              type="button"
              role="tab"
              aria-selected={selected}
              onClick={() => choose(tab.key)}
              className={`-mb-px flex items-center gap-1.5 rounded-t-lg border-b-2 px-3 pt-1.5 pb-2.5 text-[13px] whitespace-nowrap transition-colors ${
                selected
                  ? tab.highlight
                    ? "border-brand-400 text-brand-800 font-medium"
                    : "border-ink-900 text-ink-900 font-medium"
                  : "text-ink-500 hover:text-ink-900 border-transparent font-light"
              }`}
            >
              {tab.label}
              {tab.count != null && tab.count > 0 && (
                <span
                  className={`rounded-full px-1.5 text-[11px] leading-[18px] ${
                    tab.highlight ? "bg-brand-100 text-brand-800" : "bg-ink-50 text-ink-500"
                  }`}
                >
                  {tab.count}
                </span>
              )}
            </button>
          );
        })}
      </div>
      {tabs.map((tab) => (
        // Kept mounted, only hidden: a half-typed quotation or update
        // survives a look at another tab.
        <div key={tab.key} role="tabpanel" hidden={tab.key !== active} className="p-5">
          {tab.content}
        </div>
      ))}
    </div>
  );
}
