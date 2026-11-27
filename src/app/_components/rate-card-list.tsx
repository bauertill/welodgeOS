"use client";

import Link from "next/link";
import { useState } from "react";

import { Combobox } from "~/app/_components/combobox";
import { Button, FormError, friendlyError, Input, Select } from "~/app/_components/form";
import { Popup } from "~/app/_components/popup";
import { RateCardEditor } from "~/app/_components/rate-card-editor";
import { useRemembered } from "~/lib/remembered";
import { formatDate } from "~/lib/format";
import { scoutingStatusLabels } from "~/lib/scouting";
import { api } from "~/trpc/react";

/**
 * Sales › Rate cards (the owner, 2026-11-17: "rate cards need to move … under
 * the sales tab … create rate cards, see old rate cards"): every card, newest
 * first, found by name, client or event, each opening in its popup; and
 * + New rate card — the event, the client it is sent to (or any client), and
 * the properties. On a client's page the same list shows that client's cards.
 */
export function RateCardList({ clientId, eventId: forEvent, compact = false }: { clientId?: string; eventId?: string; compact?: boolean }) {
  const [search, setSearch] = useRemembered(compact ? `rate-cards:client:${clientId}:search` : "rate-cards:search", "");
  const [eventId, setEventId] = useRemembered(compact ? `rate-cards:client:${clientId}:event` : "rate-cards:event", "", forEvent);
  const cards = api.rateCard.list.useQuery({ clientId, eventId: eventId || undefined });
  const events = api.event.list.useQuery(undefined, { enabled: !compact });
  const [open, setOpen] = useState<string | null>(null);
  const [making, setMaking] = useState(false);

  const words = search.trim().toLowerCase().split(/\s+/).filter(Boolean);
  const list = (cards.data ?? []).filter((card) => {
    const text = `${card.name} ${card.client?.name ?? "any client"} ${card.event?.name ?? ""} ${card.createdBy?.name ?? ""}`.toLowerCase();
    return words.every((word) => text.includes(word));
  });

  return (
    <div className="space-y-3">
      <div className="flex flex-wrap items-center gap-3">
        {!compact && (
          <>
            <span className="min-w-64 flex-1">
              <Input value={search} onChange={(e) => setSearch(e.target.value)} placeholder="Search by name, client, event or who made it" aria-label="Search rate cards" />
            </span>
            <span className="w-56">
              <Select value={eventId} onChange={(e) => setEventId(e.target.value)} aria-label="Event">
                <option value="">Every event</option>
                {(events.data ?? []).map((event) => (
                  <option key={event.id} value={event.id}>
                    {event.name}
                  </option>
                ))}
              </Select>
            </span>
            {(search || eventId) && (
              <button
                type="button"
                onClick={() => {
                  setSearch("");
                  setEventId("");
                }}
                className="text-ink-500 text-[13px] hover:underline"
              >
                Reset filters
              </button>
            )}
          </>
        )}
        <span className={compact ? "" : "ml-auto"}>
          <Button type="button" variant={compact ? "secondary" : "primary"} onClick={() => setMaking(true)}>
            + New rate card
          </Button>
        </span>
      </div>

      {cards.isLoading ? (
        <p className="text-ink-500 text-sm font-light">Loading…</p>
      ) : list.length === 0 ? (
        <p className="text-ink-500 text-sm font-light">{cards.data?.length ? "No rate card matches." : compact ? "No rate cards sent to this client yet." : "No rate cards yet."}</p>
      ) : (
        <div className="overflow-x-auto rounded-xl bg-white">
          <table data-row-click className="w-full text-left text-[13px]">
            <thead>
              <tr className="text-ink-500 border-ink-200/60 border-b text-[10px] tracking-wider uppercase">
                <th className="px-4 py-2.5 font-medium">Rate card</th>
                {!compact && <th className="px-3 py-2.5 font-medium">Client</th>}
                <th className="px-3 py-2.5 font-medium">Event</th>
                <th className="px-3 py-2.5 font-medium">Made</th>
                <th className="px-3 py-2.5 font-medium">Properties</th>
                <th className="px-3 py-2.5 font-medium">Link</th>
                <th className="px-3 py-2.5 font-medium">Answers</th>
              </tr>
            </thead>
            <tbody>
              {list.map((card) => (
                <tr key={card.id} className="border-ink-200/40 hover:bg-brand-50/40 border-b last:border-0">
                  <td className="px-4 py-2.5">
                    <button type="button" onClick={() => setOpen(card.id)} className="text-ink-900 hover:text-brand-700 text-left font-medium hover:underline">
                      {card.name}
                    </button>
                    {card.salesRequestId && (
                      <Link href={`/sales/${card.salesRequestId}`} className="text-brand-700 ml-2 text-xs font-light whitespace-nowrap hover:underline">
                        its request →
                      </Link>
                    )}
                  </td>
                  {!compact && (
                    <td className="px-3 py-2.5">
                      {card.client ? (
                        <Link href={`/clients/${card.client.id}`} className="text-ink-700 hover:text-brand-700 hover:underline">
                          {card.client.name}
                        </Link>
                      ) : (
                        <span className="text-ink-500 font-light">Any client</span>
                      )}
                    </td>
                  )}
                  <td className="text-ink-700 px-3 py-2.5 font-light">{card.event?.name ?? "—"}</td>
                  <td className="text-ink-500 px-3 py-2.5 font-light whitespace-nowrap">
                    {formatDate(card.createdAt)}
                    {card.createdBy?.name ? ` · ${card.createdBy.name}` : ""}
                  </td>
                  <td className="text-ink-700 px-3 py-2.5 font-light">{card._count.properties}</td>
                  <td className="px-3 py-2.5 font-light">{card.shareToken ? <span className="text-[#0a7a47]">Shared</span> : <span className="text-ink-500">Not yet</span>}</td>
                  <td className="text-ink-700 px-3 py-2.5 font-light whitespace-nowrap">
                    {card._count.responses || "—"}
                    {card.responses.length > 0 && <span className="ml-1.5 rounded-full bg-[#e0234e] px-1.5 text-[10px] font-medium text-white">{card.responses.length} new</span>}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}

      {making && (
        <NewRateCard
          clientId={clientId}
          eventId={eventId || forEvent}
          onClose={() => setMaking(false)}
          onMade={(id) => {
            setMaking(false);
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
    </div>
  );
}

/**
 * A new rate card (doc §4.11): the event, who it is sent to — a client, so it
 * is remembered on their page, or any client — and the properties, the
 * contracted ones ticked to start. Made at our event rates, or the client rates
 * of the latest card, and opened.
 */
export function NewRateCard({ clientId: givenClient, eventId: givenEvent, onClose, onMade }: { clientId?: string; eventId?: string; onClose: () => void; onMade: (id: string) => void }) {
  const events = api.event.list.useQuery();
  const clients = api.clients.list.useQuery(undefined, { enabled: !givenClient });
  const [eventId, setEventId] = useState(givenEvent ?? "");
  const [clientId, setClientId] = useState(givenClient ?? "");
  const entries = api.scouting.listForEvent.useQuery({ eventId, amenityIds: [] }, { enabled: Boolean(eventId) });
  const rows = (entries.data ?? []).filter((entry) => entry.status !== "REJECTED");
  const [picked, setPicked] = useState<Set<string> | null>(null);
  const [search, setSearch] = useState("");
  const words = search.trim().toLowerCase().split(/\s+/).filter(Boolean);
  const shown = rows.filter((entry) => {
    const text = `${entry.property.name} ${entry.property.city ?? ""} ${scoutingStatusLabels[entry.status]}`.toLowerCase();
    return words.every((word) => text.includes(word));
  });
  // The contracted properties to start — what is usually put on a card.
  const chosen = picked ?? new Set(rows.filter((entry) => entry.status === "CONTRACTED").map((entry) => entry.property.id));
  const create = api.rateCard.create.useMutation({ onSuccess: (card) => onMade(card.id) });
  const toggle = (id: string) => {
    const next = new Set(chosen);
    if (next.has(id)) next.delete(id);
    else next.add(id);
    setPicked(next);
  };

  return (
    <Popup size="medium" title="New rate card" subtitle="Which event, who it is for, and the properties on it. It opens straight after, to set the rates and the rest." onClose={onClose}>
      <div className="space-y-4">
        <div className="grid gap-3 rounded-xl bg-white p-4 sm:grid-cols-2">
          <label className="block">
            <span className="text-ink-700 mb-1 block text-[13px] font-medium">Event</span>
            <Select
              value={eventId}
              onChange={(e) => {
                setEventId(e.target.value);
                setPicked(null);
              }}
            >
              <option value="">Choose…</option>
              {(events.data ?? []).map((event) => (
                <option key={event.id} value={event.id}>
                  {event.name}
                </option>
              ))}
            </Select>
          </label>
          {!givenClient && (
            <div>
              <span className="text-ink-700 mb-1 block text-[13px] font-medium">Sent to</span>
              <Combobox
                value={clientId}
                onChange={setClientId}
                options={(clients.data ?? []).map((client) => ({ id: client.id, label: client.name, detail: client.shortName }))}
                placeholder="Any client — or type a client's name"
              />
              <span className="text-ink-500 mt-1 block text-[11px] font-light">
                {clientId ? "Kept on the client's page; their answers come back to them." : "One link for several clients — each answer starts its own sales request."}
              </span>
            </div>
          )}
        </div>

        {!eventId ? null : entries.isLoading ? (
          <p className="text-ink-500 text-sm font-light">Loading the event&apos;s properties…</p>
        ) : rows.length === 0 ? (
          <p className="text-ink-500 text-sm font-light">No properties on this event yet.</p>
        ) : (
          <>
            <div className="flex flex-wrap items-center gap-3">
              <Input value={search} onChange={(e) => setSearch(e.target.value)} placeholder="Search by name, city or status — “contracted”, “Burbank”…" aria-label="Search properties" className="min-w-64 flex-1" />
              <button type="button" onClick={() => setPicked(new Set([...chosen, ...shown.map((entry) => entry.property.id)]))} className="text-brand-700 text-[13px] hover:underline">
                Tick {words.length ? "all shown" : "all"}
              </button>
              {chosen.size > 0 && (
                <button type="button" onClick={() => setPicked(new Set())} className="text-ink-500 text-[13px] hover:underline">
                  Untick all
                </button>
              )}
            </div>
            {shown.length === 0 && <p className="text-ink-500 text-sm font-light">No property matches “{search.trim()}”.</p>}
            <ul className="divide-ink-200/60 max-h-[45vh] divide-y overflow-y-auto rounded-xl bg-white">
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
          </>
        )}
        <FormError message={create.error ? friendlyError(create.error) : null} />
        <Button
          type="button"
          disabled={!eventId || chosen.size === 0 || create.isPending}
          onClick={() => create.mutate({ eventId, clientId: clientId || null, propertyIds: [...chosen] })}
        >
          {create.isPending ? "Making it…" : `Make the rate card (${chosen.size} ${chosen.size === 1 ? "property" : "properties"})`}
        </Button>
      </div>
    </Popup>
  );
}
