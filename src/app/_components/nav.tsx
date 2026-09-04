"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";

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

  if (pathname.startsWith("/signin") || pathname.startsWith("/signout"))
    return null;

  return (
    <nav className="flex flex-col gap-1 px-3">
      {navItems.map((item) => {
        const active =
          item.href === "/"
            ? pathname === "/"
            : pathname.startsWith(item.href);

        return (
          <Link
            key={item.href}
            href={item.href}
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
