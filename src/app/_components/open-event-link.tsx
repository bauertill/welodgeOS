"use client";

import Link from "next/link";

import { eventHref, markEventOpened } from "~/lib/event-start";
import { api } from "~/trpc/react";

/**
 * A link that opens an event (doc §3.10): on the person's start tab —
 * Properties unless they chose another — noting the open, so a habit of
 * going straight to another tab can be noticed.
 */
export function OpenEventLink({ eventId, className, onClick, children }: { eventId: string; className?: string; onClick?: () => void; children: React.ReactNode }) {
  const me = api.user.me.useQuery(undefined, { staleTime: 60_000 });
  return (
    <Link
      href={eventHref(eventId, me.data?.eventStartTab)}
      onClick={() => {
        markEventOpened(eventId);
        onClick?.();
      }}
      className={className}
    >
      {children}
    </Link>
  );
}
