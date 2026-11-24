"use client";

import Link from "next/link";
import { useRouter } from "next/navigation";
import { useEffect, useState } from "react";

import { AddressSearch, type FoundPlace } from "~/app/_components/address-search";
import { friendlyError } from "~/app/_components/form";
import { api } from "~/trpc/react";

type Point = { latitude: number; longitude: number };
const NEW_LAYER = "__new__";

/**
 * Anything added by pointing at the map (doc §3.7, §3.9, 2026-10-13): its spot
 * clicked on the map or taken from where the phone is, its address looked up
 * from there. **A property** — spotted on the ground, under development, not
 * on Google — goes on our properties and the event's board with a hotel
 * contact task; **a place** — a nation house, a fan zone, anything — goes on
 * one of the map's layers, or a new one made there and then.
 */
export function AddPropertyForm({
  eventId,
  layers,
  point,
  setPoint,
  picking,
  setPicking,
  onClose,
  known = null,
}: {
  /** An address already looked up on the map: when the pin is on it, its address is kept, not looked up again. */
  known?: { latitude: number; longitude: number; address: string } | null;
  eventId: string;
  layers: { id: string; name: string }[];
  point: Point | null;
  setPoint: (point: Point | null) => void;
  picking: boolean;
  setPicking: (picking: boolean) => void;
  onClose: () => void;
}) {
  const utils = api.useUtils();
  const router = useRouter();
  const [kind, setKind] = useState<"property" | "place">("property");
  const [layerId, setLayerId] = useState(layers[0]?.id ?? NEW_LAYER);
  const [newLayer, setNewLayer] = useState("");
  const [name, setName] = useState("");
  const [type, setType] = useState<"HOTEL" | "APARTMENT" | "APARTHOTEL">("HOTEL");
  const [stars, setStars] = useState<number | null>(null);
  const [underDevelopment, setUnderDevelopment] = useState(false);
  const [note, setNote] = useState("");
  const [address, setAddress] = useState("");
  const [locating, setLocating] = useState<string | null>(null);
  const [done, setDone] = useState<{ name: string; id: string; taskId: string | null; place?: boolean } | null>(null);
  // A pin dropped from a searched address keeps that address; a clicked spot has its address looked up.
  const [searched, setSearched] = useState<Point | null>(null);
  const fromSearch = Boolean(point && searched && point.latitude === searched.latitude && point.longitude === searched.longitude);
  const where = api.scouting.addressAt.useQuery(point ?? { latitude: 0, longitude: 0 }, { enabled: Boolean(point) && !fromSearch, staleTime: Infinity });
  // The address found at the spot, unless one was typed.
  useEffect(() => {
    if (where.data?.address && !fromSearch) setAddress(where.data.address);
  }, [where.data, fromSearch]);
  useEffect(() => {
    if (!known || !point || known.latitude !== point.latitude || known.longitude !== point.longitude) return;
    setSearched(point);
    setAddress(known.address);
    // eslint-disable-next-line react-hooks/exhaustive-deps -- when the pin lands on the known spot
  }, [known?.latitude, known?.longitude, point?.latitude, point?.longitude]);
  /** An address picked from the search (the owner, 2026-11-23): that is where the pin goes. */
  const found = (place: FoundPlace) => {
    if (place.latitude === null || place.longitude === null) return;
    const spot = { latitude: place.latitude, longitude: place.longitude };
    setSearched(spot);
    setPoint(spot);
    setPicking(false);
    setAddress(place.address ?? address);
    if (!name.trim() && place.name && place.name !== place.address) setName(place.name);
  };
  const add = api.scouting.addFromMap.useMutation({
    onSuccess: (made) => {
      setDone({ name, id: made.id, taskId: made.taskId });
      setPoint(null);
      void utils.scouting.invalidate();
      void utils.task.invalidate();
    },
  });

  const saveLayer = api.mapLayer.save.useMutation();
  const addPlace = api.place.create.useMutation({
    onSuccess: (place) => {
      setDone({ name: place.name, id: "", taskId: null, place: true });
      setPoint(null);
      void utils.mapLayer.invalidate();
      void utils.place.invalidate();
      router.refresh();
    },
  });
  const placeOnMap = async () => {
    const target =
      layerId === NEW_LAYER ? (await saveLayer.mutateAsync({ eventId, name: newLayer.trim(), color: "#614fc9", measured: false }).catch(() => null))?.id : layerId;
    if (!target) return;
    addPlace.mutate({
      eventId,
      layerId: target,
      name: name.trim(),
      category: "OTHER",
      address,
      notes: note,
      latitude: point!.latitude,
      longitude: point!.longitude,
    });
  };

  const here = () => {
    setLocating("Finding where you are…");
    navigator.geolocation.getCurrentPosition(
      (position) => {
        setLocating(null);
        setPicking(false);
        setPoint({ latitude: position.coords.latitude, longitude: position.coords.longitude });
      },
      () => setLocating("Your location could not be read — click the spot on the map instead."),
      { enableHighAccuracy: true, timeout: 15_000 },
    );
  };

  const field = "border-ink-200 w-full rounded-md border bg-white px-2.5 py-1.5 text-[13px] outline-none focus:border-brand-400";

  if (done) {
    return (
      <div className="space-y-2 text-[13px]">
        <p className="font-medium text-[#0a7a47]">✓ {done.name} is {done.place ? "on the map" : "on the properties board"}.</p>
        {!done.place && <p className="text-ink-500 text-xs font-light">A contact task was made to reach out to it, as for any new property.</p>}
        <p className={`flex flex-wrap gap-x-4 gap-y-1 text-xs ${done.place ? "hidden" : ""}`}>
          {done.taskId && (
            <Link href={`/tasks/${done.taskId}`} className="text-brand-700 font-medium hover:underline">
              Contact task →
            </Link>
          )}
          <Link href={`/properties/${done.id}`} className="text-brand-700 hover:underline">
            Open the property →
          </Link>
        </p>
        <button
          type="button"
          onClick={() => {
            setDone(null);
            setName("");
            setNote("");
            setStars(null);
            setUnderDevelopment(false);
            setAddress("");
            setPicking(true);
          }}
          className="text-brand-700 text-xs font-medium hover:underline"
        >
          + Add another
        </button>
        <button type="button" onClick={onClose} className="text-ink-500 ml-4 text-xs hover:underline">
          Close
        </button>
      </div>
    );
  }

  return (
    <div className="space-y-2.5 text-[13px]">
      <p className="text-brand-700 text-[10px] font-medium tracking-wider uppercase">Add to the map</p>
      <div className="flex gap-1.5">
        {(
          [
            ["property", "Add to properties board"],
            ["place", "Only show on the map"],
          ] as const
        ).map(([value, label]) => (
          <button
            key={value}
            type="button"
            aria-pressed={kind === value}
            onClick={() => setKind(value)}
            className={`flex-1 rounded-full border px-2 py-1 text-xs ${kind === value ? "border-brand-400 bg-brand-500 font-medium text-white" : "border-ink-200 text-ink-700"}`}
          >
            {label}
          </button>
        ))}
      </div>
      <p className="text-ink-500 -mt-1 text-[11px] font-light">
        {kind === "property"
          ? "A hotel or apartments we want to work on — a property on the event's board, with a contact task."
          : "A point on one of the map's layers — a hotel from research, a nation house, a fan zone — nothing added to the properties board. A hotel can be added to it later from its pin."}
      </p>
      {!point ? (
        <div className="bg-brand-50 rounded-lg px-3 py-2.5">
          <p className="text-ink-900 font-medium">{picking ? "Click the spot on the map" : "Where is it?"}</p>
          <p className="text-ink-500 mt-0.5 text-xs font-light">Or search its address or name — the pin goes there:</p>
          <div className="mt-1">
            <AddressSearch value={address} onChange={setAddress} onFound={found} />
          </div>
          <p className="text-ink-500 mt-1.5 text-xs font-light">Or, standing in front of it:</p>
          <button type="button" onClick={here} className="text-brand-700 mt-1 text-xs font-medium hover:underline">
            📍 Use where I am
          </button>
          {locating && <p className="text-ink-500 mt-1 text-xs">{locating}</p>}
        </div>
      ) : (
        <p className="text-ink-500 text-xs font-light">
          The red pin is where it goes — click anywhere else on the map to move it, or search another address below.
        </p>
      )}
      <input value={name} onChange={(e) => setName(e.target.value)} placeholder="Name — even a working one" aria-label="Name" className={field} autoFocus />
      {kind === "place" && (
        <div className="space-y-1.5">
          <select value={layerId} onChange={(e) => setLayerId(e.target.value)} aria-label="Layer" className={field}>
            {layers.map((layer) => (
              <option key={layer.id} value={layer.id}>
                On the layer: {layer.name}
              </option>
            ))}
            <option value={NEW_LAYER}>+ A new layer…</option>
          </select>
          {layerId === NEW_LAYER && <input value={newLayer} onChange={(e) => setNewLayer(e.target.value)} placeholder="New layer's name — Nation houses" aria-label="New layer" className={field} />}
        </div>
      )}
      <div className={`flex gap-1.5 ${kind === "place" ? "hidden" : ""}`}>
        {(
          [
            ["HOTEL", "Hotel"],
            ["APARTMENT", "Apartments"],
            ["APARTHOTEL", "Aparthotel"],
          ] as const
        ).map(([value, label]) => (
          <button
            key={value}
            type="button"
            aria-pressed={type === value}
            onClick={() => setType(value)}
            className={`flex-1 rounded-full border px-2 py-1 text-xs ${type === value ? "border-brand-400 bg-brand-50 text-brand-800 font-medium" : "border-ink-200 text-ink-500"}`}
          >
            {label}
          </button>
        ))}
      </div>
      {kind === "property" && type === "HOTEL" && (
        <div className="flex items-center gap-1 text-xs">
          <span className="text-ink-500 mr-1">Stars</span>
          {[1, 2, 3, 4, 5].map((count) => (
            <button
              key={count}
              type="button"
              onClick={() => setStars(stars === count ? null : count)}
              aria-label={`${count} stars`}
              className={`text-base leading-none ${stars !== null && count <= stars ? "text-brand-500" : "text-ink-200"}`}
            >
              ★
            </button>
          ))}
        </div>
      )}
      <label className={`flex items-center gap-2 text-xs ${kind === "place" ? "hidden" : ""}`}>
        <input type="checkbox" checked={underDevelopment} onChange={(e) => setUnderDevelopment(e.target.checked)} className="accent-brand-500 h-3.5 w-3.5" />
        Under development
      </label>
      {point && (
        // Searching another address here moves the pin to it.
        <div>
          <AddressSearch value={address} onChange={setAddress} onFound={found} />
          {where.isFetching && <p className="text-ink-500 mt-0.5 text-[11px] font-light">Finding the address…</p>}
        </div>
      )}
      <textarea value={note} onChange={(e) => setNote(e.target.value)} rows={2} placeholder={kind === "place" ? "A note — optional" : "What you saw — opening 2027, about 80 rooms, a sign with a number…"} aria-label="Note" className={field} />
      {add.error && <p className="text-xs text-[#c03654]">{friendlyError(add.error)}</p>}
      {(addPlace.error ?? saveLayer.error) && <p className="text-xs text-[#c03654]">{friendlyError(addPlace.error ?? saveLayer.error)}</p>}
      <div className="flex items-center gap-3">
        {kind === "place" ? (
          <button
            type="button"
            disabled={!point || !name.trim() || addPlace.isPending || saveLayer.isPending || (layerId === NEW_LAYER && !newLayer.trim())}
            onClick={() => void placeOnMap()}
            className="bg-brand-400 hover:bg-brand-500 rounded-full px-3.5 py-1.5 text-xs font-medium text-white disabled:opacity-60"
          >
            {addPlace.isPending || saveLayer.isPending ? "Adding…" : "Add to the map"}
          </button>
        ) : (
        <button
          type="button"
          disabled={!point || !name.trim() || add.isPending}
          onClick={() =>
            add.mutate({
              eventId,
              name: name.trim(),
              type,
              stars: type === "HOTEL" ? stars : null,
              latitude: point!.latitude,
              longitude: point!.longitude,
              address,
              city: where.data?.city ?? null,
              country: where.data?.country ?? null,
              underDevelopment,
              note,
            })
          }
          className="bg-brand-400 hover:bg-brand-500 rounded-full px-3.5 py-1.5 text-xs font-medium text-white disabled:opacity-60"
        >
          {add.isPending ? "Adding…" : "Add to properties board"}
        </button>
        )}
        <button type="button" onClick={onClose} className="text-ink-500 text-xs hover:underline">
          Cancel
        </button>
      </div>
    </div>
  );
}
