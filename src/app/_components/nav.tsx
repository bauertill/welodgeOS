"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import { useState } from "react";

import { EventsPanel } from "~/app/_components/events-panel";

// Properties has no standalone section — a property belongs to the event(s)
// it is scouted for, so it is browsed and managed from inside an event's own
// tab, not as a global list (doc §3.5).
export const navItems = [
  { href: "/", label: "Dashboard" },
  { href: "/events", label: "Events" },
  { href: "/clients", label: "Clients" },
] as const;

/** Sign-in lives inside the shell but without its navigation. */
export function useIsAuthRoute() {
  const pathname = usePathname();
  return pathname.startsWith("/signin") || pathname.startsWith("/signout");
}

export function Nav() {
  const pathname = usePathname();
  const [eventsOpen, setEventsOpen] = useState(false);

  if (pathname.startsWith("/signin") || pathname.startsWith("/signout"))
    return null;

  const itemStyles = (active: boolean) =>
    `rounded-full px-4 py-2.5 text-left text-[13px] transition-colors ${
      active
        ? "bg-brand-400 text-white"
        : "text-ink-200 hover:bg-white/10 hover:text-white"
    }`;

  return (
    <>
      <nav className="flex flex-col gap-1 px-3">
        {navItems.map((item) => {
          const active =
            item.href === "/"
              ? pathname === "/"
              : pathname.startsWith(item.href);

          // Events opens a panel rather than navigating: switching event
          // should not cost you the page you are on.
          if (item.href === "/events") {
            return (
              <button
                key={item.href}
                type="button"
                onClick={() => setEventsOpen(true)}
                aria-current={active ? "page" : undefined}
                aria-haspopup="dialog"
                aria-expanded={eventsOpen}
                className={itemStyles(active)}
              >
                {item.label}
              </button>
            );
          }

          return (
            <Link
              key={item.href}
              href={item.href}
              aria-current={active ? "page" : undefined}
              className={itemStyles(active)}
            >
              {item.label}
            </Link>
          );
        })}
      </nav>

      {eventsOpen && <EventsPanel onClose={() => setEventsOpen(false)} />}
    </>
  );
}
