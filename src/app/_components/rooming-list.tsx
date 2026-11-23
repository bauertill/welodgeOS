"use client";

import { useEffect, useState } from "react";

import { Button, FormError, friendlyError, Input } from "~/app/_components/form";
import { Card } from "~/app/_components/ui";
import { parseDay } from "~/lib/dates";
import { formatDate, formatRange } from "~/lib/format";
import { api, type RouterOutputs } from "~/trpc/react";

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
  const nights = properties.flatMap((property) => property.rooms).reduce((sum, room) => sum + room.nights, 0);
  const named = properties.flatMap((property) => property.rooms).reduce((sum, room) => sum + room.named, 0);

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
      <p className="text-ink-700 text-[13px] font-light">
        <span className="text-ink-900 font-medium">
          {named} of {nights} nights named
        </span>{" "}
        across {properties.reduce((sum, property) => sum + property.rooms.length, 0)} rooms.
      </p>
      {properties.map((property) => (
        <PropertyRooms key={property.id} property={property} mode={mode} rooming={rooming} />
      ))}
    </div>
  );
}

function PropertyRooms({ property, mode, rooming }: { property: Property; mode: Mode; rooming: ReturnType<typeof useRooming> }) {
  const team = Boolean(mode.salesRequestId);
  const utils = api.useUtils();
  const markSent = api.rooming.markSent.useMutation({ onSuccess: () => (void utils.rooming.invalidate(), void utils.audit.invalidate()) });
  const changes = property.rooms.flatMap((room) => room.stays).filter((stay) => stay.changedSinceSent).length;
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
      <ul className="divide-ink-200/60 divide-y">
        {property.rooms.map((room) => (
          <RoomRow key={room.slotId} room={room} team={team} rooming={rooming} />
        ))}
      </ul>
    </section>
  );
}

function RoomRow({ room, team, rooming }: { room: Room; team: boolean; rooming: ReturnType<typeof useRooming> }) {
  const [adding, setAdding] = useState(false);
  const [editing, setEditing] = useState<string | null>(null);
  const active = room.stays.filter((stay) => !stay.removed);
  // The first booked stretch nobody is named for yet — what a new stay starts as.
  const free = room.booked.find((booked) => !active.some((stay) => stay.checkIn < booked.checkOut && stay.checkOut > booked.checkIn)) ?? room.booked[0]!;
  const full = room.named >= room.nights;
  return (
    <li className="px-5 py-3.5">
      <div className="flex flex-wrap items-baseline justify-between gap-x-4 gap-y-1">
        <div className="flex flex-wrap items-baseline gap-x-2">
          <span className="text-ink-900 text-[14px] font-medium">{room.category}</span>
          {team ? <UnitNumber room={room} /> : room.unitNumber ? <span className="text-ink-700 text-[13px]">· No. {room.unitNumber}</span> : null}
          <span className="text-ink-400 text-xs font-light">{team ? "our room" : "room"} {room.slotNumber} · sleeps {room.capacity}</span>
        </div>
        <span className={`text-xs font-light ${full ? "text-[#0a7a47]" : "text-ink-500"}`}>
          Booked {room.booked.map((booked) => range(booked.checkIn, booked.checkOut)).join(", ")}
          {full ? " · ✓ all named" : ` · ${room.named} of ${room.nights} nights named`}
        </span>
      </div>

      {room.stays.length > 0 && (
        <ul className="mt-2 space-y-1.5">
          {room.stays.map((stay) =>
            editing === stay.id ? (
              <li key={stay.id}>
                <StayForm room={room} stay={stay} rooming={rooming} onDone={() => setEditing(null)} />
              </li>
            ) : (
              <StayLine key={stay.id} stay={stay} team={team} rooming={rooming} onEdit={() => setEditing(stay.id)} />
            ),
          )}
        </ul>
      )}

      {adding ? (
        <div className="mt-2">
          <StayForm room={room} start={free} rooming={rooming} onDone={() => setAdding(false)} />
        </div>
      ) : (
        !full && (
          <button type="button" onClick={() => setAdding(true)} className="text-brand-700 mt-2 text-[13px] font-medium hover:underline">
            + Add guests
          </button>
        )
      )}
    </li>
  );
}

function StayLine({ stay, team, rooming, onEdit }: { stay: Stay; team: boolean; rooming: ReturnType<typeof useRooming>; onEdit: () => void }) {
  const [problem, setProblem] = useState<string | null>(null);
  return (
    <li
      className={`flex flex-wrap items-start justify-between gap-2 rounded-lg px-3 py-2 text-[13px] ${
        stay.removed ? "bg-[#fdecec] line-through decoration-[#c03654]/60" : stay.changedSinceSent ? "bg-[#fff4e0]" : "bg-ink-50/70"
      }`}
    >
      <div className="min-w-0">
        <p className="text-ink-900 font-medium">{stay.guests.map(name).join(", ")}</p>
        <p className="text-ink-500 text-xs font-light">
          {range(stay.checkIn, stay.checkOut)}
          {stay.arrival && <> · arriving {stay.arrival}</>}
          {stay.notes && <> · {stay.notes}</>}
        </p>
        {team && (stay.removed || stay.changedSinceSent) && (
          <p className="text-xs font-medium text-[#b45309] no-underline">
            {stay.removed ? "Taken out" : "Changed"} since the list was sent — by {stay.changedBy}
          </p>
        )}
        {problem && <p className="text-xs text-[#c03654]">{problem}</p>}
      </div>
      {!stay.removed && (
        <span className="flex gap-3 text-xs">
          <button type="button" onClick={onEdit} className="text-brand-700 hover:underline">
            Change
          </button>
          <button
            type="button"
            onClick={() => {
              if (!window.confirm(`Take ${stay.guests.map(name).join(", ")} out of this room?`)) return;
              rooming.remove(stay.id).catch((error: unknown) => setProblem(error instanceof Error ? error.message : "Could not take them out."));
            }}
            className="hover:underline text-[#c03654]"
          >
            Take out
          </button>
        </span>
      )}
    </li>
  );
}

/** Add or change a stay: dates within what was booked, the guests sharing, their arrival. */
function StayForm({ room, stay, start, rooming, onDone }: { room: Room; stay?: Stay; start?: { checkIn: string; checkOut: string }; rooming: ReturnType<typeof useRooming>; onDone: () => void }) {
  const [checkIn, setCheckIn] = useState(stay?.checkIn ?? start?.checkIn ?? "");
  const [checkOut, setCheckOut] = useState(stay?.checkOut ?? start?.checkOut ?? "");
  const [guests, setGuests] = useState(stay?.guests.length ? stay.guests : [{ firstName: "", lastName: "" }]);
  const [arrival, setArrival] = useState(stay?.arrival ?? "");
  const [notes, setNotes] = useState(stay?.notes ?? "");
  const [pending, setPending] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const first = room.booked[0]!.checkIn;
  const last = room.booked.at(-1)!.checkOut;
  const setGuest = (index: number, change: Partial<{ firstName: string; lastName: string }>) => setGuests(guests.map((guest, i) => (i === index ? { ...guest, ...change } : guest)));

  return (
    <form
      className="border-brand-200 bg-brand-50/40 space-y-2.5 rounded-xl border p-3"
      onSubmit={(e) => {
        e.preventDefault();
        setPending(true);
        setError(null);
        rooming
          .save({ id: stay?.id, slotId: room.slotId, checkIn, checkOut, guests, arrival, notes })
          .then(onDone)
          .catch((failure: unknown) => setError(failure instanceof Error ? failure.message : "Could not save."))
          .finally(() => setPending(false));
      }}
    >
      <div className="flex flex-wrap items-end gap-2">
        <label className="text-ink-700 text-xs">
          Check-in
          <Input type="date" value={checkIn} min={first} max={last} onChange={(e) => setCheckIn(e.target.value)} className="mt-0.5 w-40 px-2" required />
        </label>
        <label className="text-ink-700 text-xs">
          Check-out
          <Input type="date" value={checkOut} min={first} max={last} onChange={(e) => setCheckOut(e.target.value)} className="mt-0.5 w-40 px-2" required />
        </label>
        <label className="text-ink-700 min-w-48 flex-1 text-xs">
          Arriving — a time or a flight
          <Input value={arrival} onChange={(e) => setArrival(e.target.value)} placeholder="e.g. 14:30, BA 283" className="mt-0.5" />
        </label>
      </div>
      <div className="space-y-1.5">
        <p className="text-ink-700 text-xs">
          Guests in this room for these dates <span className="text-ink-400">(sleeps {room.capacity})</span>
        </p>
        {guests.map((guest, index) => (
          <div key={index} className="flex gap-2">
            <Input value={guest.firstName} onChange={(e) => setGuest(index, { firstName: e.target.value })} placeholder="First name" aria-label={`Guest ${index + 1} first name`} className="min-w-0 flex-1" />
            <Input value={guest.lastName} onChange={(e) => setGuest(index, { lastName: e.target.value })} placeholder="Last name" aria-label={`Guest ${index + 1} last name`} className="min-w-0 flex-1" />
            {guests.length > 1 && (
              <button type="button" onClick={() => setGuests(guests.filter((_, i) => i !== index))} className="text-ink-400 px-1 text-lg leading-none hover:text-[#c03654]" aria-label={`Remove guest ${index + 1}`}>
                ×
              </button>
            )}
          </div>
        ))}
        {guests.length < room.capacity && (
          <button type="button" onClick={() => setGuests([...guests, { firstName: "", lastName: "" }])} className="text-brand-700 text-xs font-medium hover:underline">
            + Someone sharing the room
          </button>
        )}
      </div>
      <Input value={notes} onChange={(e) => setNotes(e.target.value)} placeholder="Notes — optional (e.g. accessible room, late check-out)" aria-label="Notes" />
      <div className="flex flex-wrap items-center gap-2">
        <Button type="submit" disabled={pending}>
          {pending ? "Saving…" : "Save"}
        </Button>
        <Button type="button" variant="ghost" onClick={onDone}>
          Cancel
        </Button>
        {error && <FormError message={error} />}
      </div>
    </form>
  );
}

/** The building's own number for the room, typed in once known (doc §6.9). */
function UnitNumber({ room }: { room: Room }) {
  const utils = api.useUtils();
  const [value, setValue] = useState(room.unitNumber ?? "");
  useEffect(() => setValue(room.unitNumber ?? ""), [room.unitNumber]);
  const save = api.rooming.setUnitNumber.useMutation({ onSuccess: () => (void utils.rooming.invalidate(), void utils.audit.invalidate()) });
  return (
    <span className="inline-flex items-center gap-1 text-[13px]">
      <span className="text-ink-500">No.</span>
      <input
        value={value}
        onChange={(e) => setValue(e.target.value)}
        onBlur={() => value.trim() !== (room.unitNumber ?? "") && save.mutate({ slotId: room.slotId, unitNumber: value })}
        onKeyDown={(e) => e.key === "Enter" && (e.target as HTMLInputElement).blur()}
        placeholder="not known yet"
        aria-label="Room number"
        className="border-ink-200 focus:border-brand-400 w-24 rounded border-b border-dashed bg-transparent px-1 text-[13px] outline-none"
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
