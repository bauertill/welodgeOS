"use client";

import { useRouter } from "next/navigation";
import { useState } from "react";
import type { PlaceCategory } from "generated/prisma";

import {
  Button,
  Field,
  Fieldset,
  FormError,
  Input,
  Select,
  Textarea,
} from "~/app/_components/form";
import { Pill } from "~/app/_components/ui";
import {
  placeCategoryHints,
  placeCategoryLabels,
  placeCategoryOrder,
  placeCategoryPlurals,
} from "~/lib/scouting";
import { api } from "~/trpc/react";

type Draft = {
  id?: string;
  name: string;
  category: PlaceCategory;
  lines: string;
  address: string;
  latitude: string;
  longitude: string;
  notes: string;
};

const emptyDraft: Draft = {
  name: "",
  category: "VENUE",
  lines: "",
  address: "",
  latitude: "",
  longitude: "",
  notes: "",
};

/**
 * The places guests have to get to for this event (doc §3.7): venues, airports,
 * stations, the IBC. An event can have several of each — a Games is not one
 * stadium — which is why this is a list rather than three fields on the event.
 */
export function PlacesOfInterest({ eventId }: { eventId: string }) {
  const router = useRouter();
  const [draft, setDraft] = useState<Draft | null>(null);
  const [error, setError] = useState<string | null>(null);

  const places = api.place.listForEvent.useQuery({ eventId });

  const done = () => {
    setDraft(null);
    setError(null);
    void places.refetch();
    // The scouting list measures distance to the nearest venue, so it has to
    // be told when the venues change.
    router.refresh();
  };

  const create = api.place.create.useMutation({
    onSuccess: done,
    onError: (e) => setError(e.message),
  });
  const update = api.place.update.useMutation({
    onSuccess: done,
    onError: (e) => setError(e.message),
  });
  const remove = api.place.remove.useMutation({
    onSuccess: done,
    onError: (e) => setError(e.message),
  });

  const saving = create.isPending || update.isPending;
  const rows = places.data ?? [];

  const submit = (event: React.FormEvent) => {
    event.preventDefault();
    if (!draft) return;
    setError(null);

    if (!draft.name.trim()) return setError("Give the place a name.");

    const latitude = Number(draft.latitude);
    const longitude = Number(draft.longitude);
    if (
      !draft.latitude.trim() ||
      !draft.longitude.trim() ||
      !Number.isFinite(latitude) ||
      !Number.isFinite(longitude)
    ) {
      return setError(
        "A place needs coordinates — look them up from the address, or paste them from Google Maps.",
      );
    }

    const payload = {
      eventId,
      name: draft.name.trim(),
      category: draft.category,
      lines: draft.lines,
      address: draft.address,
      latitude,
      longitude,
      notes: draft.notes,
    };

    if (draft.id) update.mutate({ ...payload, id: draft.id });
    else create.mutate(payload);
  };

  return (
    <Fieldset
      title="Places of interest"
      description="Where guests need to get to — venues, airports, stations, the IBC. Properties are judged on how well they connect to these."
      action={
        draft === null && (
          <Button type="button" onClick={() => setDraft(emptyDraft)}>
            Add a place
          </Button>
        )
      }
    >
      {draft === null && <FormError message={error} />}

      {rows.length === 0 && draft === null && (
        <p className="text-ink-500 text-sm font-light">
          Nothing recorded yet. Add the venue first — the scouting list measures
          every property against the nearest one.
        </p>
      )}

      {rows.length > 0 && (
        <div className="space-y-5">
          {placeCategoryOrder.map((category) => {
            const inCategory = rows.filter(
              (place) => place.category === category,
            );
            if (inCategory.length === 0) return null;

            return (
              <div key={category}>
                <p className="text-ink-500 mb-2 text-[11px] font-medium tracking-wider uppercase">
                  {placeCategoryPlurals[category]}
                </p>
                <ul className="divide-ink-200/60 divide-y">
                  {inCategory.map((place) => (
                    <li
                      key={place.id}
                      className="flex flex-wrap items-start justify-between gap-3 py-2.5"
                    >
                      <div className="min-w-0">
                        <p className="text-ink-900 text-sm">{place.name}</p>
                        <p className="text-ink-500 text-xs font-light">
                          {place.address ?? "No address recorded"}
                        </p>
                        {place.lines && (
                          <div className="mt-1 flex flex-wrap gap-1">
                            {place.lines
                              .split(",")
                              .map((line) => line.trim())
                              .filter(Boolean)
                              .map((line) => (
                                <Pill key={line}>{line}</Pill>
                              ))}
                          </div>
                        )}
                      </div>
                      <div className="flex items-center gap-3 whitespace-nowrap">
                        <Button
                          type="button"
                          variant="ghost"
                          className="px-2 py-1"
                          onClick={() => {
                            setError(null);
                            setDraft({
                              id: place.id,
                              name: place.name,
                              category: place.category,
                              lines: place.lines ?? "",
                              address: place.address ?? "",
                              latitude: String(place.latitude),
                              longitude: String(place.longitude),
                              notes: place.notes ?? "",
                            });
                          }}
                        >
                          Edit
                        </Button>
                        <Button
                          type="button"
                          variant="ghost"
                          className="px-2 py-1"
                          disabled={remove.isPending}
                          onClick={() => remove.mutate({ id: place.id })}
                        >
                          Remove
                        </Button>
                      </div>
                    </li>
                  ))}
                </ul>
              </div>
            );
          })}
        </div>
      )}

      {draft !== null && (
        <form onSubmit={submit} className="border-ink-200/60 mt-5 border-t pt-5">
          <PlaceFields draft={draft} setDraft={setDraft} error={error} />

          <div className="mt-4 flex gap-3">
            <Button type="submit" disabled={saving}>
              {saving ? "Saving…" : draft.id ? "Save changes" : "Add place"}
            </Button>
            <Button
              type="button"
              variant="ghost"
              onClick={() => {
                setDraft(null);
                setError(null);
              }}
              disabled={saving}
            >
              Cancel
            </Button>
          </div>
        </form>
      )}
    </Fieldset>
  );
}

/** The add/edit fields, kept apart so the list above stays readable. */
function PlaceFields({
  draft,
  setDraft,
  error,
}: {
  draft: Draft;
  setDraft: (draft: Draft) => void;
  error: string | null;
}) {
  const [lookupError, setLookupError] = useState<string | null>(null);
  const set = <K extends keyof Draft>(key: K, value: Draft[K]) =>
    setDraft({ ...draft, [key]: value });

  // The same OpenStreetMap lookup the scouting form uses. Coordinates are our
  // own record of where a place is, so they come from a source that lets us
  // keep them (doc §3.1).
  const geocode = api.property.geocode.useMutation({
    onSuccess: (result) => {
      if (result) {
        setLookupError(null);
        setDraft({
          ...draft,
          latitude: String(result.latitude),
          longitude: String(result.longitude),
        });
      } else {
        setLookupError(
          "Couldn't find coordinates for this address — enter them by hand.",
        );
      }
    },
    onError: () =>
      setLookupError(
        "Couldn't look up coordinates right now — enter them by hand.",
      ),
  });

  return (
    <div className="grid gap-4 sm:grid-cols-2">
      <FormError message={error} />

      <Field label="Name">
        <Input
          value={draft.name}
          onChange={(e) => set("name", e.target.value)}
          placeholder="e.g. SoFi Stadium"
          required
        />
      </Field>

      <Field label="Kind of place" hint={placeCategoryHints[draft.category]}>
        <Select
          value={draft.category}
          onChange={(e) => set("category", e.target.value as PlaceCategory)}
        >
          {placeCategoryOrder.map((category) => (
            <option key={category} value={category}>
              {placeCategoryLabels[category]}
            </option>
          ))}
        </Select>
      </Field>

      {draft.category === "TRAIN_STATION" && (
        <Field
          label="Lines"
          className="sm:col-span-2"
          hint="As the business says them, separated by commas."
        >
          <Input
            value={draft.lines}
            onChange={(e) => set("lines", e.target.value)}
            placeholder="e.g. RER A, RER D, M1, M14"
          />
        </Field>
      )}

      <Field label="Address" className="sm:col-span-2">
        <Input
          value={draft.address}
          onChange={(e) => set("address", e.target.value)}
          placeholder="1001 Stadium Dr, Inglewood, CA"
        />
      </Field>

      <div className="sm:col-span-2">
        <Button
          type="button"
          variant="secondary"
          disabled={geocode.isPending || !draft.address.trim()}
          onClick={() => {
            setLookupError(null);
            geocode.mutate({ address: draft.address });
          }}
        >
          {geocode.isPending ? "Looking up…" : "Find coordinates from address"}
        </Button>
        {lookupError && (
          <p className="mt-1.5 text-xs text-[#c03654]">{lookupError}</p>
        )}
      </div>

      <Field label="Latitude">
        <Input
          value={draft.latitude}
          onChange={(e) => set("latitude", e.target.value)}
          inputMode="decimal"
          placeholder="e.g. 33.9535"
          required
        />
      </Field>

      <Field label="Longitude">
        <Input
          value={draft.longitude}
          onChange={(e) => set("longitude", e.target.value)}
          inputMode="decimal"
          placeholder="e.g. -118.3392"
          required
        />
      </Field>

      <Field label="Notes" className="sm:col-span-2">
        <Textarea
          value={draft.notes}
          onChange={(e) => set("notes", e.target.value)}
          rows={2}
        />
      </Field>
    </div>
  );
}
