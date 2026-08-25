"use client";

import Link from "next/link";

import { useIsAuthRoute } from "~/app/_components/nav";

/** Hidden on the sign-in screen, where it would just point at itself. */
export function HeaderAuth({ email }: { email: string | null }) {
  if (useIsAuthRoute()) return null;

  return email ? (
    <>
      <span className="hidden text-[13px] text-white/80 sm:inline">{email}</span>
      <Link
        href="/signout"
        className="rounded-full border border-white/25 px-5 py-2 text-[13px] font-light text-white transition-colors hover:bg-white/10"
      >
        Sign out
      </Link>
    </>
  ) : (
    <Link
      href="/signin"
      className="bg-brand-400 hover:bg-brand-500 rounded-full px-7 py-2.5 text-[13px] font-light text-white transition-colors"
    >
      Sign in
    </Link>
  );
}
