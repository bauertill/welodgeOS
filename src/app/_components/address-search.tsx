"use client";

import { keepPreviousData } from "@tanstack/react-query";
import { useEffect, useRef, useState } from "react";

import { Input } from "~/app/_components/form";
import { api, type RouterOutputs } from "~/trpc/react";

export type FoundPlace = NonNullable<RouterOutputs["property"]["placeDetails"]>;

/**
 * The address box, searching Google Maps as it is typed (doc §3.1): a hotel's
 * name or an address. Picking a suggestion hands back what Google knows of it;
 * anything not found is simply typed or pasted, and kept as written.
 */
export function AddressSearch({
  value,
  onChange,
  onFound,
}: {
  value: string;
  onChange: (value: string) => void;
  onFound: (place: FoundPlace) => void;
}) {
  const [open, setOpen] = useState(false);
  const [query, setQuery] = useState("");
  const [highlighted, setHighlighted] = useState(0);
  // One search session per address looked up, which Google bills as one.
  const session = useRef(newSession());
  const box = useRef<HTMLDivElement>(null);

  // Searched once typing pauses, not on every key.
  useEffect(() => {
    const timer = setTimeout(() => setQuery(value.trim()), 300);
    return () => clearTimeout(timer);
  }, [value]);

  const search = api.property.placeSearch.useQuery(
    { query, sessionToken: session.current },
    { enabled: open && query.length >= 3, placeholderData: keepPreviousData, staleTime: 60_000 },
  );
  const details = api.property.placeDetails.useMutation({
    onSuccess: (place) => {
      if (place) onFound(place);
      session.current = newSession();
    },
  });

  useEffect(() => {
    if (!open) return;
    const close = (event: MouseEvent) => {
      if (box.current && !box.current.contains(event.target as Node)) setOpen(false);
    };
    document.addEventListener("mousedown", close);
    return () => document.removeEventListener("mousedown", close);
  }, [open]);

  const suggestions = search.data?.available ? search.data.suggestions : [];
  const pick = (placeId: string) => {
    setOpen(false);
    details.mutate({ placeId, sessionToken: session.current });
  };

  return (
    <div ref={box} className="relative">
      <Input
        value={value}
        onChange={(e) => {
          onChange(e.target.value);
          setOpen(true);
          setHighlighted(0);
        }}
        onFocus={() => setOpen(true)}
        onKeyDown={(e) => {
          if (!open || suggestions.length === 0) return;
          if (e.key === "ArrowDown") {
            e.preventDefault();
            setHighlighted((index) => Math.min(index + 1, suggestions.length - 1));
          } else if (e.key === "ArrowUp") {
            e.preventDefault();
            setHighlighted((index) => Math.max(index - 1, 0));
          } else if (e.key === "Enter") {
            e.preventDefault();
            pick(suggestions[highlighted]!.placeId);
          } else if (e.key === "Escape") {
            setOpen(false);
          }
        }}
        placeholder="Search Google Maps, or type or paste the address"
        aria-label="Address"
        autoComplete="off"
      />
      {open && suggestions.length > 0 && (
        <ul className="border-ink-200 absolute z-30 mt-1 w-full overflow-hidden rounded-lg border bg-white shadow-lg" role="listbox">
          {suggestions.map((suggestion, index) => (
            <li key={suggestion.placeId} role="option" aria-selected={index === highlighted}>
              <button
                type="button"
                onMouseEnter={() => setHighlighted(index)}
                onClick={() => pick(suggestion.placeId)}
                className={`block w-full px-3 py-2 text-left text-sm ${index === highlighted ? "bg-brand-50" : ""}`}
              >
                <span className="text-ink-900">{suggestion.main}</span>
                {suggestion.secondary && <span className="text-ink-500 block text-xs font-light">{suggestion.secondary}</span>}
              </button>
            </li>
          ))}
          <li className="text-ink-400 border-ink-200/60 border-t px-3 py-1.5 text-[11px] font-light">
            From Google Maps — not there? Keep typing, or paste the address.
          </li>
        </ul>
      )}
      {details.isPending && <p className="text-ink-500 mt-1 text-xs font-light">Filling in from Google Maps…</p>}
      {search.data && !search.data.available && open && value.trim().length >= 3 && (
        <p className="text-ink-500 mt-1 text-xs font-light">
          Searching Google Maps is not switched on yet — type or paste the address.
        </p>
      )}
    </div>
  );
}

const newSession = () =>
  typeof crypto !== "undefined" && "randomUUID" in crypto ? crypto.randomUUID() : String(Math.random()).slice(2);
