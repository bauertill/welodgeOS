"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import { useEffect, useState } from "react";

import { clearEventHistory, dismissStartTab, eventTabLabels, isEventTab, noteEventTab, suggestedStartTab, type EventTabSlug } from "~/lib/event-start";
import { setLastEventPath } from "~/lib/last-event";
import { api } from "~/trpc/react";

/**
 * An event is read in four ways: what we could contract, what we hold and have
 * promised, what runs out soon, and where that leaves us commercially.
 *
 * The Contracts tab is hidden for now (owner, 2026-10-02) — its page still
 * exists at /contracts, to come back to; a hotel's contracts live on the
 * property's page meanwhile, a client's on their sales request.
 */
const tabs = [
  { slug: "", label: "Properties", hint: "What could we contract" },
  { slug: "inventory", label: "Inventory", hint: "What we hold and what we promised" },
  { slug: "deadlines", label: "Deadlines", hint: "What runs out soon" },
  { slug: "position", label: "Position", hint: "Where we are exposed" },
  // Last since 2026-10-13: set up once, rarely read.
  { slug: "details", label: "Event details", hint: "The event, its team and its places of interest" },
] as const;

export function EventTabs({ eventId }: { eventId: string }) {
  const pathname = usePathname();
  const base = `/events/${eventId}`;
  const utils = api.useUtils();
  const me = api.user.me.useQuery(undefined, { staleTime: 60_000 });
  const chosen = me.data?.eventStartTab;
  const start: EventTabSlug = isEventTab(chosen) ? chosen : "";
  const [offer, setOffer] = useState<EventTabSlug | null>(null);
  const setStart = api.user.setEventStartTab.useMutation({
    onSuccess: () => {
      clearEventHistory();
      setOffer(null);
      void utils.user.me.invalidate();
    },
  });

  useEffect(() => {
    setLastEventPath(pathname);
    // Where an opened event landed, then the first tab gone to from there (doc §3.10).
    const slug = pathname === base ? "" : pathname.slice(base.length + 1).split("/")[0];
    if (isEventTab(slug)) noteEventTab(eventId, slug);
    if (me.data) setOffer(suggestedStartTab(start));
  }, [pathname, base, eventId, me.data, start]);

  return (
    <>
    {offer !== null && (
      <div className="border-brand-200 bg-brand-50 mb-4 flex flex-wrap items-center gap-x-4 gap-y-2 rounded-xl border px-4 py-2.5 text-[13px]">
        <span className="text-ink-900">
          You usually go straight to <strong className="font-medium">{eventTabLabels[offer]}</strong>. Open events on {eventTabLabels[offer]} from now on?
        </span>
        <span className="ml-auto flex items-center gap-3">
          <button
            type="button"
            disabled={setStart.isPending}
            onClick={() => setStart.mutate({ tab: offer })}
            className="bg-brand-400 hover:bg-brand-500 rounded-full px-3.5 py-1.5 text-xs font-medium text-white"
          >
            Yes, start on {eventTabLabels[offer]}
          </button>
          <button
            type="button"
            onClick={() => {
              dismissStartTab(offer);
              setOffer(null);
            }}
            className="text-ink-500 text-xs hover:underline"
          >
            No, thanks
          </button>
        </span>
      </div>
    )}
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
    </>
  );
}
