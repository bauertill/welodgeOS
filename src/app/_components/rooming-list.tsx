"use client";

import { useEffect, useState } from "react";

import { Button, FormError, friendlyError } from "~/app/_components/form";
import { Popup } from "~/app/_components/popup";
import { Card } from "~/app/_components/ui";
import { parseDay } from "~/lib/dates";
import { formatDate, formatRange } from "~/lib/format";
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
  type StayFields = { id?: string; slotId: string; checkIn: string; checkOut: string; guests: { firstName: string; lastName: string }[]; arrival: string; notes: string };
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
  const allRooms = properties.flatMap((property) => property.rooms);
  const nights = allRooms.reduce((sum, room) => sum + room.nights, 0);
  const named = allRooms.reduce((sum, room) => sum + room.named, 0);

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
        <p className="text-ink-700 text-[13px] font-light">
          <span className="text-ink-900 font-medium">
            {named} of {nights} nights named
          </span>{" "}
          across {allRooms.length} rooms. Type straight into the sheet — each row saves when you leave it.
        </p>
        <button
          type="button"
          onClick={() => setImporting(true)}
          className="border-brand-300 text-brand-700 hover:bg-brand-50 rounded-full border bg-white px-4 py-1.5 text-[13px] font-medium"
        >
          ⬆ {team ? "Read the client's Excel" : "Upload your own Excel or CSV"}
        </button>
      </div>
      {properties.map((property) => (
        <PropertySheet key={property.id} property={property} mode={mode} rooming={rooming} />
      ))}
      {importing && <ImportSheet mode={mode} year={rooming.data.event ? new Date(rooming.data.event.startDate).getUTCFullYear() : new Date().getUTCFullYear()} multipleProperties={properties.length > 1} onClose={() => setImporting(false)} />}
    </div>
  );
}

/** The guest columns a property's sheet needs: as many as its largest room sleeps, at most four. */
const guestColumns = (property: Property) => Math.min(4, Math.max(1, ...property.rooms.map((room) => room.capacity)));

function PropertySheet({ property, mode, rooming }: { property: Property; mode: Mode; rooming: ReturnType<typeof useRooming> }) {
  const team = Boolean(mode.salesRequestId);
  const utils = api.useUtils();
  const markSent = api.rooming.markSent.useMutation({ onSuccess: () => (void utils.rooming.invalidate(), void utils.audit.invalidate()) });
  const changes = property.rooms.flatMap((room) => room.stays).filter((stay) => stay.changedSinceSent).length;
  const columns = guestColumns(property);
  const th = "text-ink-500 border-ink-200/60 border-b px-2 py-2 text-left text-[11px] font-medium tracking-wide whitespace-nowrap uppercase";
  return (
    <section className="border-ink-200/60 overflow-hidden rounded-2xl border bg-white">
      <header className="border-ink-200/60 flex flex-wrap items-start justify-between gap-3 border-b px-5 py-4">
        <div>
          <h2 className="text-ink-900 text-[16px] font-medium">{property.name}</h2>
          {team && (
            <p className="text-ink-500 mt-0.5 text-xs font-light">
              {property.sentAt ? (
                <>
                  Sent to the property {formatDate(property.sentAt)}
                  {property.sentBy && <> by {property.sentBy}</>}
                  {changes > 0 ? <span className="font-medium text-[#b45309]"> · {changes} change{changes === 1 ? "" : "s"} since — pass them on</span> : " · no changes since"}
                </>
              ) : (
                "Not sent to the property yet"
              )}
            </p>
          )}
        </div>
        {team && (
          <div className="flex flex-wrap items-center gap-3 text-[13px]">
            <a href={`/api/rooming/${mode.salesRequestId}/${property.id}`} className="text-brand-700 font-medium hover:underline">
              ⬇ Download Excel
            </a>
            <button
              type="button"
              disabled={markSent.isPending}
              onClick={() => markSent.mutate({ salesRequestId: mode.salesRequestId!, propertyId: property.id })}
              className="border-ink-200 text-ink-700 hover:bg-ink-50 rounded-full border px-3 py-1 text-xs font-light"
            >
              {markSent.isPending ? "Saving…" : property.sentAt ? "Sent again" : "Mark as sent to the property"}
            </button>
          </div>
        )}
      </header>
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
                </th>
              ))}
              <th className={th}>Arriving</th>
              <th className={th}>Notes</th>
              <th className={th} aria-label="Actions" />
            </tr>
          </thead>
          <tbody>
            {property.rooms.map((room) => (
              <RoomRows key={room.slotId} room={room} columns={columns} team={team} rooming={rooming} />
            ))}
          </tbody>
        </table>
      </div>
    </section>
  );
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

function RoomRows({ room, columns, team, rooming }: { room: Room; columns: number; team: boolean; rooming: ReturnType<typeof useRooming> }) {
  const free = freeStretch(room);
  const rows = room.stays.length + (free ? 1 : 0);
  const full = room.named >= room.nights;
  const roomCell = (
    <td rowSpan={rows} className="border-ink-200/60 border-b bg-white px-3 py-2 align-top" style={{ minWidth: "15rem" }}>
      <div className="flex flex-wrap items-baseline gap-x-2 whitespace-nowrap">
        <span className="text-ink-900 font-medium">{room.category}</span>
        {team ? <UnitNumber room={room} /> : room.unitNumber ? <span className="text-ink-700 text-xs">No. {room.unitNumber}</span> : null}
      </div>
      <p className="text-ink-400 text-[11px] font-light whitespace-nowrap">
        {team ? "our room" : "room"} {room.slotNumber} · sleeps {room.capacity} ·{" "}
        <span className={full ? "text-[#0a7a47]" : ""}>{full ? "✓ all named" : `${room.named}/${room.nights} nights named`}</span>
      </p>
      <p className="text-ink-400 text-[11px] font-light">Booked {room.booked.map((booked) => range(booked.checkIn, booked.checkOut)).join(", ")}</p>
    </td>
  );
  return (
    <>
      {room.stays.map((stay, index) => (
        <SheetRow key={stay.id} room={room} stay={stay} columns={columns} team={team} rooming={rooming} lead={index === 0 ? roomCell : null} last={!free && index === room.stays.length - 1} />
      ))}
      {free && <SheetRow key={`new-${free.checkIn}`} room={room} start={free} columns={columns} team={team} rooming={rooming} lead={room.stays.length === 0 ? roomCell : null} last />}
    </>
  );
}

/** A full name split as hotels want it: the last word is the last name. */
const splitName = (full: string) => {
  const words = full.trim().split(/\s+/).filter(Boolean);
  return words.length <= 1 ? { firstName: words[0] ?? "", lastName: "" } : { firstName: words.slice(0, -1).join(" "), lastName: words.at(-1)! };
};

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
  lead,
  last,
}: {
  room: Room;
  stay?: Stay;
  start?: { checkIn: string; checkOut: string };
  columns: number;
  team: boolean;
  rooming: ReturnType<typeof useRooming>;
  lead: React.ReactNode;
  last: boolean;
}) {
  const initial = () => ({
    checkIn: stay?.checkIn ?? start?.checkIn ?? "",
    checkOut: stay?.checkOut ?? start?.checkOut ?? "",
    names: Array.from({ length: columns }, (_, i) => (stay?.guests[i] ? name(stay.guests[i]) : "")),
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
  const first = room.booked[0]!.checkIn;
  const lastDay = room.booked.at(-1)!.checkOut;

  const save = () => {
    if (!dirty || removed) return;
    const guests = draft.names.map(splitName).filter((guest) => guest.firstName || guest.lastName);
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

  const cell = `border-ink-200/60 px-1 py-1 align-top ${last ? "border-b" : ""}`;
  const input = `w-full rounded-md border border-transparent bg-transparent px-2 py-1.5 text-[13px] outline-none hover:border-ink-200 focus:border-brand-400 focus:bg-white ${removed ? "line-through text-ink-400" : "text-ink-900"}`;
  const tone = removed ? "bg-[#fdecec]" : stay?.changedSinceSent ? "bg-[#fff4e0]" : !stay ? "bg-white" : "";
  return (
    <>
      <tr
        className={tone}
        onBlur={(e) => {
          // Left the row altogether — not just moved to its next cell.
          if (!e.currentTarget.contains(e.relatedTarget as Node | null)) save();
        }}
      >
        {lead}
        <td className={cell}>
          <input type="date" value={draft.checkIn} min={first} max={lastDay} disabled={removed} onChange={(e) => setDraft({ ...draft, checkIn: e.target.value })} aria-label="Check-in" className={`${input} w-36`} />
        </td>
        <td className={cell}>
          <input type="date" value={draft.checkOut} min={first} max={lastDay} disabled={removed} onChange={(e) => setDraft({ ...draft, checkOut: e.target.value })} aria-label="Check-out" className={`${input} w-36`} />
        </td>
        {draft.names.map((value, i) => (
          <td key={i} className={cell}>
            {i < room.capacity ? (
              <input
                value={value}
                disabled={removed}
                onChange={(e) => setDraft({ ...draft, names: draft.names.map((one, j) => (j === i ? e.target.value : one)) })}
                onKeyDown={(e) => e.key === "Enter" && (e.target as HTMLInputElement).blur()}
                placeholder={!stay && i === 0 ? "Type a name…" : ""}
                aria-label={`Guest ${i + 1}`}
                className={input}
              />
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
      {(problem ?? (team && stay && (removed || stay.changedSinceSent))) && (
        <tr className={tone}>
          <td colSpan={columns + 5} className="px-3 pb-2 text-xs">
            {problem && <span className="text-[#c03654]">{problem}</span>}
            {!problem && team && stay && (
              <span className="font-medium text-[#b45309]">
                {removed ? "Taken out" : "Changed"} since the list was sent — by {stay.changedBy}
              </span>
            )}
          </td>
        </tr>
      )}
    </>
  );
}

// --- Reading the client's own spreadsheet -------------------------------------------

type Field = "name" | "firstName" | "lastName" | "name2" | "checkIn" | "checkOut" | "property" | "roomType" | "roomNumber" | "group" | "arrival" | "notes";
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
];

/**
 * The client's own rooming list, read and matched (doc §6.9, the owner
 * 2026-11-23): choose the file, say which column is which (guessed from its
 * headings), see what it would add, change and could not place — and why —
 * then apply it. Nothing changes before Apply.
 */
function ImportSheet({ mode, year, multipleProperties, onClose }: { mode: Mode; year: number; multipleProperties: boolean; onClose: () => void }) {
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
    for (const field of fields) {
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
      const guests: { firstName: string; lastName: string }[] = [];
      if (map.firstName !== undefined || map.lastName !== undefined) guests.push({ firstName: text(row, "firstName") ?? "", lastName: text(row, "lastName") ?? "" });
      else if (text(row, "name")) guests.push(splitName(text(row, "name")!));
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
                  {fields
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
          by their link, or you do it here. Number the rooms once you know them; download each property&rsquo;s list for it, and mark it sent so later
          changes are flagged.
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
      </Card>
      <RoomingList salesRequestId={salesRequestId} />
    </div>
  );
}
