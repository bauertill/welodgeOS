"use client";

import { useEffect, useState } from "react";

import { Button, Field, FormError, friendlyError, Input, Textarea } from "~/app/_components/form";
import { Popup } from "~/app/_components/popup";
import { Card } from "~/app/_components/ui";
import { parseDay } from "~/lib/dates";
import { formatDate, formatRange } from "~/lib/format";
import { changeCount, isExtraKey, roomingExtraFields, type Guest, type ListChange, type RoomingExtraKey } from "~/lib/rooming";
import { cellDate, cellText, readSheetFile, type Cell, type ReadSheet } from "~/lib/sheet-read";
import { api, type RouterInputs, type RouterOutputs } from "~/trpc/react";

/**
 * The rooming list (doc §6.9): every room the client bought, with its dates,
 * and who sleeps in it. The client fills it in by their link; the team sees
 * and edits the same list on the sales request, numbers the rooms, downloads
 * each property's list for it, and sees what changed since it was sent.
 */

type List = RouterOutputs["rooming"]["forRequest"];
type Property = List["properties"][number];
type Room = Property["rooms"][number];
type Stay = Room["stays"][number];
type Mode = { token: string; salesRequestId?: undefined } | { salesRequestId: string; token?: undefined };

const range = (from: string, to: string) => formatRange(parseDay(from), parseDay(to));
const name = (guest: { firstName: string; lastName: string }) => [guest.firstName, guest.lastName].filter(Boolean).join(" ");

function useRooming(mode: Mode) {
  const utils = api.useUtils();
  const team = api.rooming.forRequest.useQuery({ salesRequestId: mode.salesRequestId ?? "" }, { enabled: Boolean(mode.salesRequestId) });
  const shared = api.rooming.shared.useQuery({ token: mode.token ?? "" }, { enabled: Boolean(mode.token), retry: false, refetchOnWindowFocus: false });
  const refresh = () => {
    void utils.rooming.invalidate();
    if (mode.salesRequestId) void utils.audit.invalidate();
  };
  const saveTeam = api.rooming.saveStay.useMutation({ onSuccess: refresh });
  const saveLink = api.rooming.saveStayByLink.useMutation({ onSuccess: refresh });
  const removeTeam = api.rooming.removeStay.useMutation({ onSuccess: refresh });
  const removeLink = api.rooming.removeStayByLink.useMutation({ onSuccess: refresh });
  type StayFields = { id?: string; slotId: string; checkIn: string; checkOut: string; guests: Guest[]; arrival: string; notes: string };
  return {
    data: (mode.salesRequestId ? team.data : shared.data) as (Omit<List, "token" | "madeAt"> & Partial<Pick<List, "token" | "madeAt">>) | undefined,
    error: mode.token ? shared.error : team.error,
    save: (stay: StayFields) => (mode.salesRequestId ? saveTeam.mutateAsync({ salesRequestId: mode.salesRequestId, ...stay }) : saveLink.mutateAsync({ token: mode.token!, ...stay })),
    remove: (stayId: string) => (mode.salesRequestId ? removeTeam.mutateAsync({ salesRequestId: mode.salesRequestId, stayId }) : removeLink.mutateAsync({ token: mode.token!, stayId })),
  };
}

export function RoomingList(mode: Mode) {
  const rooming = useRooming(mode);
  const team = Boolean(mode.salesRequestId);
  const [importing, setImporting] = useState(false);
  if (rooming.error && mode.token) {
    return (
      <Card className="text-center">
        <h1 className="text-ink-900 text-lg font-medium">This rooming list is not shared any more</h1>
        <p className="text-ink-500 mt-2 text-sm font-light">Please ask your contact at We Lodge for the latest link.</p>
      </Card>
    );
  }
  if (!rooming.data) return <p className="text-ink-500 text-sm font-light">Loading…</p>;
  const { properties } = rooming.data;
  const fields = roomingExtraFields.filter((field) => rooming.data!.fields.includes(field.key));
  const allRooms = properties.flatMap((property) => property.rooms);
  const nights = allRooms.reduce((sum, room) => sum + room.nights, 0);
  const named = allRooms.reduce((sum, room) => sum + room.named, 0);
  const asked = allRooms.flatMap((room) => room.stays).filter((stay) => !stay.removed && stay.extraNights > 0);
  const askedNights = asked.reduce((sum, stay) => sum + stay.extraNights, 0);

  if (mode.token) {
    return (
      <>
        <Submissions mode={mode} />
        <ClientRoomingView properties={properties} rooming={rooming} fields={fields} onUpload={() => setImporting(true)} />
        {importing && (
          <ImportSheet
            mode={mode}
            year={rooming.data.event ? new Date(rooming.data.event.startDate).getUTCFullYear() : new Date().getUTCFullYear()}
            multipleProperties={properties.length > 1}
            extras={fields}
            onClose={() => setImporting(false)}
          />
        )}
      </>
    );
  }

  if (!properties.length) {
    return (
      <Card>
        <p className="text-ink-500 text-sm font-light">
          {team ? "No rooms sold to the client at this event yet — the rooming list is made from the rooms they bought." : "Your rooms will show here once they are confirmed."}
        </p>
      </Card>
    );
  }

  return (
    <div className="space-y-5">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div className="text-ink-700 text-[13px] font-light">
          <p>
            <span className="text-ink-900 font-medium">
              {named} of {nights} booked nights named
            </span>{" "}
            across {allRooms.length} rooms
            {named > 0 && named < nights && (
              <>
                {" "}
                · <span className="text-[#8a5a00]">{nights - named} booked nights with nobody in them</span>
              </>
            )}
            {askedNights > 0 && (
              <>
                {" "}
                · <span className="font-medium text-[#2a4f9c]">{askedNights} extra nights asked for</span>
              </>
            )}
            .
          </p>
          <p className="text-ink-500 text-xs">Type straight into the sheet — each row saves when you leave it. Dates beyond a room&rsquo;s booking ask us for the extra nights.</p>
        </div>
        <button
          type="button"
          onClick={() => setImporting(true)}
          className="border-brand-300 text-brand-700 hover:bg-brand-50 rounded-full border bg-white px-4 py-1.5 text-[13px] font-medium"
        >
          ⬆ {team ? "Read the client's Excel" : "Upload your own Excel or CSV"}
        </button>
      </div>
      {properties.map((property) => (
        <PropertySheet key={property.id} property={property} mode={mode} rooming={rooming} fields={fields} />
      ))}
      {importing && (
        <ImportSheet
          mode={mode}
          year={rooming.data.event ? new Date(rooming.data.event.startDate).getUTCFullYear() : new Date().getUTCFullYear()}
          multipleProperties={properties.length > 1}
          extras={fields}
          onClose={() => setImporting(false)}
        />
      )}
    </div>
  );
}

type ExtraField = (typeof roomingExtraFields)[number];

// --- The client's own view (doc §6.9, the owner 2026-11-23: "make it better") ------

/**
 * The rooming list as the client sees it by their link: no boxes, the whole
 * width, three lines on how it works, how far along they are, then per
 * property every room they booked — on the left the room and its dates, on
 * the right a line per stay: who, who shares, from, to, when they arrive,
 * notes. A room nobody is in yet has an empty line ready; typing saves.
 */
function ClientRoomingView({ properties, rooming, fields, onUpload }: { properties: Property[]; rooming: ReturnType<typeof useRooming>; fields: readonly ExtraField[]; onUpload: () => void }) {
  const rooms = properties.flatMap((property) => property.rooms);
  const done = rooms.filter((room) => room.named >= room.nights).length;
  const asked = rooms.flatMap((room) => room.stays).filter((stay) => stay.extraNights > 0);
  if (!properties.length) return <p className="text-ink-500 py-10 text-center text-sm font-light">Your rooms will show here once they are confirmed.</p>;
  return (
    <div className="space-y-8">
      <div className="grid gap-x-8 gap-y-3 md:grid-cols-[1fr_auto] md:items-end">
        <ol className="text-ink-700 grid gap-2 text-[14px] font-light sm:grid-cols-2 xl:grid-cols-4">
          <li>
            <span className="text-brand-700 mr-1.5 font-medium">1</span>Each line is a room you booked, with its dates.
          </li>
          <li>
            <span className="text-brand-700 mr-1.5 font-medium">2</span>Type who stays in it — it saves as you go.
          </li>
          <li>
            <span className="text-brand-700 mr-1.5 font-medium">3</span>Someone only part of the time? Change the dates — a new line appears for the rest.
          </li>
          <li>
            <span className="text-brand-700 mr-1.5 font-medium">4</span>Ready? Press <span className="font-medium">Submit</span> — we are told, and it is kept as a version.
          </li>
        </ol>
        <button type="button" onClick={onUpload} className="text-brand-700 hover:text-brand-800 justify-self-start text-[13px] font-medium underline-offset-2 hover:underline md:justify-self-end">
          Have it in Excel already? Upload it →
        </button>
      </div>

      <div>
        <div className="flex items-baseline justify-between gap-3 text-[13px]">
          <span className="text-ink-900 font-medium">
            {done} of {rooms.length} rooms have their guests
          </span>
          {asked.length > 0 && <span className="text-[#2a4f9c]">{asked.reduce((sum, stay) => sum + stay.extraNights, 0)} extra nights asked for — we will confirm</span>}
        </div>
        <div className="bg-ink-100 mt-1.5 h-1.5 overflow-hidden rounded-full">
          <div className="h-full rounded-full bg-[#0a7a47] transition-all" style={{ width: `${rooms.length ? (done / rooms.length) * 100 : 0}%` }} />
        </div>
      </div>

      {properties.map((property) => (
        <section key={property.id}>
          <div className="border-ink-900 flex flex-wrap items-baseline justify-between gap-x-4 border-b-2 pb-2">
            <h2 className="text-ink-900 text-xl font-medium">{property.name}</h2>
            {property.times && <p className="text-ink-500 text-[13px] font-light">{property.times}</p>}
          </div>
          <div className="text-ink-500 hidden grid-cols-[13rem_1fr] gap-4 border-b border-ink-200 py-2 text-[11px] font-medium tracking-wide uppercase md:grid">
            <span>Room</span>
            <div className={lineGrid}>
              <span>Guest</span>
              <span>{property.rooms.every((room) => room.oneBed) ? "Partner" : property.rooms.some((room) => room.oneBed) ? "Sharing with / partner" : "Sharing with"}</span>
              <span>From</span>
              <span>To</span>
              <span>Arriving</span>
              <span>Notes</span>
              <span />
            </div>
          </div>
          {property.rooms.map((room) => (
            <ClientRoom key={room.slotId} room={room} rooming={rooming} fields={fields} />
          ))}
        </section>
      ))}
    </div>
  );
}

/** The columns of a stay's line, from md up. */
const lineGrid = "md:grid md:grid-cols-[minmax(9rem,1.2fr)_minmax(9rem,1.2fr)_9rem_9rem_minmax(7rem,0.8fr)_minmax(7rem,1fr)_3.5rem] md:items-start md:gap-2";

function ClientRoom({ room, rooming, fields }: { room: Room; rooming: ReturnType<typeof useRooming>; fields: readonly ExtraField[] }) {
  const free = freeStretch(room);
  const full = room.named >= room.nights;
  return (
    <div className="border-ink-200/70 grid gap-x-4 gap-y-2 border-b py-3 md:grid-cols-[13rem_1fr]">
      <div className="flex items-start gap-2.5">
        <span className={`mt-1 inline-block h-2.5 w-2.5 shrink-0 rounded-full ${full ? "bg-[#0a7a47]" : room.named ? "bg-[#e0a100]" : "border-ink-300 border-2"}`} aria-hidden />
        <div className="min-w-0">
          <p className="text-ink-900 text-[14px] font-medium">
            Room {room.slotNumber}
            {room.unitNumber && <span className="text-ink-700 font-normal"> · No. {room.unitNumber}</span>}
          </p>
          <p className="text-ink-500 text-xs font-light">
            {room.category} · sleeps {room.capacity}
          </p>
          <p className="text-ink-500 text-xs font-light">Booked {room.booked.map((booked) => range(booked.checkIn, booked.checkOut)).join(", ")}</p>
        </div>
      </div>
      <div className="space-y-2">
        {inOrder(room, free).map((line) =>
          line.stay ? (
            <ClientLine key={line.stay.id} room={room} stay={line.stay} rooming={rooming} fields={fields} />
          ) : (
            <ClientLine key={`new-${line.start.checkIn}`} room={room} start={line.start} rooming={rooming} fields={fields} />
          ),
        )}
      </div>
    </div>
  );
}

/** One stay as a line: guest, who shares, from, to, arriving, notes — labelled on a phone. */
function ClientLine({ room, stay, start, rooming, fields }: { room: Room; stay?: Stay; start?: { checkIn: string; checkOut: string }; rooming: ReturnType<typeof useRooming>; fields: readonly ExtraField[] }) {
  const columns = Math.min(4, room.capacity);
  const { draft, setDraft, state, problem, setProblem, dirty, rowId, save, onBlur } = useStayDraft({ room, stay, start, columns, fields, rooming });
  const [more, setMore] = useState(draft.names.slice(2).some(Boolean));
  const [partner, setPartner] = useState(false);
  const box = "w-full rounded-lg border border-ink-200 bg-white px-3 py-2 text-[14px] text-ink-900 outline-none placeholder:text-ink-300 focus:border-brand-400 focus:ring-2 focus:ring-brand-400/15";
  const label = "text-ink-500 mb-0.5 block text-[11px] md:sr-only";
  const setName = (i: number, value: string) => setDraft({ ...draft, names: draft.names.map((one, j) => (j === i ? value : one)) });
  const details = (i: number) =>
    fields.length > 0 && draft.names[i]?.trim() ? (
      <div className="mt-1 grid grid-cols-2 gap-1">
        {fields.map((field) => (
          <input
            key={field.key}
            value={draft.details[i]?.[field.key] ?? ""}
            onChange={(e) => setDraft({ ...draft, details: draft.details.map((one, j) => (j === i ? { ...one, [field.key]: e.target.value } : one)) })}
            placeholder={field.label}
            aria-label={`${field.label} — ${draft.names[i]}`}
            className="border-ink-200 placeholder:text-ink-300 focus:border-brand-400 rounded-md border bg-white px-2 py-1 text-[12px] outline-none"
          />
        ))}
      </div>
    ) : null;
  const extra = stay && stay.extraNights > 0;
  return (
    <div data-stay={rowId} onBlur={onBlur} className={`grid grid-cols-2 gap-2 ${lineGrid} ${stay ? "" : "opacity-90"}`}>
      <div className="col-span-2 md:col-span-1">
        <label className={label}>Guest</label>
        <input value={draft.names[0] ?? ""} onChange={(e) => setName(0, e.target.value)} onKeyDown={(e) => e.key === "Enter" && (e.target as HTMLInputElement).blur()} placeholder={stay ? "" : "Full name"} aria-label="Guest" className={box} />
        {details(0)}
      </div>
      <div className="col-span-2 md:col-span-1">
        <label className={label}>{room.oneBed ? "Partner" : "Sharing with"}</label>
        {room.oneBed ? (
          // One bed (a King): one name, and their partner only if there is one.
          partner || draft.names[1] ? (
            <>
              <input value={draft.names[1] ?? ""} onChange={(e) => setName(1, e.target.value)} placeholder="Partner's name" aria-label="Partner" className={box} autoFocus={partner && !draft.names[1]} />
              {details(1)}
            </>
          ) : (
            <button type="button" onClick={() => setPartner(true)} className="text-brand-700 hover:bg-brand-50 rounded-lg px-2 py-2 text-[13px] font-medium">
              + partner
            </button>
          )
        ) : columns >= 2 ? (
          <>
            <input value={draft.names[1] ?? ""} onChange={(e) => setName(1, e.target.value)} placeholder={draft.names[0] ? "No one — or a name" : ""} aria-label="Sharing with" className={box} />
            {details(1)}
            {columns > 2 &&
              (more ? (
                draft.names.slice(2).map((value, i) => (
                  <div key={i} className="mt-1">
                    <input value={value} onChange={(e) => setName(i + 2, e.target.value)} placeholder="Another person" aria-label={`Guest ${i + 3}`} className={box} />
                    {details(i + 2)}
                  </div>
                ))
              ) : (
                <button type="button" onClick={() => setMore(true)} className="text-brand-700 mt-1 text-xs hover:underline">
                  + another person
                </button>
              ))}
          </>
        ) : (
          <p className="text-ink-400 px-1 py-2 text-xs">Sleeps one</p>
        )}
      </div>
      <div>
        <label className={label}>From</label>
        <input type="date" value={draft.checkIn} onChange={(e) => setDraft({ ...draft, checkIn: e.target.value })} aria-label="From" className={box} />
      </div>
      <div>
        <label className={label}>To</label>
        <input type="date" value={draft.checkOut} onChange={(e) => setDraft({ ...draft, checkOut: e.target.value })} aria-label="To" className={box} />
      </div>
      <div>
        <label className={label}>Arriving</label>
        <input value={draft.arrival} onChange={(e) => setDraft({ ...draft, arrival: e.target.value })} placeholder="Time or flight" aria-label="Arriving" className={box} />
      </div>
      <div>
        <label className={label}>Notes</label>
        <input value={draft.notes} onChange={(e) => setDraft({ ...draft, notes: e.target.value })} aria-label="Notes" className={box} />
      </div>
      <div className="col-span-2 flex items-center justify-end gap-2 md:col-span-1 md:pt-2">
        {state === "saving" ? (
          <span className="text-ink-400 text-xs">Saving…</span>
        ) : dirty ? (
          <button type="button" onClick={save} className="text-brand-700 text-xs font-medium hover:underline">
            Save
          </button>
        ) : state === "saved" && stay ? (
          <span className="text-xs text-[#0a7a47]">✓ Saved</span>
        ) : null}
        {stay && (
          <button
            type="button"
            onClick={() => {
              if (!window.confirm(`Take ${stay.guests.map(name).join(", ")} out of this room?`)) return;
              rooming.remove(stay.id).catch((error: unknown) => setProblem(error instanceof Error ? error.message : "Could not take them out."));
            }}
            aria-label="Take out"
            title="Take out"
            className="text-ink-400 text-lg leading-none hover:text-[#c03654]"
          >
            ×
          </button>
        )}
      </div>
      {(problem ?? extra) && (
        <p className={`col-span-2 text-xs md:col-span-7 ${problem ? "text-[#c03654]" : "text-[#2a4f9c]"}`}>
          {problem ??
            `You asked for ${stay!.extraNights} extra night${stay!.extraNights === 1 ? "" : "s"} (${stay!.extra.map((run) => range(run.checkIn, run.checkOut)).join(", ")}) beyond your booking — we are getting them for you and will confirm.`}
        </p>
      )}
    </div>
  );
}

function PropertySheet({ property, mode, rooming, fields }: { property: Property; mode: Mode; rooming: ReturnType<typeof useRooming>; fields: readonly ExtraField[] }) {
  const team = Boolean(mode.salesRequestId);
  const changes = property.rooms.flatMap((room) => room.stays).filter((stay) => stay.sinceSent).length;
  const eventId = rooming.data?.event?.id;
  return (
    <section className="border-ink-200/60 overflow-hidden rounded-2xl border bg-white">
      <header className="border-ink-200/60 flex flex-wrap items-start justify-between gap-3 border-b px-5 py-4">
        <div>
          <h2 className="text-ink-900 text-[16px] font-medium">{property.name}</h2>
          {property.times && <p className="text-ink-500 text-xs font-light">At the property: {property.times}</p>}
          {team && (
            <p className="text-ink-500 mt-0.5 text-xs font-light">
              The property&rsquo;s master list{" "}
              {property.sentAt ? (
                <>
                  V{property.version} was sent {formatDate(property.sentAt)}
                  {property.sentBy && <> by {property.sentBy}</>}
                  {changes > 0 ? (
                    <span className="font-medium text-[#b45309]">
                      {" "}
                      · {changes} of this client&rsquo;s change{changes === 1 ? "" : "s"} since
                    </span>
                  ) : (
                    " · none of this client's changes since"
                  )}
                </>
              ) : (
                "has not been sent yet"
              )}
            </p>
          )}
        </div>
        {team && eventId && (
          <a href={`/properties/${property.id}?event=${eventId}#rooming`} className="text-brand-700 text-[13px] font-medium hover:underline">
            Master list for the hotel — every client →
          </a>
        )}
      </header>
      <RoomsTable rooms={property.rooms} team={team} rooming={rooming} fields={fields} />
    </section>
  );
}

/** A property's rooms as a sheet: a row per stay, an empty row for each room's unnamed nights. */
function RoomsTable({ rooms, team, rooming, fields }: { rooms: Room[]; team: boolean; rooming: ReturnType<typeof useRooming>; fields: readonly ExtraField[] }) {
  const columns = Math.min(4, Math.max(1, ...rooms.map((room) => room.capacity)));
  const th = "text-ink-500 border-ink-200/60 border-b px-2 py-2 text-left text-[11px] font-medium tracking-wide whitespace-nowrap uppercase";
  return (
    <div className="overflow-x-auto">
      <table className="w-full min-w-[56rem] border-collapse text-[13px]">
        <thead className="bg-ink-50/60">
          <tr>
            <th className={th}>Room</th>
            <th className={th}>Check-in</th>
            <th className={th}>Check-out</th>
            {Array.from({ length: columns }, (_, i) => (
              <th key={i} className={th}>
                {columns === 1 ? "Guest — full name" : `Guest ${i + 1}${i === 0 ? " — full name" : ""}`}
                {fields.length > 0 && <span className="text-ink-400 block text-[10px] font-light normal-case">with {fields.map((field) => field.label.toLowerCase()).join(", ")}</span>}
              </th>
            ))}
            <th className={th}>Arriving</th>
            <th className={th}>Notes</th>
            <th className={th} aria-label="Actions" />
          </tr>
        </thead>
        <tbody>
          {rooms.map((room) => (
            <RoomRows key={room.slotId} room={room} columns={columns} team={team} rooming={rooming} fields={fields} />
          ))}
        </tbody>
      </table>
    </div>
  );
}

/**
 * A property's master rooming list (doc §6.9, the owner 2026-11-23: "1 master
 * list per property… the hotel's list should show all the rooms booked at the
 * property"): on the property's page, per event, every client's rooms and
 * guests — each client still sees only their own. It is the list the hotel
 * gets: downloaded, marked as sent as V1, V2…, changes shown against the last.
 */
export function MasterRoomingList({ propertyId, eventId: chosen }: { propertyId: string; eventId: string | null }) {
  const [eventId, setEventId] = useState<string | null>(chosen);
  const utils = api.useUtils();
  const data = api.rooming.forProperty.useQuery({ propertyId, eventId });
  const markSent = api.rooming.markSent.useMutation({ onSuccess: () => (void utils.rooming.invalidate(), void utils.audit.invalidate()) });
  const [sending, setSending] = useState(false);
  if (!data.data) return <p className="text-ink-500 text-sm font-light">Loading…</p>;
  const { events, master } = data.data;
  if (!master || !data.data.eventId) return <p className="text-ink-500 text-sm font-light">No rooms sold to any client here yet — the master rooming list is made from them.</p>;
  const current = data.data.eventId;
  const rooms = master.clients.flatMap((client) => client.rooms);
  const changes = rooms.flatMap((room) => room.stays).filter((stay) => stay.sinceSent).length;
  const nights = rooms.reduce((sum, room) => sum + room.nights, 0);
  const named = rooms.reduce((sum, room) => sum + room.named, 0);
  const download = `/api/rooming/master/${current}/${propertyId}`;
  const next = (master.version ?? 0) + 1;
  return (
    <div className="space-y-4">
      <div className="border-ink-200/60 rounded-xl border bg-white px-4 py-3">
        <div className="flex flex-wrap items-start justify-between gap-3">
          <div>
            <p className="text-ink-900 text-[14px] font-medium">Master rooming list — every client here</p>
            <p className="text-ink-500 text-xs font-light">
              {master.clients.length} client{master.clients.length === 1 ? "" : "s"} · {rooms.length} rooms · {named} of {nights} booked nights named
              {master.property.times && <> · {master.property.times}</>}
            </p>
            <p className="text-ink-500 mt-0.5 text-xs font-light">
              {master.sentAt ? (
                <>
                  V{master.version} sent {formatDate(master.sentAt)}
                  {master.sentBy && <> by {master.sentBy}</>}
                  {changes > 0 ? <span className="font-medium text-[#b45309]"> · {changes} change{changes === 1 ? "" : "s"} since — send V{next}</span> : " · no changes since"}
                </>
              ) : (
                "Not sent to the property yet"
              )}
            </p>
          </div>
          {events.length > 1 && (
            <select value={current} onChange={(e) => setEventId(e.target.value)} aria-label="Event" className="border-ink-200 rounded-full border bg-white px-3 py-1 text-xs">
              {events.map((event) => (
                <option key={event.id} value={event.id}>
                  {event.name}
                </option>
              ))}
            </select>
          )}
        </div>
        <div className="mt-2 flex flex-wrap items-center gap-3 text-[13px]">
          <button type="button" onClick={() => setSending(true)} className="bg-brand-400 hover:bg-brand-500 rounded-full px-4 py-1.5 text-[13px] font-medium text-white">
            ✉ Send V{next} to the property
          </button>
          <a href={download} className="text-brand-700 font-medium hover:underline">
            ⬇ Download Excel (V{next}{master.version && changes ? ", changes in yellow" : ""})
          </a>
          <button
            type="button"
            disabled={markSent.isPending}
            onClick={() => markSent.mutate({ eventId: current, propertyId })}
            className="text-ink-500 hover:text-ink-700 text-xs font-light hover:underline"
          >
            {markSent.isPending ? "Saving…" : `Sent it another way? Mark V${next} as sent`}
          </button>
          {master.versions.length > 0 && (
            <select
              value=""
              onChange={(e) => e.target.value && (window.location.href = `${download}?version=${e.target.value}`)}
              aria-label="Download an earlier version"
              className="border-ink-200 text-ink-700 rounded-full border bg-white px-2 py-1 text-xs"
            >
              <option value="">Earlier versions…</option>
              {master.versions.map((version) => (
                <option key={version.number} value={version.number}>
                  V{version.number} — {formatDate(version.sentAt)}
                  {version.sentTo ? ` — to ${version.sentTo}` : ""}
                </option>
              ))}
            </select>
          )}
        </div>
      </div>
      {sending && (
        <SendToProperty
          eventId={current}
          propertyId={propertyId}
          property={master.property.name}
          event={events.find((one) => one.id === current)?.name ?? ""}
          next={next}
          changes={Boolean(master.version && changes)}
          addresses={data.data.addresses}
          onClose={() => setSending(false)}
        />
      )}
      {master.clients.map((client) => (
        <section key={client.clientId} className="border-ink-200/60 overflow-hidden rounded-2xl border bg-white">
          <header className="border-ink-200/60 flex flex-wrap items-baseline justify-between gap-2 border-b px-5 py-3">
            <h3 className="text-ink-900 text-[15px] font-medium">{client.client}</h3>
            {client.salesRequestId ? (
              <a href={`/sales/${client.salesRequestId}#rooming`} className="text-brand-700 text-xs hover:underline">
                Their rooming list and link →
              </a>
            ) : (
              <span className="text-ink-500 text-xs font-light">No sales request at this event — their list cannot be filled in yet</span>
            )}
          </header>
          {client.salesRequestId ? (
            <ClientRooms salesRequestId={client.salesRequestId} rooms={client.rooms} fields={roomingExtraFields.filter((field) => client.fields.includes(field.key))} />
          ) : (
            // Rooms sold without a sales request: shown so the hotel's list is whole, but nobody can name guests in them yet.
            <ul className="text-ink-700 space-y-0.5 px-5 py-3 text-[13px] font-light">
              {Object.entries(
                client.rooms.reduce<Record<string, number>>((all, room) => {
                  const label = `${room.category}, booked ${room.booked.map((booked) => range(booked.checkIn, booked.checkOut)).join(", ")}`;
                  all[label] = (all[label] ?? 0) + 1;
                  return all;
                }, {}),
              ).map(([label, count]) => (
                <li key={label}>
                  {count} × {label}
                </li>
              ))}
            </ul>
          )}
        </section>
      ))}
    </div>
  );
}

/** One client's rooms on the master list, edited as on their own list. */
function ClientRooms({ salesRequestId, rooms, fields }: { salesRequestId: string; rooms: Room[]; fields: readonly ExtraField[] }) {
  const rooming = useRooming({ salesRequestId });
  return <RoomsTable rooms={rooms} team rooming={rooming} fields={fields} />;
}

/**
 * A room's lines in date order (the owner, 2026-11-23): its stays and the
 * empty line for its next free nights, earliest first.
 */
function inOrder(room: Room, free: { checkIn: string; checkOut: string } | null) {
  const lines: ({ stay: Stay; start?: undefined; at: string } | { stay?: undefined; start: { checkIn: string; checkOut: string }; at: string })[] = room.stays.map((stay) => ({ stay, at: stay.checkIn }));
  if (free) lines.push({ start: free, at: free.checkIn });
  return lines.sort((a, b) => a.at.localeCompare(b.at));
}

/** The first stretch of a room's booked nights nobody is in yet — what a new row starts as. */
function freeStretch(room: Room) {
  const taken = room.stays.filter((stay) => !stay.removed);
  for (const booked of room.booked) {
    let night = parseDay(booked.checkIn);
    const end = parseDay(booked.checkOut);
    let start: Date | null = null;
    while (night < end) {
      const key = night.toISOString().slice(0, 10);
      const used = taken.some((stay) => stay.checkIn <= key && stay.checkOut > key);
      if (!used && !start) start = night;
      if (used && start) return { checkIn: start.toISOString().slice(0, 10), checkOut: key };
      night = new Date(night.getTime() + 864e5);
    }
    if (start) return { checkIn: start.toISOString().slice(0, 10), checkOut: booked.checkOut };
  }
  return null;
}

function RoomRows({ room, columns, team, rooming, fields }: { room: Room; columns: number; team: boolean; rooming: ReturnType<typeof useRooming>; fields: readonly ExtraField[] }) {
  const free = freeStretch(room);
  const full = room.named >= room.nights;
  const unused = room.nights - room.named;
  const roomCell = (
    <td className="bg-white px-3 py-2 align-top" style={{ minWidth: "15rem" }}>
      <div className="flex flex-wrap items-baseline gap-x-2 whitespace-nowrap">
        <span className="text-ink-900 font-medium">{room.category}</span>
        {team ? <UnitNumber room={room} /> : room.unitNumber ? <span className="text-ink-700 text-xs">No. {room.unitNumber}</span> : null}
      </div>
      <p className="text-ink-400 text-[11px] font-light whitespace-nowrap">
        {team ? "our room" : "room"} {room.slotNumber} · sleeps {room.capacity} ·{" "}
        <span className={full ? "text-[#0a7a47]" : room.named > 0 ? "text-[#8a5a00]" : ""}>
          {full ? "✓ all named" : room.named > 0 ? `${unused} night${unused === 1 ? "" : "s"} not used` : `${room.nights} nights to name`}
        </span>
      </p>
      <p className="text-ink-400 text-[11px] font-light">Booked {room.booked.map((booked) => range(booked.checkIn, booked.checkOut)).join(", ")}</p>
    </td>
  );
  const blank = <td className="bg-white" />;
  const lines = inOrder(room, free);
  return (
    <>
      {lines.map((line, index) =>
        line.stay ? (
          <SheetRow key={line.stay.id} room={room} stay={line.stay} columns={columns} team={team} rooming={rooming} fields={fields} lead={index === 0 ? roomCell : blank} last={index === lines.length - 1} />
        ) : (
          <SheetRow key={`new-${line.start.checkIn}`} room={room} start={line.start} columns={columns} team={team} rooming={rooming} fields={fields} lead={index === 0 ? roomCell : blank} last={index === lines.length - 1} />
        ),
      )}
    </>
  );
}

/** A full name split as hotels want it: the last word is the last name. */
const splitName = (full: string) => {
  const words = full.trim().split(/\s+/).filter(Boolean);
  return words.length <= 1 ? { firstName: words[0] ?? "", lastName: "" } : { firstName: words.slice(0, -1).join(" "), lastName: words.at(-1)! };
};

type Details = Partial<Record<RoomingExtraKey, string>>;

/**
 * A stay being typed — or a room's empty line: the draft, kept in step with
 * the server, saved when the cursor leaves the stay (doc §6.9).
 */
function useStayDraft({
  room,
  stay,
  start,
  columns,
  fields,
  rooming,
}: {
  room: Room;
  stay?: Stay;
  start?: { checkIn: string; checkOut: string };
  columns: number;
  fields: readonly ExtraField[];
  rooming: ReturnType<typeof useRooming>;
}) {
  const initial = () => ({
    checkIn: stay?.checkIn ?? start?.checkIn ?? "",
    checkOut: stay?.checkOut ?? start?.checkOut ?? "",
    names: Array.from({ length: columns }, (_, i) => (stay?.guests[i] ? name(stay.guests[i]) : "")),
    details: Array.from({ length: columns }, (_, i) => Object.fromEntries(fields.map((field) => [field.key, stay?.guests[i]?.[field.key] ?? ""])) as Details),
    arrival: stay?.arrival ?? "",
    notes: stay?.notes ?? "",
  });
  const [draft, setDraft] = useState(initial);
  const [state, setState] = useState<"idle" | "saving" | "saved">("idle");
  const [problem, setProblem] = useState<string | null>(null);
  const key = JSON.stringify(initial());
  // A fresh copy from the server (someone else's change, or ours saved) replaces the draft.
  useEffect(() => setDraft(initial()), [key]); // eslint-disable-line react-hooks/exhaustive-deps
  const dirty = JSON.stringify(draft) !== key;
  const removed = stay?.removed ?? false;
  const rowId = stay?.id ?? `new-${room.slotId}`;

  const save = () => {
    if (!dirty || removed) return;
    const guests = draft.names
      .map((full, i) => ({ ...splitName(full), ...Object.fromEntries(Object.entries(draft.details[i] ?? {}).filter(([, value]) => value)) }))
      .filter((guest) => guest.firstName || guest.lastName);
    if (!guests.length) {
      if (stay) setProblem("Give at least one name — or take them out with ×.");
      return;
    }
    setState("saving");
    setProblem(null);
    rooming
      .save({ id: stay?.id, slotId: room.slotId, checkIn: draft.checkIn, checkOut: draft.checkOut, guests, arrival: draft.arrival, notes: draft.notes })
      .then(() => setState("saved"))
      .catch((error: unknown) => {
        setState("idle");
        setProblem(error instanceof Error ? error.message : "Could not save.");
      });
  };
  // Left the stay altogether — not just moved to another of its boxes.
  const onBlur = (e: React.FocusEvent) => {
    const next = (e.relatedTarget as HTMLElement | null)?.closest("[data-stay]")?.getAttribute("data-stay");
    if (next !== rowId) save();
  };
  return { draft, setDraft, state, problem, setProblem, dirty, removed, rowId, save, onBlur };
}

/**
 * One stay as a row of the sheet — or, with no stay, the empty row for the
 * room's next free nights. It saves when the cursor leaves the row.
 */
function SheetRow({
  room,
  stay,
  start,
  columns,
  team,
  rooming,
  fields,
  lead,
  last,
}: {
  room: Room;
  stay?: Stay;
  start?: { checkIn: string; checkOut: string };
  columns: number;
  team: boolean;
  rooming: ReturnType<typeof useRooming>;
  fields: readonly ExtraField[];
  lead: React.ReactNode;
  last: boolean;
}) {
  const { draft, setDraft, state, problem, setProblem, dirty, removed, rowId, save, onBlur } = useStayDraft({ room, stay, start, columns, fields, rooming });
  const [partner, setPartner] = useState(false);

  const cell = "px-1 py-1 align-top";
  const input = `w-full rounded-md border border-transparent bg-transparent px-2 py-1.5 text-[13px] outline-none hover:border-ink-200 focus:border-brand-400 focus:bg-white ${removed ? "line-through text-ink-400" : "text-ink-900"}`;
  const small = "w-full rounded border border-transparent bg-transparent px-2 py-0.5 text-[11px] text-ink-700 outline-none hover:border-ink-200 focus:border-brand-400 focus:bg-white";
  const tone = removed ? "bg-[#fdecec]" : stay?.sinceSent ? "bg-[#fff4e0]" : !stay ? "bg-white" : "";
  const extra = stay && !removed && stay.extraNights > 0;
  const message =
    problem ??
    (extra
      ? `${team ? "Extension requested" : "You asked for"} ${stay.extraNights} extra night${stay.extraNights === 1 ? "" : "s"} (${stay.extra.map((run) => range(run.checkIn, run.checkOut)).join(", ")}) — ${team ? "acquisitions has a task to get them" : "we are getting them for you and will confirm"}.`
      : null);
  const flag = team && stay?.sinceSent ? `${stay.sinceSent === "removed" ? "Taken out" : stay.sinceSent === "new" ? "New" : `Changed (${stay.changes.join("; ")})`} since the version sent — by ${stay.changedBy}` : null;
  return (
    <>
      <tr className={`${tone} ${last && !message && !flag ? "border-ink-200/60 border-b" : ""}`} data-stay={rowId} onBlur={onBlur}>
        {lead}
        <td className={cell}>
          <input type="date" value={draft.checkIn} disabled={removed} onChange={(e) => setDraft({ ...draft, checkIn: e.target.value })} aria-label="Check-in" className={`${input} w-36`} />
        </td>
        <td className={cell}>
          <input type="date" value={draft.checkOut} disabled={removed} onChange={(e) => setDraft({ ...draft, checkOut: e.target.value })} aria-label="Check-out" className={`${input} w-36`} />
        </td>
        {draft.names.map((value, i) => (
          <td key={i} className={cell}>
            {room.oneBed && i === 1 && !value && !partner ? (
              // One bed (a King): a partner only if there is one.
              <button type="button" disabled={removed} onClick={() => setPartner(true)} className="text-brand-700 px-2 py-1.5 text-xs font-medium hover:underline">
                + partner
              </button>
            ) : room.oneBed && i > 1 ? (
              <span className="text-ink-300 block px-2 py-1.5 text-xs">—</span>
            ) : i < room.capacity ? (
              <>
                <input
                  value={value}
                  disabled={removed}
                  onChange={(e) => setDraft({ ...draft, names: draft.names.map((one, j) => (j === i ? e.target.value : one)) })}
                  onKeyDown={(e) => e.key === "Enter" && (e.target as HTMLInputElement).blur()}
                  placeholder={!stay && i === 0 ? "Type a name…" : ""}
                  aria-label={`Guest ${i + 1}`}
                  className={input}
                />
                {fields.length > 0 && (value.trim() || draft.details[i]?.[fields[0]!.key]) && (
                  <div className="space-y-0.5 pb-1">
                    {fields.map((field) => (
                      <input
                        key={field.key}
                        value={draft.details[i]?.[field.key] ?? ""}
                        disabled={removed}
                        onChange={(e) => setDraft({ ...draft, details: draft.details.map((one, j) => (j === i ? { ...one, [field.key]: e.target.value } : one)) })}
                        placeholder={field.label}
                        aria-label={`Guest ${i + 1} ${field.label}`}
                        className={small}
                      />
                    ))}
                  </div>
                )}
              </>
            ) : (
              <span className="text-ink-300 block px-2 py-1.5 text-xs">—</span>
            )}
          </td>
        ))}
        <td className={cell}>
          <input value={draft.arrival} disabled={removed} onChange={(e) => setDraft({ ...draft, arrival: e.target.value })} placeholder={!stay ? "e.g. 14:30, BA 283" : ""} aria-label="Arriving" className={input} />
        </td>
        <td className={cell}>
          <input value={draft.notes} disabled={removed} onChange={(e) => setDraft({ ...draft, notes: e.target.value })} aria-label="Notes" className={input} />
        </td>
        <td className={`${cell} w-16 text-right whitespace-nowrap`}>
          {state === "saving" ? (
            <span className="text-ink-400 px-1 text-xs">Saving…</span>
          ) : dirty && !removed ? (
            <button type="button" onClick={save} className="text-brand-700 px-1 text-xs font-medium hover:underline">
              Save
            </button>
          ) : state === "saved" && stay ? (
            <span className="px-1 text-xs text-[#0a7a47]">✓</span>
          ) : null}
          {stay && !removed && (
            <button
              type="button"
              onClick={() => {
                if (!window.confirm(`Take ${stay.guests.map(name).join(", ")} out of this room?`)) return;
                rooming.remove(stay.id).catch((error: unknown) => setProblem(error instanceof Error ? error.message : "Could not take them out."));
              }}
              aria-label="Take out"
              title="Take out"
              className="text-ink-400 px-1 text-lg leading-none hover:text-[#c03654]"
            >
              ×
            </button>
          )}
        </td>
      </tr>
      {(message ?? flag) && (
        <tr className={`${tone} ${last ? "border-ink-200/60 border-b" : ""}`} data-stay={rowId}>
          <td className="bg-white" />
          <td colSpan={columns + 5} className="px-3 pb-2 text-xs">
            {message && <p className={problem ? "text-[#c03654]" : "font-medium text-[#2a4f9c]"}>{message}</p>}
            {flag && !problem && <p className="font-medium text-[#b45309]">{flag}</p>}
          </td>
        </tr>
      )}
    </>
  );
}

// --- Reading the client's own spreadsheet -------------------------------------------

type Field = "name" | "firstName" | "lastName" | "name2" | "checkIn" | "checkOut" | "property" | "roomType" | "roomNumber" | "group" | "arrival" | "notes" | RoomingExtraKey;
const fields: { key: Field; label: string; hint?: string; guess: RegExp | RegExp[] }[] = [
  { key: "name", label: "Guest — full name", guess: /^(guest|name|full ?name|guest ?name|passenger|participant|athlete|delegate|person)( ?1)?$/i },
  { key: "firstName", label: "First name", guess: /first|given|vorname|pr[ée]nom/i },
  { key: "lastName", label: "Last name", guess: /last|surname|family|nachname|nom$/i },
  { key: "name2", label: "Second guest (sharing) — full name", guess: /(guest|name|sharing|roommate|room ?mate).*2|sharing ?with|room ?mate/i },
  { key: "checkIn", label: "Check-in", guess: /check.?in|arrival ?date|^arrival$|^from$|^in$|anreise/i },
  { key: "checkOut", label: "Check-out", guess: /check.?out|departure|^to$|^out$|abreise/i },
  { key: "property", label: "Hotel / property", guess: /^(hotel|property|accommodation|building|residence)( name)?$/i },
  { key: "roomType", label: "Room type", guess: /room ?type|category|type/i },
  { key: "roomNumber", label: "The building's room number", guess: /room ?(no|nr|num|number|#)|actual unit|^unit ?(no|#)|^room$/i },
  {
    key: "group",
    label: "Room line — the sheet's own room #",
    hint: "Rows with the same value are the same room: on the same dates they share it, on other dates they follow each other in it. Blank rows under a line belong to it.",
    guess: /^apt\b|^apt\.? ?#|^#$|^no\.?$|share|group|pair|booking ?(ref|id)|room ?share|our room/i,
  },
  { key: "arrival", label: "Arriving — time or flight", guess: [/^eta\b|arrival ?time|^time$/i, /flight/i] },
  { key: "notes", label: "Notes", guess: /note|comment|remark|special|request/i },
  // The extra details, offered when the list asks for them.
  { key: "gender", label: "Gender", guess: /^(gender|sex)$/i },
  { key: "nationality", label: "Nationality", guess: /nationality|citizenship|country of/i },
  { key: "passport", label: "Passport no.", guess: /passport|id ?(no|number)|document/i },
  { key: "email", label: "Email", guess: /e-?mail/i },
];

/**
 * The client's own rooming list, read and matched (doc §6.9, the owner
 * 2026-11-23): choose the file, say which column is which (guessed from its
 * headings), see what it would add, change and could not place — and why —
 * then apply it. Nothing changes before Apply.
 */
function ImportSheet({ mode, year, multipleProperties, extras, onClose }: { mode: Mode; year: number; multipleProperties: boolean; extras: readonly ExtraField[]; onClose: () => void }) {
  const offered = fields.filter((field) => !isExtraKey(field.key) || extras.some((extra) => extra.key === field.key));
  const utils = api.useUtils();
  const [file, setFile] = useState<{ name: string; sheets: ReadSheet[] } | null>(null);
  const [sheetIndex, setSheetIndex] = useState(0);
  const [map, setMap] = useState<Partial<Record<Field, number>>>({});
  const [order, setOrder] = useState<"dmy" | "mdy">("dmy");
  const [readError, setReadError] = useState<string | null>(null);
  const [removeMissing, setRemoveMissing] = useState(false);
  const previewTeam = api.rooming.previewImport.useMutation();
  const previewLink = api.rooming.previewImportByLink.useMutation();
  const applyTeam = api.rooming.applyImport.useMutation();
  const applyLink = api.rooming.applyImportByLink.useMutation();
  const preview = mode.salesRequestId ? previewTeam : previewLink;
  const apply = mode.salesRequestId ? applyTeam : applyLink;

  const sheet = file?.sheets[sheetIndex] ?? null;
  const headerAt = sheet ? headingRow(sheet) : 0;
  const headings = sheet ? (sheet.rows[headerAt] ?? []).map((cell, i) => cellText(cell).replace(/\s+/g, " ") || `Column ${i + 1}`) : [];
  const body = sheet ? sheet.rows.slice(headerAt + 1).map((row, i) => ({ row, number: headerAt + 2 + i })).filter(({ row }) => row.some((cell) => cell !== null && cell !== "")) : [];

  const choose = (sheets: ReadSheet[], index: number) => {
    const chosen = sheets[index];
    if (!chosen) return;
    const heads = (chosen.rows[headingRow(chosen)] ?? []).map((cell) => cellText(cell).replace(/\s+/g, " "));
    const guessed: Partial<Record<Field, number>> = {};
    const used = new Set<number>();
    for (const field of offered) {
      // Tried in order: the first pattern any free heading matches wins.
      for (const pattern of Array.isArray(field.guess) ? field.guess : [field.guess]) {
        const index = heads.findIndex((head, i) => !used.has(i) && head && pattern.test(head));
        if (index >= 0) {
          guessed[field.key] = index;
          used.add(index);
          break;
        }
      }
    }
    if (guessed.firstName !== undefined && guessed.lastName !== undefined) delete guessed.name;
    setMap(guessed);
    preview.reset();
  };

  // Day and month both under 13 everywhere: the sheet could be either way round.
  const ambiguous = body.some(({ row }) =>
    (["checkIn", "checkOut"] as const).some((key) => {
      const value = map[key] === undefined ? null : row[map[key]!];
      const m = typeof value === "string" ? /^(\d{1,2})[-/.](\d{1,2})/.exec(value.trim()) : null;
      return m ? Number(m[1]) <= 12 && Number(m[2]) <= 12 && m[1] !== m[2] : false;
    }),
  );

  const build = () => {
    const at = (row: Cell[], key: Field) => (map[key] === undefined ? null : (row[map[key]!] ?? null));
    const text = (row: Cell[], key: Field) => cellText(at(row, key)) || null;
    const date = (row: Cell[], key: Field) => cellDate(at(row, key), order, year);
    const out: ImportRowInput[] = [];
    // Rows written under a room line leave its cells blank: they carry on from the line above
    // (the room line, its type, number and hotel; the dates while the row gives none).
    let above: { group: string | null; property: string | null; roomType: string | null; roomNumber: string | null; checkIn: string | null; checkOut: string | null } = {
      group: null,
      property: null,
      roomType: null,
      roomNumber: null,
      checkIn: null,
      checkOut: null,
    };
    const stays = new Map<string, ImportRowInput>();
    for (const { row, number } of body) {
      const ownGroup = text(row, "group");
      const continues = map.group !== undefined && !ownGroup;
      const here = {
        group: ownGroup ?? (continues ? above.group : null),
        property: text(row, "property") ?? (continues || map.group === undefined ? above.property : null),
        roomType: text(row, "roomType") ?? (continues ? above.roomType : null),
        roomNumber: text(row, "roomNumber") ?? (continues ? above.roomNumber : null),
        checkIn: date(row, "checkIn") ?? (continues ? above.checkIn : null),
        checkOut: date(row, "checkOut") ?? (continues ? above.checkOut : null),
      };
      above = here;
      const guests: Guest[] = [];
      if (map.firstName !== undefined || map.lastName !== undefined) guests.push({ firstName: text(row, "firstName") ?? "", lastName: text(row, "lastName") ?? "" });
      else if (text(row, "name")) guests.push(splitName(text(row, "name")!));
      // The row's details are its first guest's.
      if (guests[0]) for (const extra of extras) if (text(row, extra.key)) guests[0][extra.key] = text(row, extra.key)!;
      if (text(row, "name2")) guests.push(splitName(text(row, "name2")!));
      const named = guests.filter((guest) => guest.firstName || guest.lastName);
      // A row with no one on it — a second contract line, a spacer — only sets what follows.
      if (!named.length) continue;
      const roomKey = here.group ? `${here.property ?? ""}|${here.group}` : null;
      // Same room line and same dates: sharing the room.
      const key = roomKey ? `${roomKey}|${here.roomType ?? ""}|${here.checkIn ?? ""}|${here.checkOut ?? ""}` : null;
      const sharing = key ? stays.get(key) : undefined;
      if (sharing) {
        sharing.rows.push(number);
        sharing.guests.push(...named);
        continue;
      }
      const item: ImportRowInput = {
        rows: [number],
        guests: named,
        checkIn: here.checkIn,
        checkOut: here.checkOut,
        property: here.property,
        roomType: here.roomType,
        roomNumber: here.roomNumber,
        roomKey,
        ...(map.arrival !== undefined && { arrival: text(row, "arrival") }),
        ...(map.notes !== undefined && { notes: text(row, "notes") }),
      };
      out.push(item);
      if (key) stays.set(key, item);
    }
    return out;
  };

  const run = () => {
    const sheetRows = build();
    if (mode.salesRequestId) previewTeam.mutate({ salesRequestId: mode.salesRequestId, sheet: sheetRows });
    else previewLink.mutate({ token: mode.token!, sheet: sheetRows });
  };
  const doApply = () => {
    const sheetRows = build();
    const done = () => void utils.rooming.invalidate().then(() => void utils.audit.invalidate());
    if (mode.salesRequestId) applyTeam.mutate({ salesRequestId: mode.salesRequestId, sheet: sheetRows, removeMissing, fileName: file?.name ?? "" }, { onSuccess: done });
    else applyLink.mutate({ token: mode.token!, sheet: sheetRows, removeMissing, fileName: file?.name ?? "" }, { onSuccess: done });
  };

  const hasName = map.name !== undefined || map.firstName !== undefined || map.lastName !== undefined;
  const result = preview.data;
  const applied = apply.data;

  return (
    <Popup title={mode.salesRequestId ? "Read the client's rooming list" : "Upload your rooming list"} subtitle="Excel (.xlsx) or CSV — nothing changes until you apply it" onClose={onClose}>
      <div className="space-y-5 text-[13px]">
        {applied ? (
          <div className="space-y-3">
            <p className="text-[15px] font-medium text-[#0a7a47]">
              ✓ Done — {applied.added} added, {applied.changed} changed{applied.removed ? `, ${applied.removed} taken out` : ""}.
            </p>
            {(applied.failed.length > 0 || applied.problems > 0) && (
              <p className="text-[#b45309]">
                {applied.problems + applied.failed.length} could not be placed — they are listed in red in the preview; fix them in the sheet or the file.
              </p>
            )}
            {applied.failed.map((item, i) => (
              <p key={i} className="text-[#c03654]">
                {item.guests}: {item.message}
              </p>
            ))}
            <Button type="button" onClick={onClose}>
              Close
            </Button>
          </div>
        ) : (
          <>
            <div>
              <input
                type="file"
                accept=".xlsx,.csv,.tsv,.txt,application/vnd.openxmlformats-officedocument.spreadsheetml.sheet,text/csv"
                onChange={(e) => {
                  const chosen = e.target.files?.[0];
                  e.target.value = "";
                  if (!chosen) return;
                  setReadError(null);
                  readSheetFile(chosen)
                    .then((sheets) => {
                      if (!sheets.length) throw new Error("No sheets in that file.");
                      setFile({ name: chosen.name, sheets });
                      setSheetIndex(0);
                      choose(sheets, 0);
                    })
                    .catch((error: unknown) => setReadError(error instanceof Error ? error.message : "That file could not be read."));
                }}
                className="text-ink-700 file:bg-brand-400 hover:file:bg-brand-500 block text-[13px] file:mr-3 file:rounded-full file:border-0 file:px-4 file:py-2 file:text-white"
              />
              {readError && <p className="mt-1 text-[#c03654]">{readError}</p>}
              {file && (
                <p className="text-ink-500 mt-1 text-xs font-light">
                  {file.name} · {body.length} rows{headerAt > 0 ? ` · headings on row ${headerAt + 1}` : ""}
                </p>
              )}
            </div>

            {file && sheet && (
              <div className="space-y-3">
                {file.sheets.length > 1 && (
                  <label className="text-ink-700 block text-xs">
                    Sheet
                    <select
                      value={sheetIndex}
                      onChange={(e) => {
                        setSheetIndex(Number(e.target.value));
                        choose(file.sheets, Number(e.target.value));
                      }}
                      className="border-ink-200 mt-0.5 block rounded-md border bg-white px-2 py-1.5 text-[13px]"
                    >
                      {file.sheets.map((one, i) => (
                        <option key={i} value={i}>
                          {one.name}
                        </option>
                      ))}
                    </select>
                  </label>
                )}
                <div>
                  <p className="text-ink-900 font-medium">Which column is which?</p>
                  <p className="text-ink-500 text-xs font-light">Guessed from the headings — change any that are wrong. A name is all that is needed; without dates, the room&rsquo;s booked dates are used.</p>
                </div>
                <div className="grid gap-x-4 gap-y-2 sm:grid-cols-2">
                  {offered
                    .filter((field) => field.key !== "property" || multipleProperties || map.property !== undefined)
                    .map((field) => (
                      <label key={field.key} className="text-ink-700 flex items-center justify-between gap-2 text-xs" title={field.hint}>
                        <span>{field.label}</span>
                        <select
                          value={map[field.key] ?? ""}
                          onChange={(e) => {
                            setMap({ ...map, [field.key]: e.target.value === "" ? undefined : Number(e.target.value) });
                            preview.reset();
                          }}
                          className={`border-ink-200 w-44 rounded-md border bg-white px-2 py-1 text-[12px] ${map[field.key] !== undefined ? "text-ink-900" : "text-ink-400"}`}
                        >
                          <option value="">— not in the file —</option>
                          {headings.map((heading, i) => (
                            <option key={i} value={i}>
                              {heading}
                            </option>
                          ))}
                        </select>
                      </label>
                    ))}
                </div>
                {ambiguous && (
                  <label className="text-ink-700 flex items-center gap-2 text-xs">
                    Dates like 05/07 mean
                    <select value={order} onChange={(e) => (setOrder(e.target.value as "dmy" | "mdy"), preview.reset())} className="border-ink-200 rounded-md border bg-white px-2 py-1 text-[12px]">
                      <option value="dmy">5 July (day first)</option>
                      <option value="mdy">May 7 (month first)</option>
                    </select>
                  </label>
                )}
                <div className="flex items-center gap-3">
                  <Button type="button" onClick={run} disabled={!hasName || preview.isPending}>
                    {preview.isPending ? "Checking…" : result ? "Check again" : "Check it against the rooms"}
                  </Button>
                  {!hasName && <span className="text-xs text-[#b45309]">Choose the column with the guests&rsquo; names.</span>}
                </div>
                {preview.error && <FormError message={friendlyError(preview.error)} />}
              </div>
            )}

            {result && (
              <div className="space-y-4">
                <div className="flex flex-wrap gap-2 text-xs">
                  <span className="rounded-full bg-[#e8f6ee] px-2.5 py-1 font-medium text-[#0a5c36]">{result.matched.filter((one) => one.action === "add").length} to add</span>
                  <span className="rounded-full bg-[#e8eefb] px-2.5 py-1 font-medium text-[#2a4f9c]">{result.matched.filter((one) => one.action === "update").length} to change</span>
                  <span className="bg-ink-100 text-ink-700 rounded-full px-2.5 py-1">{result.matched.filter((one) => one.action === "same").length} already right</span>
                  <span className={`rounded-full px-2.5 py-1 font-medium ${result.problems.length ? "bg-[#fdecec] text-[#a3263d]" : "bg-ink-100 text-ink-500"}`}>{result.problems.length} not placed</span>
                  {result.missing.length > 0 && <span className="rounded-full bg-[#fff4e0] px-2.5 py-1 font-medium text-[#8a5a00]">{result.missing.length} on the list, not in the file</span>}
                </div>

                {result.problems.length > 0 && (
                  <div>
                    <p className="font-medium text-[#a3263d]">Not placed — fix these in the file, or add them in the sheet</p>
                    <ul className="mt-1 space-y-1">
                      {result.problems.map((problem, i) => (
                        <li key={i} className="rounded-md bg-[#fdecec] px-3 py-1.5">
                          <span className="text-ink-500">Row {problem.rows.join(", ")} · </span>
                          <span className="text-ink-900 font-medium">{problem.guests}</span> — {problem.message}
                        </li>
                      ))}
                    </ul>
                  </div>
                )}

                {result.matched.some((one) => one.action !== "same" || one.warning) && (
                  <div>
                    <p className="text-ink-900 font-medium">What changes</p>
                    <ul className="mt-1 max-h-72 space-y-1 overflow-y-auto">
                      {result.matched
                        .filter((one) => one.action !== "same" || one.warning)
                        .map((one, i) => (
                          <li key={i} className={`rounded-md px-3 py-1.5 ${one.action === "add" ? "bg-[#e8f6ee]" : one.action === "update" ? "bg-[#e8eefb]" : "bg-ink-50"}`}>
                            <span className="text-ink-500">Row {one.rows.join(", ")} · </span>
                            <span className="text-ink-900 font-medium">{one.guests.map(name).join(", ")}</span>
                            {" — "}
                            {one.action === "add" ? `${one.room}, ${range(one.checkIn, one.checkOut)}` : one.action === "update" ? one.changes.join("; ") : "already right"}
                            {one.warning && <span className="block text-xs text-[#8a5a00]">{one.warning}</span>}
                          </li>
                        ))}
                    </ul>
                  </div>
                )}

                {result.missing.length > 0 && (
                  <div>
                    <p className="font-medium text-[#8a5a00]">On the list but not in the file</p>
                    <ul className="mt-1 space-y-1">
                      {result.missing.map((one) => (
                        <li key={one.stayId} className="rounded-md bg-[#fff4e0] px-3 py-1.5">
                          <span className="text-ink-900 font-medium">{one.guests}</span> — {one.room}, {one.dates}
                        </li>
                      ))}
                    </ul>
                    <label className="text-ink-700 mt-2 flex items-center gap-2 text-xs">
                      <input type="checkbox" checked={removeMissing} onChange={(e) => setRemoveMissing(e.target.checked)} className="accent-brand-500" />
                      Take them out of the list — the file is the whole list
                    </label>
                  </div>
                )}

                <div className="flex items-center gap-3">
                  <Button type="button" onClick={doApply} disabled={apply.isPending || (!result.matched.some((one) => one.action !== "same") && !(removeMissing && result.missing.length))}>
                    {apply.isPending ? "Applying…" : "Apply to the rooming list"}
                  </Button>
                  <Button type="button" variant="ghost" onClick={onClose}>
                    Cancel
                  </Button>
                  {apply.error && <FormError message={friendlyError(apply.error)} />}
                </div>
              </div>
            )}
          </>
        )}
      </div>
    </Popup>
  );
}

/**
 * The heading row: of the first twenty, the one with the most filled cells —
 * a title, the client's name and the like sit above it with fewer.
 */
function headingRow(sheet: ReadSheet) {
  let best = 0;
  let most = 0;
  sheet.rows.slice(0, 20).forEach((row, i) => {
    const filled = row.filter((cell) => cell !== null && cell !== "").length;
    if (filled > most) {
      most = filled;
      best = i;
    }
  });
  return best;
}

type ImportRowInput = RouterInputs["rooming"]["previewImport"]["sheet"][number];

/** The building's own number for the room, typed in once known (doc §6.9). */
function UnitNumber({ room }: { room: Room }) {
  const utils = api.useUtils();
  const [value, setValue] = useState(room.unitNumber ?? "");
  useEffect(() => setValue(room.unitNumber ?? ""), [room.unitNumber]);
  const save = api.rooming.setUnitNumber.useMutation({ onSuccess: () => (void utils.rooming.invalidate(), void utils.audit.invalidate()) });
  return (
    <span className="inline-flex items-center gap-1 text-xs">
      <span className="text-ink-500">No.</span>
      <input
        value={value}
        onChange={(e) => setValue(e.target.value)}
        onBlur={() => value.trim() !== (room.unitNumber ?? "") && save.mutate({ slotId: room.slotId, unitNumber: value })}
        onKeyDown={(e) => e.key === "Enter" && (e.target as HTMLInputElement).blur()}
        placeholder="not known"
        aria-label="Room number"
        className="border-ink-200 focus:border-brand-400 w-20 rounded border-b border-dashed bg-transparent px-1 text-xs outline-none"
      />
      {save.error && <span className="text-xs text-[#c03654]">{friendlyError(save.error)}</span>}
    </span>
  );
}

/** On the sales request: the client's link, then the list itself. */
export function RequestRoomingList({ salesRequestId }: { salesRequestId: string }) {
  const utils = api.useUtils();
  const data = api.rooming.forRequest.useQuery({ salesRequestId });
  const refresh = () => (void utils.rooming.invalidate(), void utils.audit.invalidate());
  const make = api.rooming.makeLink.useMutation({ onSuccess: refresh });
  const off = api.rooming.switchOffLink.useMutation({ onSuccess: refresh });
  const [origin, setOrigin] = useState("");
  const [copied, setCopied] = useState(false);
  useEffect(() => setOrigin(window.location.origin), []);
  const url = data.data?.token ? `${origin}/rooming/${data.data.token}` : null;
  const error = make.error ?? off.error;
  return (
    <div className="space-y-5">
      <Card>
        <h3 className="text-ink-900 text-[15px] font-medium">Rooming list</h3>
        <p className="text-ink-500 mt-1 text-[13px] font-light">
          Made from the rooms the client bought: the rooms and their dates are fixed as per the contract, and the client puts in who sleeps where —
          by their link, or you do it here. Number the rooms once you know them. What goes to the hotel — every client&rsquo;s guests there — is the
          master list on the property&rsquo;s page, where it is downloaded, sent and kept as versions.
        </p>
        <div className="mt-3">
          {url ? (
            <div className="flex flex-wrap items-center gap-2">
              <code className="bg-ink-50 text-ink-700 max-w-full truncate rounded px-2 py-1 text-xs">{url}</code>
              <button
                type="button"
                onClick={() => void navigator.clipboard.writeText(url).then(() => (setCopied(true), setTimeout(() => setCopied(false), 2000)))}
                className="text-brand-700 text-xs font-medium hover:underline"
              >
                {copied ? "Copied" : "Copy link"}
              </button>
              <a href={url} target="_blank" rel="noreferrer" className="text-brand-700 text-xs font-light hover:underline">
                Open ↗
              </a>
              <button type="button" disabled={off.isPending} onClick={() => off.mutate({ salesRequestId })} className="text-xs font-light text-[#c03654] hover:underline">
                Switch off
              </button>
            </div>
          ) : (
            <div>
              <p className="text-ink-500 text-xs font-light">A link for the client to fill in their rooming list. No sign-in, so send it only to them.</p>
              <button type="button" disabled={make.isPending} onClick={() => make.mutate({ salesRequestId })} className="text-brand-700 mt-1.5 text-[13px] font-medium hover:underline">
                {make.isPending ? "Making the link…" : data.data?.madeAt ? "Make a new link" : "Make a link for the client"}
              </button>
            </div>
          )}
          {error && <FormError message={friendlyError(error)} />}
        </div>
        <AskFor salesRequestId={salesRequestId} fields={data.data?.fields ?? []} />
      </Card>
      <Submissions mode={{ salesRequestId }} />
      <RoomingList salesRequestId={salesRequestId} />
    </div>
  );
}

/** What else the list asks for, per guest — name and arrival always (doc §6.9). */
function AskFor({ salesRequestId, fields }: { salesRequestId: string; fields: string[] }) {
  const utils = api.useUtils();
  const set = api.rooming.setFields.useMutation({ onSuccess: () => (void utils.rooming.invalidate(), void utils.audit.invalidate()) });
  return (
    <div className="border-ink-200/60 mt-3 border-t pt-3">
      <p className="text-ink-900 text-[13px] font-medium">Also ask for, per guest</p>
      <p className="text-ink-500 text-xs font-light">Name and arrival are always asked. Some properties and countries need more — Japan, for one, asks for foreign guests&rsquo; passport details.</p>
      <div className="mt-1.5 flex flex-wrap gap-x-4 gap-y-1">
        {roomingExtraFields.map((field) => (
          <label key={field.key} className="text-ink-700 flex items-center gap-1.5 text-[13px]">
            <input
              type="checkbox"
              checked={fields.includes(field.key)}
              disabled={set.isPending}
              onChange={(e) =>
                set.mutate({
                  salesRequestId,
                  fields: roomingExtraFields.map((one) => one.key).filter((key) => (key === field.key ? e.target.checked : fields.includes(key))),
                })
              }
              className="accent-brand-500"
            />
            {field.label}
          </label>
        ))}
      </div>
    </div>
  );
}

// --- Submitted versions (doc §6.9, the owner 2026-11-24) ------------------------------

/** "24 Nov 2026, 14:53" — in the reader's own time. */
const stamp = (at: Date | string) => new Date(at).toLocaleString("en-GB", { day: "numeric", month: "short", year: "numeric", hour: "2-digit", minute: "2-digit" });

type Submitted = RouterOutputs["rooming"]["submissions"];
type Version = Submitted["versions"][number];

/**
 * The client's versions, neatly along the top, each named by when it was
 * submitted — opened to see what it changed and the list as it was — and
 * Submit: on the client's link a bar along the bottom of the screen; for the
 * team, "Save as a version" (the owner: "They should actually have to click
 * submit. And it should save as a version").
 */
function Submissions({ mode }: { mode: Mode }) {
  const utils = api.useUtils();
  const team = api.rooming.submissions.useQuery({ salesRequestId: mode.salesRequestId ?? "" }, { enabled: Boolean(mode.salesRequestId) });
  const link = api.rooming.submissionsByLink.useQuery({ token: mode.token ?? "" }, { enabled: Boolean(mode.token), retry: false });
  const done = () => void utils.rooming.invalidate();
  const submitTeam = api.rooming.submit.useMutation({ onSuccess: () => (done(), void utils.audit.invalidate()) });
  const submitLink = api.rooming.submitByLink.useMutation({ onSuccess: done });
  const [open, setOpen] = useState<Version | null>(null);
  const [thanks, setThanks] = useState<number | null>(null);
  const data = mode.token ? link.data : team.data;
  const submit = mode.token ? submitLink : submitTeam;
  if (!data) return null;
  const { versions, pending, last } = data;
  const client = Boolean(mode.token);
  const go = () =>
    void (mode.token ? submitLink.mutateAsync({ token: mode.token }) : submitTeam.mutateAsync({ salesRequestId: mode.salesRequestId! })).then((made) => setThanks(made.number)).catch(() => undefined);

  const status = pending.length
    ? client
      ? `${changeCount(pending)} — not submitted yet`
      : `Since ${last ? `version ${last.number}` : "the start"}: ${changeCount(pending)}, not in a version yet`
    : last
      ? `Version ${last.number} submitted ${stamp(last.submittedAt)} — nothing changed since`
      : client
        ? "Put in your guests, then submit."
        : "The client has not submitted the list yet.";

  return (
    <>
      <div className={client ? "border-ink-200 flex flex-wrap items-center gap-x-3 gap-y-2 border-b pb-4" : "border-ink-200/60 flex flex-wrap items-center gap-x-3 gap-y-2 rounded-xl border bg-white px-4 py-3"}>
        <span className="text-ink-500 text-[11px] font-medium tracking-wide uppercase">{client ? "Your submitted versions" : "Submitted versions"}</span>
        {versions.length ? (
          versions.map((version) => (
            <button
              key={version.number}
              type="button"
              onClick={() => setOpen(version)}
              className={`rounded-full border px-3 py-1 text-xs transition-colors ${version.number === last?.number ? "border-brand-300 bg-brand-50 text-brand-800 font-medium" : "border-ink-200 text-ink-700 hover:bg-ink-50 bg-white font-light"}`}
              title={`Version ${version.number}, by ${version.by} — ${changeCount(version.changes)}`}
            >
              {stamp(version.submittedAt)}
            </button>
          ))
        ) : (
          <span className="text-ink-500 text-xs font-light">None yet</span>
        )}
        {!client && (
          <div className="ml-auto flex flex-wrap items-center gap-3">
            <span className={`text-xs ${pending.length ? "font-medium text-[#b45309]" : "text-ink-500 font-light"}`}>{status}</span>
            {pending.length > 0 && (
              <button type="button" disabled={submit.isPending} onClick={go} className="border-ink-200 text-ink-700 hover:bg-ink-50 rounded-full border bg-white px-3 py-1 text-xs font-light">
                {submit.isPending ? "Saving…" : "Save as a version"}
              </button>
            )}
          </div>
        )}
        {!client && submit.error && <FormError message={friendlyError(submit.error)} />}
      </div>

      {client && (
        <div className="border-ink-200 fixed inset-x-0 bottom-0 z-30 border-t bg-white/95 px-4 py-3 shadow-[0_-4px_16px_rgba(0,0,0,0.06)] backdrop-blur sm:px-8">
          <div className="mx-auto flex max-w-[1400px] flex-wrap items-center justify-between gap-3">
            <div className="text-[13px]">
              {thanks && !pending.length ? (
                <span className="font-medium text-[#0a7a47]">Thank you — version {thanks} is with We Lodge. Come back to change it any time, then submit again.</span>
              ) : (
                <span className={pending.length ? "text-ink-900 font-medium" : "text-ink-500 font-light"}>{status}</span>
              )}
              {submit.error && <span className="ml-2 text-[#c03654]">{friendlyError(submit.error)}</span>}
            </div>
            <Button type="button" disabled={submit.isPending || pending.length === 0} onClick={() => (setThanks(null), go())}>
              {submit.isPending ? "Submitting…" : "Submit rooming list"}
            </Button>
          </div>
        </div>
      )}
      {open && <VersionPopup version={open} client={client} onClose={() => setOpen(null)} />}
    </>
  );
}

const changeTone: Record<ListChange["kind"], string> = { new: "text-[#0a7a47]", changed: "text-[#b45309]", removed: "text-[#c03654]" };
const changeWord: Record<ListChange["kind"], string> = { new: "New", changed: "Changed", removed: "Taken out" };

/** One submitted version: what it changed from the one before, and the list as it was. */
function VersionPopup({ version, client, onClose }: { version: Version; client: boolean; onClose: () => void }) {
  const properties = [...new Set(version.stays.map((stay) => stay.property))].sort();
  return (
    <Popup title={`Version ${version.number} — ${stamp(version.submittedAt)}`} subtitle={`Submitted by ${version.by} · ${changeCount(version.changes)}${version.number === 1 ? " (the first)" : ` since version ${version.number - 1}`}`} onClose={onClose}>
      <div className="space-y-6 text-[13px]">
        {version.changes.length > 0 && (
          <section>
            <h3 className="text-ink-900 mb-2 text-[14px] font-medium">{version.number === 1 ? "In it" : `What changed since version ${version.number - 1}`}</h3>
            <ul className="divide-ink-100 divide-y">
              {version.changes.map((change, i) => (
                <li key={i} className="grid gap-1 py-1.5 sm:grid-cols-[6rem_1fr]">
                  <span className={`font-medium ${changeTone[change.kind]}`}>{changeWord[change.kind]}</span>
                  <span className="text-ink-700 font-light">
                    <span className="text-ink-900">{change.guests}</span> · {change.room}
                    {properties.length > 1 || change.kind === "removed" ? ` · ${change.property}` : ""} · {change.dates}
                    {change.detail.length > 0 && <span className="text-ink-500 block text-xs">{change.detail.join("; ")}</span>}
                  </span>
                </li>
              ))}
            </ul>
          </section>
        )}
        {properties.map((property) => (
          <section key={property}>
            <h3 className="text-ink-900 border-ink-900 mb-1 border-b-2 pb-1 text-[14px] font-medium">{property}</h3>
            <table className="w-full text-left">
              <thead className="text-ink-500 text-[11px] tracking-wide uppercase">
                <tr>
                  <th className="py-1.5 pr-3 font-medium">Room</th>
                  <th className="py-1.5 pr-3 font-medium">Guests</th>
                  <th className="py-1.5 pr-3 font-medium">Dates</th>
                  <th className="py-1.5 pr-3 font-medium">Arriving</th>
                  <th className="py-1.5 font-medium">Notes</th>
                </tr>
              </thead>
              <tbody className="divide-ink-100 divide-y font-light">
                {version.stays
                  .filter((stay) => stay.property === property)
                  .sort((a, b) => a.slotNumber - b.slotNumber || a.checkIn.localeCompare(b.checkIn))
                  .map((stay) => (
                    <tr key={stay.stayId}>
                      <td className="py-1.5 pr-3">{stay.room}</td>
                      <td className="text-ink-900 py-1.5 pr-3">{stay.guests.map(name).filter(Boolean).join(", ") || "—"}</td>
                      <td className="py-1.5 pr-3 whitespace-nowrap">{range(stay.checkIn, stay.checkOut)}</td>
                      <td className="py-1.5 pr-3">{stay.arrival ?? ""}</td>
                      <td className="py-1.5">{stay.notes ?? ""}</td>
                    </tr>
                  ))}
              </tbody>
            </table>
          </section>
        ))}
        {!version.stays.length && <p className="text-ink-500 font-light">Nobody was named in this version.</p>}
        {client && <p className="text-ink-500 text-xs font-light">This is the list as you submitted it then. Your list now is on the page.</p>}
      </div>
    </Popup>
  );
}

// --- Sending the master list to the property (doc §6.9, the owner 2026-11-24) ----------

/** "A send to hotel button where we can insert an email address and a message." */
function SendToProperty({
  eventId,
  propertyId,
  property,
  event,
  next,
  changes,
  addresses,
  onClose,
}: {
  eventId: string;
  propertyId: string;
  property: string;
  event: string;
  next: number;
  changes: boolean;
  addresses: { email: string; label: string }[];
  onClose: () => void;
}) {
  const utils = api.useUtils();
  const me = api.user.me.useQuery(undefined, { staleTime: 60_000 });
  const [to, setTo] = useState(addresses[0]?.email ?? "");
  const [message, setMessage] = useState<string | null>(null);
  const send = api.rooming.sendToProperty.useMutation({ onSuccess: () => (void utils.rooming.invalidate(), void utils.audit.invalidate()) });
  const signOff = me.data?.name ?? "";
  const text =
    message ??
    `Dear ${property} team,\n\nPlease find attached our rooming list for ${event}, version ${next}.${changes && next > 1 ? ` Changes since version ${next - 1} are highlighted in yellow and listed on the second sheet.` : ""}\n\nPlease let us know if anything is unclear.\n\nKind regards,\n${signOff}${signOff ? "\n" : ""}We Lodge`;
  const list = to
    .split(/[,;\s]+/)
    .map((one) => one.trim())
    .filter(Boolean);
  const add = (email: string) => setTo((now) => (list.some((one) => one.toLowerCase() === email.toLowerCase()) ? now : [now.trim(), email].filter(Boolean).join(", ")));
  if (send.data) {
    return (
      <Popup title="Sent" size="medium" onClose={onClose}>
        <p className="text-ink-700 text-[13px] font-light">
          Version {send.data.number} went to {list.join(", ")}, with the Excel attached and a copy to you. Replies come to your inbox. It is kept on this tab as version {send.data.number}.
        </p>
        <div className="mt-4">
          <Button type="button" onClick={onClose}>
            Done
          </Button>
        </div>
      </Popup>
    );
  }
  return (
    <Popup title={`Send version ${next} to ${property}`} subtitle="The Excel goes attached; a copy comes to you, and replies come to your inbox" size="medium" onClose={onClose}>
      <form
        className="space-y-4"
        onSubmit={(e) => {
          e.preventDefault();
          send.mutate({ eventId, propertyId, to: list, message: text });
        }}
      >
        <Field label="To" hint="More than one? Separate them with commas.">
          <Input type="text" value={to} onChange={(e) => setTo(e.target.value)} placeholder="reservations@hotel.com" autoFocus />
        </Field>
        {addresses.length > 0 && (
          <div className="-mt-2 flex flex-wrap gap-1.5">
            {addresses.map((one) => (
              <button key={one.email} type="button" onClick={() => add(one.email)} className="border-ink-200 text-ink-700 hover:bg-ink-50 rounded-full border bg-white px-2.5 py-0.5 text-xs font-light" title={one.label}>
                + {one.email}
                {one.label && <span className="text-ink-400"> · {one.label}</span>}
              </button>
            ))}
          </div>
        )}
        <Field label="Message">
          <Textarea rows={9} value={text} onChange={(e) => setMessage(e.target.value)} />
        </Field>
        <p className="text-ink-500 text-xs font-light">Attached: Rooming list V{next} — {property}.xlsx</p>
        <FormError message={send.error ? friendlyError(send.error) : null} />
        <div className="flex gap-2">
          <Button type="submit" disabled={send.isPending || list.length === 0}>
            {send.isPending ? "Sending…" : "Send"}
          </Button>
          <Button type="button" variant="secondary" onClick={onClose}>
            Cancel
          </Button>
        </div>
      </form>
    </Popup>
  );
}
