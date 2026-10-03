"use client";

import { keepPreviousData } from "@tanstack/react-query";
import Link from "next/link";
import { useEffect, useState } from "react";

import { propertyTypeLabels } from "~/lib/scouting";
import { api } from "~/trpc/react";

/**
 * "This looks like one we already have" (doc §3.1): the properties a new one
 * resembles by name, address or place on the map, each to open or to add to
 * the event instead. Saving it anyway takes saying it is a different one.
 */
export function useSimilarProperties(scouted: { name: string; address: string; latitude: string; longitude: string }) {
  const [query, setQuery] = useState(scouted);
  useEffect(() => {
    const timer = setTimeout(() => setQuery(scouted), 400);
    return () => clearTimeout(timer);
  }, [scouted.name, scouted.address, scouted.latitude, scouted.longitude]); // eslint-disable-line react-hooks/exhaustive-deps -- the values, not the object
  const number = (value: string) => (value.trim() && Number.isFinite(Number(value)) ? Number(value) : null);
  const similar = api.property.similar.useQuery(
    { name: query.name, address: query.address, latitude: number(query.latitude), longitude: number(query.longitude) },
    { enabled: query.name.trim().length >= 3 || query.address.trim().length >= 6, placeholderData: keepPreviousData },
  );
  return query.name.trim().length >= 3 || query.address.trim().length >= 6 ? (similar.data ?? []) : [];
}

export function SimilarProperties({
  matches,
  event,
  confirmed,
  onConfirmedChange,
  onUsed,
}: {
  matches: ReturnType<typeof useSimilarProperties>;
  event: { id: string; name: string } | null;
  confirmed: boolean;
  onConfirmedChange: (confirmed: boolean) => void;
  /** Once an existing one has been added to the event instead. */
  onUsed: (propertyId: string) => void;
}) {
  const utils = api.useUtils();
  const add = api.scouting.add.useMutation({
    onSuccess: (_entry, input) => {
      void utils.scouting.invalidate();
      onUsed(input.propertyId);
    },
  });
  if (matches.length === 0) return null;
  return (
    <div className="rounded-lg border border-[#f0c36d] bg-[#fff8e6] p-3 text-[13px]">
      <p className="font-medium text-[#7a5200]">
        {matches.length === 1 ? "This looks like a property we already have:" : "This looks like properties we already have:"}
      </p>
      <ul className="mt-2 space-y-2">
        {matches.map((match) => {
          const onEvent = event ? match.eventIds.includes(event.id) : false;
          return (
            <li key={match.id} className="flex flex-wrap items-center justify-between gap-2 rounded-md bg-white px-3 py-2">
              <span className="min-w-0">
                <span className="text-ink-900 font-medium">{match.name}</span>
                <span className="text-ink-500 block text-xs font-light">
                  {[propertyTypeLabels[match.type], match.address ?? match.city].filter(Boolean).join(" · ")} — {match.reason}
                </span>
              </span>
              <span className="flex items-center gap-3 text-xs">
                <Link href={`/properties/${match.id}`} target="_blank" className="text-brand-700 hover:underline">
                  Open it ↗
                </Link>
                {event &&
                  (onEvent ? (
                    <span className="text-ink-500">Already on {event.name}</span>
                  ) : (
                    <button
                      type="button"
                      disabled={add.isPending}
                      onClick={() => add.mutate({ eventId: event.id, propertyId: match.id })}
                      className="bg-brand-400 hover:bg-brand-500 rounded-full px-3 py-1 font-medium text-white"
                    >
                      Add this one to {event.name} instead
                    </button>
                  ))}
              </span>
            </li>
          );
        })}
      </ul>
      <label className="mt-3 flex items-center gap-2 text-[13px] text-[#7a5200]">
        <input type="checkbox" className="accent-brand-400 h-4 w-4" checked={confirmed} onChange={(e) => onConfirmedChange(e.target.checked)} />
        It is a different property — save it as a new one
      </label>
    </div>
  );
}
