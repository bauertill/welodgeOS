"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import { useEffect, useState } from "react";

import { getLastEventPath } from "~/lib/last-event";

export const navItems = [
  { href: "/", label: "Dashboard" },
  { href: "/events", label: "Events" },
  { href: "/properties", label: "Properties" },
  { href: "/clients", label: "Clients" },
] as const;

/** Sign-in lives inside the shell but without its navigation. */
export function useIsAuthRoute() {
  const pathname = usePathname();
  return pathname.startsWith("/signin") || pathname.startsWith("/signout");
}

export function Nav() {
  const pathname = usePathname();
  // Populated on mount only — the server-rendered link has to start out
  // pointing at the plain "/events" list, since localStorage doesn't exist
  // there (doc §7).
  const [lastEventPath, setLastEventPathState] = useState<string | null>(
    null,
  );

  useEffect(() => {
    setLastEventPathState(getLastEventPath());
  }, [pathname]);

  if (pathname.startsWith("/signin") || pathname.startsWith("/signout"))
    return null;

  return (
    <nav className="flex flex-col gap-1 px-3">
      {navItems.map((item) => {
        const href =
          item.href === "/events" && lastEventPath ? lastEventPath : item.href;
        const active =
          item.href === "/"
            ? pathname === "/"
            : pathname.startsWith(item.href);

        return (
          <Link
            key={item.href}
            href={href}
            aria-current={active ? "page" : undefined}
            className={`rounded-full px-4 py-2.5 text-[13px] transition-colors ${
              active
                ? "bg-brand-400 text-white"
                : "text-ink-200 hover:bg-white/10 hover:text-white"
            }`}
          >
            {item.label}
          </Link>
        );
      })}
    </nav>
  );
}
