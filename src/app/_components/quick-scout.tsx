"use client";

import type { PropertyType } from "generated/prisma";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { useEffect, useMemo, useRef, useState } from "react";
import { createPortal } from "react-dom";

import { AddressSearch } from "~/app/_components/address-search";
import { Button, FormError, friendlyError, Input, Label, Textarea } from "~/app/_components/form";
import { LocationPreview } from "~/app/_components/location-preview";
import { normalizePropertyName, propertyTypeLabels } from "~/lib/scouting";
import { api } from "~/trpc/react";

/**
 * Scouting a property, quickly (doc §3.1): only what is known on a first look
 * — what and where it is, its room types, amenities and one contact — on one
 * screen, with the map found from the address. Everything else is filled in
 * later on the property's page, which edits in place. The full form is still
 * one click away.
 */

type Room = { name: string; rooms: string; sleeps: string };
type Draft = {
  name: string;
  type: PropertyType;
  stars: number | null;
  address: string;
  city: string;
  country: string;
  latitude: string;
  longitude: string;
  website: string;
  phone: string;
  rooms: Room[];
  amenityIds: string[];
  contactName: string;
  contactEmail: string;
  contactPhone: string;
  notes: string;
};

const blankRoom = (): Room => ({ name: "", rooms: "", sleeps: "2" });
const blank = (): Draft => ({
  name: "",
  type: "HOTEL",
  stars: null,
  address: "",
  city: "",
  country: "",
  latitude: "",
  longitude: "",
  website: "",
  phone: "",
  rooms: [blankRoom()],
  amenityIds: [],
  contactName: "",
  contactEmail: "",
  contactPhone: "",
  notes: "",
});

const roomNames: Record<PropertyType, string[]> = {
  HOTEL: ["Standard", "Double", "Twin", "King", "Suite"],
  APARTMENT: ["Studio", "1 Bedroom", "2 Bedroom", "3 Bedroom"],
  APARTHOTEL: ["Studio", "1 Bedroom", "2 Bedroom"],
};

const text = (value: string) => value.trim() || undefined;
const num = (value: string) => {
  const parsed = Number(value.trim().replace(",", "."));
  return value.trim() && Number.isFinite(parsed) ? parsed : undefined;
};

export function QuickScout({
  amenities,
  existingNames,
  event,
  onSaved,
  onCancel,
  onDirtyChange,
}: {
  amenities: { id: string; label: string }[];
  existingNames: { id: string; name: string }[];
  event: { id: string; name: string } | null;
  /** In the pop-up: called once saved, instead of going to the event's page. */
  onSaved?: () => void;
  onCancel?: () => void;
  /** In the pop-up: whether anything has been typed, so closing can ask first. */
  onDirtyChange?: (dirty: boolean) => void;
}) {
  const inPopup = Boolean(onSaved);
  const router = useRouter();
  const utils = api.useUtils();
  const [draft, setDraft] = useState<Draft>(blank);
  const [problem, setProblem] = useState<string | null>(null);
  const [added, setAdded] = useState<string | null>(null);
  const nameBox = useRef<HTMLInputElement>(null);
  const set = <K extends keyof Draft>(key: K, value: Draft[K]) => setDraft((current) => ({ ...current, [key]: value }));
  const setRoom = (index: number, patch: Partial<Room>) =>
    setDraft((current) => ({ ...current, rooms: current.rooms.map((room, i) => (i === index ? { ...room, ...patch } : room)) }));

  const dirty = Boolean(draft.name.trim() || draft.address.trim() || draft.rooms.some((room) => room.name.trim()));
  useEffect(() => onDirtyChange?.(dirty), [dirty, onDirtyChange]);

  const names = useMemo(() => new Map(existingNames.map((property) => [normalizePropertyName(property.name), property.id])), [existingNames]);
  const duplicateId = draft.name.trim() ? names.get(normalizePropertyName(draft.name)) : undefined;

  // Where it is, found from the address once typing stops — unless Google
  // Maps has already given the coordinates, or they were set on the map.
  const [located, setLocated] = useState<"idle" | "looking" | "found" | "missing">("idle");
  const geocode = api.property.geocode.useMutation({
    onSuccess: (result) => {
      if (result) {
        setDraft((current) => ({ ...current, latitude: String(result.latitude), longitude: String(result.longitude) }));
        setLocated("found");
      } else setLocated("missing");
    },
    onError: () => setLocated("missing"),
  });
  const lookedUp = useRef("");
  useEffect(() => {
    const query = [draft.address, draft.city, draft.country].map((part) => part.trim()).filter(Boolean).join(", ");
    if (query.length < 6 || draft.latitude || query === lookedUp.current) return;
    const timer = setTimeout(() => {
      lookedUp.current = query;
      setLocated("looking");
      geocode.mutate({ address: draft.address, city: draft.city, country: draft.country });
    }, 900);
    return () => clearTimeout(timer);
    // eslint-disable-next-line react-hooks/exhaustive-deps -- looked up when the words change
  }, [draft.address, draft.city, draft.country, draft.latitude]);

  const addToList = api.scouting.add.useMutation();
  const create = api.property.create.useMutation();
  const saving = create.isPending || addToList.isPending;

  const save = async (another: boolean) => {
    setProblem(null);
    setAdded(null);
    if (!draft.name.trim()) {
      setProblem("Give the property a name.");
      nameBox.current?.focus();
      return;
    }
    if (duplicateId) {
      setProblem("A property with this name is already in the library — open it and add it to the list from there.");
      return;
    }
    const categories = draft.rooms
      .filter((room) => room.name.trim())
      .map((room) => ({
        name: room.name.trim(),
        unitCount: num(room.rooms) ?? 0,
        capacity: num(room.sleeps) ?? 2,
        currency: "USD",
        size: "",
        notes: "",
      }));
    try {
      const property = await create.mutateAsync({
        name: draft.name.trim(),
        type: draft.type,
        stars: draft.type === "APARTMENT" ? undefined : (draft.stars ?? undefined),
        address: text(draft.address),
        city: text(draft.city),
        country: text(draft.country),
        latitude: num(draft.latitude),
        longitude: num(draft.longitude),
        website: text(draft.website),
        phone: text(draft.phone),
        notes: text(draft.notes),
        amenityIds: draft.amenityIds,
        categories,
        contacts: draft.contactName.trim()
          ? [{ name: draft.contactName.trim(), email: text(draft.contactEmail), phone: text(draft.contactPhone) }]
          : [],
      });
      if (event) await addToList.mutateAsync({ eventId: event.id, propertyId: property.id });
      void utils.scouting.invalidate();
      void utils.property.invalidate();
      if (another) {
        setAdded(property.name);
        setDraft(blank());
        setLocated("idle");
        lookedUp.current = "";
        nameBox.current?.scrollIntoView({ block: "center", behavior: "smooth" });
        nameBox.current?.focus();
      } else if (onSaved) {
        router.refresh();
        onSaved();
      } else {
        router.push(event ? `/events/${event.id}` : `/properties/${property.id}`);
        router.refresh();
      }
    } catch (error) {
      setProblem(friendlyError(error as Parameters<typeof friendlyError>[0]));
    }
  };

  const chip = (active: boolean) =>
    `rounded-full border px-3 py-1.5 text-[13px] transition-colors ${
      active ? "border-brand-400 bg-brand-50 text-brand-800 font-medium" : "border-ink-200 text-ink-500 hover:text-ink-900 bg-white font-light"
    }`;

  return (
    <form
      onSubmit={(e) => {
        e.preventDefault();
        void save(false);
      }}
      className={inPopup ? "" : "pb-24"}
    >
      {added && (
        <p className="mb-4 rounded-lg bg-[#e3f8ee] px-4 py-2.5 text-[13px] text-[#0a7a47]">
          <strong className="font-medium">{added}</strong> was added{event ? ` to ${event.name}` : ""}. On to the next one.
        </p>
      )}

      <div className="grid items-start gap-5 lg:grid-cols-[minmax(0,1fr)_22rem]">
        <div className="space-y-5">
          {/* What and where — the only part that is needed. */}
          <section className="border-ink-200/60 space-y-4 rounded-xl border bg-white p-5">
            <div>
              <Label>Name</Label>
              <Input
                ref={nameBox}
                value={draft.name}
                onChange={(e) => set("name", e.target.value)}
                placeholder="Residence Inn Burbank Downtown"
                autoFocus
                className="py-3 text-base"
              />
              {duplicateId && (
                <p className="mt-1.5 text-xs text-[#c03654]">
                  Already in the library —{" "}
                  <Link href={`/properties/${duplicateId}`} className="font-medium underline">
                    open it
                  </Link>{" "}
                  and add it to the list from there.
                </p>
              )}
            </div>

            <div className="flex flex-wrap items-center gap-x-6 gap-y-3">
              <div className="flex flex-wrap gap-1.5" role="group" aria-label="Type">
                {(["HOTEL", "APARTMENT", "APARTHOTEL"] as const).map((type) => (
                  <button key={type} type="button" aria-pressed={draft.type === type} onClick={() => set("type", type)} className={chip(draft.type === type)}>
                    {propertyTypeLabels[type]}
                  </button>
                ))}
              </div>
              {draft.type !== "APARTMENT" && (
                <div className="flex items-center gap-0.5" role="group" aria-label="Stars">
                  {[1, 2, 3, 4, 5].map((star) => (
                    <button
                      key={star}
                      type="button"
                      aria-label={`${star} star${star === 1 ? "" : "s"}`}
                      aria-pressed={draft.stars === star}
                      onClick={() => set("stars", draft.stars === star ? null : star)}
                      className={`text-2xl leading-none transition-colors ${draft.stars !== null && star <= draft.stars ? "text-[#e5a400]" : "text-ink-200 hover:text-[#e5a400]/60"}`}
                    >
                      ★
                    </button>
                  ))}
                  <span className="text-ink-500 ml-2 text-xs font-light">{draft.stars ? `${draft.stars}-star` : "Stars not known"}</span>
                </div>
              )}
            </div>

            <div>
              <Label>Address</Label>
              <AddressSearch
                value={draft.address}
                onChange={(address) => set("address", address)}
                onFound={(place) => {
                  setLocated(place.latitude !== null ? "found" : "idle");
                  setDraft((current) => ({
                    ...current,
                    address: place.address ?? current.address,
                    city: place.city ?? current.city,
                    country: place.country ?? current.country,
                    latitude: place.latitude !== null ? String(place.latitude) : current.latitude,
                    longitude: place.longitude !== null ? String(place.longitude) : current.longitude,
                    name: !current.name.trim() && place.lodging && place.name ? place.name : current.name,
                    website: current.website.trim() ? current.website : (place.website ?? ""),
                    phone: current.phone.trim() ? current.phone : (place.phone ?? ""),
                  }));
                }}
              />
              <div className="mt-2 grid gap-2 sm:grid-cols-2">
                <Input value={draft.city} onChange={(e) => set("city", e.target.value)} placeholder="City" aria-label="City" />
                <Input value={draft.country} onChange={(e) => set("country", e.target.value)} placeholder="Country" aria-label="Country" />
              </div>
            </div>

            <div className="grid gap-2 sm:grid-cols-2">
              <Input value={draft.website} onChange={(e) => set("website", e.target.value)} placeholder="Website — https://…" aria-label="Website" />
              <Input value={draft.phone} onChange={(e) => set("phone", e.target.value)} placeholder="Phone" aria-label="Phone" />
            </div>
          </section>

          {/* The rooms, as a quick list — details and prices later. */}
          <section className="border-ink-200/60 rounded-xl border bg-white p-5">
            <div className="mb-3 flex items-baseline justify-between gap-3">
              <h2 className="text-ink-900 text-[15px] font-medium">{draft.type === "HOTEL" ? "Room types" : "Unit types"}</h2>
              <span className="text-ink-500 text-xs font-light">They appear on the stock sheet once saved</span>
            </div>
            <div className="space-y-2">
              <div className="text-ink-500 grid grid-cols-[minmax(0,1fr)_5.5rem_5.5rem_1.5rem] gap-2 px-1 text-[11px]">
                <span>Name</span>
                <span>{draft.type === "HOTEL" ? "Rooms" : "Units"}</span>
                <span>Sleeps</span>
                <span />
              </div>
              {draft.rooms.map((room, index) => (
                <div key={index} className="grid grid-cols-[minmax(0,1fr)_5.5rem_5.5rem_1.5rem] items-center gap-2">
                  <Input value={room.name} onChange={(e) => setRoom(index, { name: e.target.value })} placeholder="King" aria-label={`Room type ${index + 1}`} />
                  <Input value={room.rooms} onChange={(e) => setRoom(index, { rooms: e.target.value })} inputMode="numeric" placeholder="20" aria-label={`Room type ${index + 1} rooms`} />
                  <Input value={room.sleeps} onChange={(e) => setRoom(index, { sleeps: e.target.value })} inputMode="numeric" aria-label={`Room type ${index + 1} sleeps`} />
                  {draft.rooms.length > 1 ? (
                    <button
                      type="button"
                      aria-label="Remove"
                      onClick={() => set("rooms", draft.rooms.filter((_, i) => i !== index))}
                      className="text-ink-400 text-lg leading-none hover:text-[#c03654]"
                    >
                      ×
                    </button>
                  ) : (
                    <span />
                  )}
                </div>
              ))}
            </div>
            <div className="mt-3 flex flex-wrap items-center gap-1.5">
              <span className="text-ink-500 mr-1 text-xs font-light">Add</span>
              {roomNames[draft.type].map((name) => (
                <button
                  key={name}
                  type="button"
                  onClick={() =>
                    setDraft((current) => {
                      // Fills the empty row first, then adds one.
                      const empty = current.rooms.findIndex((room) => !room.name.trim());
                      const rooms = empty >= 0 ? current.rooms.map((room, i) => (i === empty ? { ...room, name } : room)) : [...current.rooms, { ...blankRoom(), name }];
                      return { ...current, rooms };
                    })
                  }
                  className="border-ink-200 text-ink-700 hover:border-brand-400 rounded-full border bg-white px-2.5 py-1 text-xs font-light"
                >
                  + {name}
                </button>
              ))}
              <button type="button" onClick={() => set("rooms", [...draft.rooms, blankRoom()])} className="text-brand-700 ml-1 text-xs font-medium hover:underline">
                + Another
              </button>
            </div>
          </section>

          <section className="border-ink-200/60 rounded-xl border bg-white p-5">
            <h2 className="text-ink-900 mb-3 text-[15px] font-medium">Amenities</h2>
            <div className="flex flex-wrap gap-1.5">
              {amenities.map((amenity) => {
                const active = draft.amenityIds.includes(amenity.id);
                return (
                  <button
                    key={amenity.id}
                    type="button"
                    aria-pressed={active}
                    onClick={() => set("amenityIds", active ? draft.amenityIds.filter((id) => id !== amenity.id) : [...draft.amenityIds, amenity.id])}
                    className={chip(active)}
                  >
                    {amenity.label}
                  </button>
                );
              })}
            </div>
          </section>

          <section className="border-ink-200/60 space-y-3 rounded-xl border bg-white p-5">
            <h2 className="text-ink-900 text-[15px] font-medium">Contact and notes</h2>
            <div className="grid gap-2 sm:grid-cols-3">
              <Input value={draft.contactName} onChange={(e) => set("contactName", e.target.value)} placeholder="Contact name" aria-label="Contact name" />
              <Input value={draft.contactEmail} onChange={(e) => set("contactEmail", e.target.value)} placeholder="Email" aria-label="Contact email" type="email" />
              <Input value={draft.contactPhone} onChange={(e) => set("contactPhone", e.target.value)} placeholder="Phone" aria-label="Contact phone" />
            </div>
            <Textarea rows={2} value={draft.notes} onChange={(e) => set("notes", e.target.value)} placeholder="Notes — first impressions, who you spoke to…" aria-label="Notes" />
          </section>
        </div>

        {/* Where it is, checked on the map; and what is left for later. */}
        <aside className="space-y-4 lg:sticky lg:top-6">
          <div className="border-ink-200/60 rounded-xl border bg-white p-4">
            <h2 className="text-ink-900 mb-2 text-[14px] font-medium">On the map</h2>
            <p className="text-ink-500 mb-2 text-xs font-light">
              {located === "looking"
                ? "Finding it from the address…"
                : located === "missing" && !draft.latitude
                  ? "Not found from the address — it can be placed later."
                  : draft.latitude
                    ? "Drag the pin if it is not quite right."
                    : "Found from the address as you type it."}
            </p>
            {draft.latitude && draft.longitude && (
              <LocationPreview
                latitude={draft.latitude}
                longitude={draft.longitude}
                onMove={(latitude, longitude) => setDraft((current) => ({ ...current, latitude, longitude }))}
              />
            )}
          </div>
          <p className="text-ink-500 px-1 text-xs font-light">
            Bed set-ups, sizes, prices, services and contracting details are added later, on the property&apos;s page — each part edits in
            place.
          </p>
        </aside>
      </div>

      <div
        className={
          inPopup
            ? "border-ink-200/60 sticky -bottom-6 z-20 -mx-6 mt-5 border-t bg-white/95 backdrop-blur"
            : "border-ink-200/60 fixed inset-x-0 bottom-0 z-20 border-t bg-white/95 backdrop-blur lg:left-60"
        }
      >
        <div className="mx-auto flex max-w-6xl flex-wrap items-center gap-2 px-6 py-3">
          <Button type="submit" disabled={saving}>
            {saving ? "Saving…" : event ? `Save and add to ${event.name}` : "Save"}
          </Button>
          <Button type="button" variant="secondary" disabled={saving} onClick={() => void save(true)}>
            Save and scout another
          </Button>
          <Button type="button" variant="ghost" onClick={() => (onCancel ? onCancel() : router.back())}>
            Cancel
          </Button>
          {problem && <span className="ml-2 min-w-0 flex-1"><FormError message={problem} /></span>}
        </div>
      </div>
    </form>
  );
}

/**
 * The quick screen as a pop-up over the event's Properties tab, so scouting
 * does not leave the list (doc §3.1). Closing it asks first once anything has
 * been typed.
 */
export function ScoutPopup({ event, onClose }: { event: { id: string; name: string }; onClose: () => void }) {
  const amenities = api.amenity.list.useQuery();
  const names = api.property.listNames.useQuery();
  const dirty = useRef(false);
  const close = () => {
    if (dirty.current && !window.confirm("Close without saving this property?")) return;
    onClose();
  };
  useEffect(() => {
    const onEscape = (e: KeyboardEvent) => e.key === "Escape" && close();
    window.addEventListener("keydown", onEscape);
    const overflow = document.body.style.overflow;
    document.body.style.overflow = "hidden";
    return () => {
      window.removeEventListener("keydown", onEscape);
      document.body.style.overflow = overflow;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps -- set up once
  }, []);

  return createPortal(
    <>
      <div className="fixed inset-0 z-[1010] bg-black/30" onClick={close} aria-hidden="true" />
      <div
        role="dialog"
        aria-modal="true"
        aria-label="Scout a property"
        className="bg-ink-50 fixed inset-x-3 top-4 bottom-4 z-[1020] mx-auto max-w-6xl overflow-y-auto rounded-2xl p-6 shadow-2xl sm:inset-x-6"
        style={{ backgroundColor: "#f3f3f3" }}
      >
        <div className="mb-5 flex items-start justify-between gap-4">
          <div>
            <h2 className="text-ink-900 text-xl font-semibold">Scout a property</h2>
            <p className="text-ink-500 mt-0.5 text-sm font-light">It is added to {event.name}&apos;s list once saved.</p>
          </div>
          <div className="flex items-center gap-4">
            <Link href={`/properties/new?event=${event.id}&full=1`} className="text-brand-700 text-[13px] font-light hover:underline">
              Use the full form
            </Link>
            <button type="button" onClick={close} aria-label="Close" className="text-ink-400 hover:text-ink-900 text-2xl leading-none">
              ×
            </button>
          </div>
        </div>
        {amenities.data && names.data ? (
          <QuickScout
            amenities={amenities.data}
            existingNames={names.data}
            event={event}
            onSaved={onClose}
            onCancel={close}
            onDirtyChange={(value) => {
              dirty.current = value;
            }}
          />
        ) : (
          <p className="text-ink-500 text-sm font-light">Loading…</p>
        )}
      </div>
    </>,
    document.body,
  );
}
