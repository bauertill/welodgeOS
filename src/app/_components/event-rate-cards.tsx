"use client";

import { useState } from "react";

import { Button, FormError, friendlyError, Input } from "~/app/_components/form";
import { Popup } from "~/app/_components/popup";
import { RateCardEditor } from "~/app/_components/rate-card-editor";
import { scoutingStatusLabels } from "~/lib/scouting";
import { formatDate } from "~/lib/format";
import { api } from "~/trpc/react";

/**
 * Rate cards for any client, from the event's properties board (doc §4.11,
 * the owner, 2026-10-26): pick the properties — the contracted ones ticked to
 * start — and the card is made at our event rates plus the markup, to share
 * with as many clients as needed. Each answer starts its own sales request.
 */
export function EventRateCards({ eventId }: { eventId: string }) {
  const cards = api.rateCard.forEvent.useQuery({ eventId });
  const [picking, setPicking] = useState(false);
  const [open, setOpen] = useState<string | null>(null);
  const list = cards.data ?? [];

  return (
    <>
      <div className="flex flex-wrap items-center gap-x-4 gap-y-2">
        <Button type="button" variant="secondary" onClick={() => setPicking(true)}>
          + Rate card for any client
        </Button>
        {list.map((card) => (
          <button
            key={card.id}
            type="button"
            onClick={() => setOpen(card.id)}
            className="border-ink-200 hover:border-brand-400 text-ink-700 flex items-center gap-2 rounded-full border bg-white px-3 py-1.5 text-[12px]"
            title={`Made ${formatDate(card.createdAt)}`}
          >
            {card.name.replace(/ — for any client$/, "")}
            <span className="text-ink-500 font-light">
              · {card._count.properties} {card._count.properties === 1 ? "property" : "properties"}
              {card.shareToken ? " · shared" : ""}
              {card._count.responses ? ` · ${card._count.responses} ${card._count.responses === 1 ? "answer" : "answers"}` : ""}
            </span>
            {card.responses.length > 0 && <span className="rounded-full bg-[#e0234e] px-1.5 text-[10px] font-medium text-white">{card.responses.length} new</span>}
          </button>
        ))}
      </div>
      {picking && (
        <PickProperties
          eventId={eventId}
          onClose={() => setPicking(false)}
          onMade={(id) => {
            setPicking(false);
            setOpen(id);
            void cards.refetch();
          }}
        />
      )}
      {open && (
        <RateCardEditor
          id={open}
          onClose={() => {
            setOpen(null);
            void cards.refetch();
          }}
        />
      )}
    </>
  );
}

function PickProperties({ eventId, onClose, onMade }: { eventId: string; onClose: () => void; onMade: (id: string) => void }) {
  const entries = api.scouting.listForEvent.useQuery({ eventId, amenityIds: [] });
  const rows = (entries.data ?? []).filter((entry) => entry.status !== "REJECTED");
  // The contracted properties to start — what is usually put on such a card.
  const [picked, setPicked] = useState<Set<string> | null>(null);
  // Many properties on an event (the owner, 2026-10-26): find them by name, city or status.
  const [search, setSearch] = useState("");
  const words = search.trim().toLowerCase().split(/\s+/).filter(Boolean);
  const shown = rows.filter((entry) => {
    const text = `${entry.property.name} ${entry.property.city ?? ""} ${scoutingStatusLabels[entry.status]}`.toLowerCase();
    return words.every((word) => text.includes(word));
  });
  const chosen = picked ?? new Set(rows.filter((entry) => entry.status === "CONTRACTED").map((entry) => entry.property.id));
  const create = api.rateCard.create.useMutation({ onSuccess: (card) => onMade(card.id) });
  const toggle = (id: string) => {
    const next = new Set(chosen);
    if (next.has(id)) next.delete(id);
    else next.add(id);
    setPicked(next);
  };

  return (
    <Popup
      size="medium"
      title="A rate card for any client"
      subtitle="Not tied to a sales request: share its link with as many clients as you like. Each client who answers gets their own sales request."
      onClose={onClose}
    >
      <div className="space-y-4">
        {entries.isLoading ? (
          <p className="text-ink-500 text-sm font-light">Loading…</p>
        ) : rows.length === 0 ? (
          <p className="text-ink-500 text-sm font-light">No properties on this event yet.</p>
        ) : (
          <>
          <div className="flex flex-wrap items-center gap-3">
            <Input value={search} onChange={(e) => setSearch(e.target.value)} placeholder="Search by name, city or status — “contracted”, “Burbank”…" aria-label="Search properties" className="min-w-64 flex-1" autoFocus />
            <button
              type="button"
              onClick={() => setPicked(new Set([...chosen, ...shown.map((entry) => entry.property.id)]))}
              className="text-brand-700 text-[13px] hover:underline"
            >
              Tick {words.length ? "all shown" : "all"}
            </button>
            {chosen.size > 0 && (
              <button type="button" onClick={() => setPicked(new Set())} className="text-ink-500 text-[13px] hover:underline">
                Untick all
              </button>
            )}
          </div>
          {shown.length === 0 && <p className="text-ink-500 text-sm font-light">No property matches “{search.trim()}”.</p>}
          <ul className="divide-ink-200/60 max-h-[50vh] divide-y overflow-y-auto rounded-xl bg-white">
            {shown.map((entry) => {
              const rooms = entry.property.categories.length;
              return (
                <li key={entry.id}>
                  <label className="flex cursor-pointer items-center gap-3 px-4 py-2.5 text-[13px]">
                    <input type="checkbox" checked={chosen.has(entry.property.id)} onChange={() => toggle(entry.property.id)} className="accent-brand-500 h-4 w-4" />
                    <span className="text-ink-900 min-w-0 flex-1 font-medium">
                      {entry.property.name}
                      {entry.property.city && <span className="text-ink-500 ml-2 text-xs font-light">{entry.property.city}</span>}
                    </span>
                    <span className="text-ink-500 text-xs font-light">
                      {scoutingStatusLabels[entry.status]} · {rooms ? `${rooms} room ${rooms === 1 ? "type" : "types"}` : "no room types yet"}
                    </span>
                  </label>
                </li>
              );
            })}
          </ul>
          {words.length > 0 && chosen.size > shown.filter((entry) => chosen.has(entry.property.id)).length && (
            <p className="text-ink-500 text-xs font-light">Ticked properties not matching the search stay ticked.</p>
          )}
          </>
        )}
        <FormError message={create.error ? friendlyError(create.error) : null} />
        <Button type="button" disabled={chosen.size === 0 || create.isPending} onClick={() => create.mutate({ eventId, propertyIds: [...chosen] })}>
          {create.isPending ? "Making it…" : `Make the rate card (${chosen.size} ${chosen.size === 1 ? "property" : "properties"})`}
        </Button>
      </div>
    </Popup>
  );
}
