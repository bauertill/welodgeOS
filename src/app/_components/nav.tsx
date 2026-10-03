"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import { useState } from "react";

import { EventsPanel } from "~/app/_components/events-panel";
import { FinancePanel } from "~/app/_components/finance-panel";
import { SalesPanel } from "~/app/_components/sales-panel";

// Properties has no standalone section — a property belongs to the event(s)
// it is scouted for, so it is browsed and managed from inside an event's own
// tab, not as a global list (doc §3.5). Providers follow the same rule: a
// chain is reached through its properties on an event (doc §3.9).
export const navItems = [
  { href: "/", label: "Dashboard" },
  { href: "/events", label: "Events" },
  // The team's shared task board (doc §2.8).
  { href: "/tasks", label: "Tasks" },
] as const;

/**
 * The sales side (doc §4.10, §4.11) is one menu item that opens a panel, as
 * Events does: its Requests and Clients pages live under these paths.
 */
const salesPaths = ["/sales", "/clients"];

/**
 * Pages opened by people outside We Lodge — a client filling in their
 * contracting details (doc §4.11) — show none of our own menus or header.
 */
export function isPublicPath(pathname: string) {
  return pathname.startsWith("/contracting/") || pathname.startsWith("/needs/");
}

/** The team's own sidebar and header, left out on a public page. */
export function TeamChrome({ children }: { children: React.ReactNode }) {
  const pathname = usePathname();
  return isPublicPath(pathname) ? null : <>{children}</>;
}

/** Sign-in lives inside the shell but without its navigation. */
export function useIsAuthRoute() {
  const pathname = usePathname();
  return pathname.startsWith("/signin") || pathname.startsWith("/signout");
}

export function Nav() {
  const pathname = usePathname();
  const [eventsOpen, setEventsOpen] = useState(false);
  const [salesOpen, setSalesOpen] = useState(false);
  const [financeOpen, setFinanceOpen] = useState(false);

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

        <button
          type="button"
          onClick={() => setSalesOpen(true)}
          aria-current={salesPaths.some((path) => pathname.startsWith(path)) ? "page" : undefined}
          aria-haspopup="dialog"
          aria-expanded={salesOpen}
          className={itemStyles(salesPaths.some((path) => pathname.startsWith(path)))}
        >
          Sales
        </button>
        <button
          type="button"
          onClick={() => setFinanceOpen(true)}
          aria-current={pathname.startsWith("/finances") ? "page" : undefined}
          aria-haspopup="dialog"
          aria-expanded={financeOpen}
          className={itemStyles(pathname.startsWith("/finances"))}
        >
          Finances
        </button>
      </nav>

      {eventsOpen && <EventsPanel onClose={() => setEventsOpen(false)} />}
      {salesOpen && <SalesPanel onClose={() => setSalesOpen(false)} />}
      {financeOpen && <FinancePanel onClose={() => setFinanceOpen(false)} />}
    </>
  );
}
