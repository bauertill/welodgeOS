"use client";

import Link from "next/link";
import { useState } from "react";

import { AddressSearch } from "~/app/_components/address-search";
import { Select } from "~/app/_components/form";
import { ScoutingMap, type MapAvailability, type MapLayer, type MapPin, type MapPlace } from "~/app/_components/scouting-map";
import { WebsiteLink } from "~/app/_components/website-link";
import { measuredPlaces, propertyTypeLabels } from "~/lib/scouting";
import { api, type RouterOutputs } from "~/trpc/react";

type Found = RouterOutputs["scouting"]["discoverNear"]["found"][number];

const radiusOptions = [5, 10, 20];
const distance = (km: number) => (km < 1 ? `${Math.round(km * 1000)} m` : `${km.toFixed(1)} km`);

/**
 * The Properties tab's map, with a search for places to stay around one of the
 * event's places of interest that are not in our system (doc §3.9) — found on
 * Google Maps, shown as hollow purple dots and listed beneath. Adding one puts
 * it on the event with a hotel contact task (§4.11), its contact details
 * looked up on its own.
 */
export function NearbySearch({
  eventId,
  pins,
  places,
  layers = [],
  availability,
  onAdded,
}: {
  eventId: string;
  pins: MapPin[];
  places: MapPlace[];
  layers?: MapLayer[];
  availability: MapAvailability[];
  onAdded: () => void;
}) {
  const utils = api.useUtils();
  const venues = measuredPlaces(places);
  // A place of interest, or "custom" for any address found on the map.
  const [placeId, setPlaceId] = useState((venues[0] ?? places[0])?.id ?? "custom");
  const [addressText, setAddressText] = useState("");
  const [address, setAddress] = useState<{ label: string; latitude: number; longitude: number } | null>(null);
  const [radiusKm, setRadiusKm] = useState(5);
  const [searching, setSearching] = useState<{ placeId?: string; address?: { label: string; latitude: number; longitude: number }; radiusKm: number } | null>(null);
  const [all, setAll] = useState(false);
  const [added, setAdded] = useState<Record<string, { propertyId: string; taskId: string | null }>>({});
  const search = api.scouting.discoverNear.useQuery(
    { eventId, placeId: searching?.placeId, address: searching?.address, radiusKm: searching?.radiusKm ?? 5 },
    { enabled: Boolean(searching), staleTime: 3600_000, refetchOnWindowFocus: false },
  );
  const findContacts = api.property.findContacts.useMutation({ onSettled: () => void utils.task.invalidate() });
  const add = api.scouting.addFound.useMutation({
    onSuccess: (made, variables) => {
      setAdded((current) => ({ ...current, [variables.place.name]: { propertyId: made.id, taskId: made.taskId } }));
      findContacts.mutate({ id: made.id });
      void utils.task.invalidate();
      onAdded();
    },
  });

  const found = search.data?.found ?? [];
  const shown = all ? found : found.slice(0, 8);
  const byKey = new Map(found.map((place) => [place.key, place]));

  const actions = (place: Found) => {
    const done = added[place.name];
    return (
      <span className="flex flex-wrap items-center gap-x-3 gap-y-1 text-xs">
        {place.website && <WebsiteLink url={place.website} />}
        <a href={place.mapUrl} target="_blank" rel="noreferrer" className="text-brand-700 hover:underline">
          Map ↗
        </a>
        {done ? (
          <span className="font-medium text-[#0a7a47]">
            ✓ Added —{" "}
            {done.taskId ? (
              <Link href={`/tasks/${done.taskId}`} className="hover:underline">
                contact task →
              </Link>
            ) : (
              <Link href={`/properties/${done.propertyId}`} className="hover:underline">
                open →
              </Link>
            )}
          </span>
        ) : (
          <button
            type="button"
            disabled={add.isPending}
            onClick={() =>
              add.mutate({
                eventId,
                placeName: search.data?.placeName ?? "",
                place: {
                  name: place.name,
                  type: place.type,
                  latitude: place.latitude,
                  longitude: place.longitude,
                  address: place.address,
                  city: place.city,
                  country: place.country,
                  website: place.website,
                  phone: place.phone,
                  stars: place.stars,
                  rooms: place.rooms,
                  source: search.data?.source ?? "google",
                },
              })
            }
            className="bg-brand-400 hover:bg-brand-500 rounded-full px-3 py-1 font-medium text-white disabled:opacity-60"
          >
            {add.isPending && add.variables?.place.name === place.name ? "Adding…" : "Add to properties board"}
          </button>
        )}
      </span>
    );
  };
  const describe = (place: Found) =>
    [
      propertyTypeLabels[place.type],
      place.stars ? `${place.stars}★` : null,
      place.rating ? `${place.rating.toFixed(1)} rating${place.ratingCount ? ` (${place.ratingCount.toLocaleString("en")})` : ""}` : null,
      place.priceLevel,
      `${distance(place.km)} from ${search.data?.placeName ?? "the place"}`,
    ]
      .filter(Boolean)
      .join(" · ");

  return (
    <div className="space-y-3">
      {(
        <div className="border-ink-200/60 flex flex-wrap items-center gap-x-3 gap-y-2 rounded-xl border bg-white px-4 py-3 text-[13px]">
          <span className="text-ink-900 font-medium">Find hotels not on our list near</span>
          <span className="w-56">
            <Select value={placeId} onChange={(e) => setPlaceId(e.target.value)} aria-label="Near which place">
              {places.map((place) => (
                <option key={place.id} value={place.id}>
                  {place.name}
                </option>
              ))}
              <option value="custom">A custom address…</option>
            </Select>
          </span>
          {placeId === "custom" && (
            <span className="w-80">
              <AddressSearch
                value={addressText}
                onChange={(value) => {
                  setAddressText(value);
                  setAddress(null);
                }}
                onFound={(found) => {
                  if (found.latitude === null || found.longitude === null) return;
                  const label = found.name ?? found.address ?? addressText;
                  setAddressText(found.address ?? label);
                  setAddress({ label, latitude: found.latitude, longitude: found.longitude });
                }}
              />
            </span>
          )}
          <span className="text-ink-500 font-light">within</span>
          {radiusOptions.map((km) => (
            <button
              key={km}
              type="button"
              aria-pressed={radiusKm === km}
              onClick={() => setRadiusKm(km)}
              className={`rounded-full border px-2.5 py-1 text-xs ${radiusKm === km ? "border-ink-900 bg-ink-900 text-white" : "border-ink-200 text-ink-700 hover:border-ink-500"}`}
            >
              {km} km
            </button>
          ))}
          <button
            type="button"
            disabled={placeId === "custom" ? !address : !placeId}
            title={placeId === "custom" && !address ? "Choose an address from the suggestions first" : undefined}
            onClick={() => {
              setAll(false);
              setSearching(placeId === "custom" ? { address: address!, radiusKm } : { placeId, radiusKm });
            }}
            className="bg-brand-400 hover:bg-brand-500 ml-auto rounded-full px-4 py-1.5 font-medium text-white disabled:opacity-60"
          >
            {search.isFetching ? "Searching…" : "Search"}
          </button>
        </div>
      )}

      <ScoutingMap
        pins={pins}
        places={places}
        layers={layers}
        availability={availability}
        eventId={eventId}
        found={found.map((place) => ({ key: place.key, name: place.name, latitude: place.latitude, longitude: place.longitude }))}
        // The custom address, pinned once chosen and while its search lasts.
        searchPoint={searching?.address ?? (placeId === "custom" ? address : null)}
        renderFound={(key) => {
          const place = byKey.get(key);
          if (!place) return null;
          return (
            <div>
              <p className="text-brand-700 text-[10px] font-medium tracking-wider uppercase">Not in our system</p>
              <h3 className="text-ink-900 text-[15px]">{place.name}</h3>
              <p className="text-ink-500 mb-3 text-xs font-light">{describe(place)}</p>
              {actions(place)}
            </div>
          );
        }}
      />

      {searching && (
        <div>
          <div className="mb-1 flex justify-end">
            <button type="button" onClick={() => setSearching(null)} className="text-ink-500 hover:text-ink-900 text-xs hover:underline">
              Clear search ×
            </button>
          </div>
          {search.isLoading ? (
            <p className="text-ink-500 text-sm font-light">Searching Google Maps…</p>
          ) : search.error ? (
            <p className="text-ink-500 text-sm font-light">{search.error.message}</p>
          ) : found.length === 0 ? (
            <p className="text-ink-500 text-sm font-light">
              Nothing new within {searching.radiusKm} km of {search.data?.placeName} — every place to stay found there is already in our system.
            </p>
          ) : (
            <>
              <p className="text-ink-500 mb-2 text-xs font-light">
                {found.length} {found.length === 1 ? "place" : "places"} to stay within {searching.radiusKm} km of {search.data?.placeName}, not in our system
                {search.data?.source === "osm" ? " (from OpenStreetMap — Google did not answer)" : ""}. Adding one puts it on this event with a contact task.
              </p>
              <ul className="space-y-1.5">
                {shown.map((place) => (
                  <li key={place.key} className="border-ink-200/60 flex flex-wrap items-center gap-x-3 gap-y-1 rounded-lg border bg-white px-3 py-2">
                    <span className="min-w-0 flex-1">
                      <span className="text-ink-900 text-[13px] font-medium">{place.name}</span>
                      <span className="text-ink-500 block text-xs font-light">{describe(place)}</span>
                    </span>
                    {actions(place)}
                  </li>
                ))}
              </ul>
              {found.length > 8 && (
                <button type="button" onClick={() => setAll(!all)} className="text-brand-700 mt-2 text-xs font-light hover:underline">
                  {all ? "Show fewer" : `Show all ${found.length}`}
                </button>
              )}
              {add.error && <p className="mt-2 text-xs text-[#c03654]">{add.error.message}</p>}
            </>
          )}
        </div>
      )}
    </div>
  );
}
