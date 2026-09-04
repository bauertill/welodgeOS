"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";

/**
 * An event is read in four ways, matching the phases of the business: what we
 * could contract, what we hold and have promised, what runs out soon, and where
 * that leaves us commercially.
 */
const tabs = [
  { slug: "", label: "Scouting", hint: "What could we contract" },
  { slug: "inventory", label: "Inventory", hint: "What we hold and what we promised" },
  { slug: "deadlines", label: "Deadlines", hint: "What runs out soon" },
  { slug: "position", label: "Position", hint: "Where we are exposed" },
] as const;

export function EventTabs({ eventId }: { eventId: string }) {
  const pathname = usePathname();
  const base = `/events/${eventId}`;

  return (
    <nav className="border-ink-200/60 mb-6 flex flex-wrap gap-1 border-b">
      {tabs.map((tab) => {
        const href = tab.slug ? `${base}/${tab.slug}` : base;
        const active = pathname === href;
        return (
          <Link
            key={tab.slug}
            href={href}
            title={tab.hint}
            aria-current={active ? "page" : undefined}
            className={`-mb-px border-b-2 px-4 py-2.5 text-[13px] transition-colors ${
              active
                ? "border-brand-400 text-ink-900 font-medium"
                : "text-ink-500 hover:text-ink-900 border-transparent font-light"
            }`}
          >
            {tab.label}
          </Link>
        );
      })}
    </nav>
  );
}
