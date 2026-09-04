"use client";

import { useState } from "react";

import { Button, Field, Fieldset, FormError, Input, Select } from "~/app/_components/form";
import { parseDay } from "~/lib/dates";
import { api } from "~/trpc/react";

/**
 * §3.6 — the only bridge from scouting into inventory. Pick a contracted
 * property, a category, a range of rooms and a range of dates, and those
 * room-nights come into existence.
 *
 * **Nothing is contracted by this act.** It records that these rooms exist and
 * belong to this event; every one of them starts at "nothing started" with the
 * supplier and no client against it.
 */
export function BringIntoInventory({
  eventId,
  defaultCheckIn,
  defaultCheckOut,
  onDone,
}: {
  eventId: string;
  defaultCheckIn: string;
  defaultCheckOut: string;
  onDone: () => void;
}) {
  const properties = api.inventory.materialisable.useQuery({ eventId });
  const [categoryId, setCategoryId] = useState("");
  const [slotFrom, setSlotFrom] = useState("1");
  const [slotTo, setSlotTo] = useState("");
  const [checkIn, setCheckIn] = useState(defaultCheckIn);
  const [checkOut, setCheckOut] = useState(defaultCheckOut);
  const [error, setError] = useState<string | null>(null);
  const [result, setResult] = useState<string | null>(null);

  const materialise = api.inventory.materialise.useMutation({
    onSuccess: (outcome) => {
      setError(null);
      setResult(
        outcome.created === 0
          ? "Those room-nights were already in this event's inventory. Nothing changed."
          : `${outcome.created} room-nights are now in this event's inventory — ${outcome.slots} rooms over ${outcome.nights} nights, nothing contracted.${
              outcome.alreadyThere
                ? ` ${outcome.alreadyThere} were already there and were left alone.`
                : ""
            }`,
      );
      onDone();
    },
    onError: (e) => {
      setResult(null);
      setError(e.message);
    },
  });

  const options = properties.data ?? [];
  const category = options
    .flatMap((property) =>
      property.categories.map((c) => ({ ...c, propertyName: property.name })),
    )
    .find((c) => c.id === categoryId);

  if (properties.isLoading) return null;

  if (options.length === 0) {
    return (
      <Fieldset
        title="Bring rooms into inventory"
        description="Only a property marked Contracted on this event's scouting list can become inventory."
      >
        <p className="text-ink-500 text-sm font-light">
          Nothing is contracted for this event yet. Move a property to
          &ldquo;Contracted&rdquo; on the Scouting tab and it will appear here.
        </p>
      </Fieldset>
    );
  }

  return (
    <Fieldset
      title="Bring rooms into inventory"
      description="This records that the rooms exist and belong to this event. It does not contract anything — every night starts with nothing agreed on either side."
    >
      <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
        <Field label="Property and room type" className="lg:col-span-3">
          <Select
            value={categoryId}
            onChange={(e) => {
              setCategoryId(e.target.value);
              setSlotTo("");
            }}
          >
            <option value="">Choose…</option>
            {options.map((property) => (
              <optgroup key={property.id} label={property.name}>
                {property.categories.map((c) => (
                  <option key={c.id} value={c.id}>
                    {c.name} — {c.unitCount} {c.unitCount === 1 ? "room" : "rooms"}
                  </option>
                ))}
              </optgroup>
            ))}
          </Select>
        </Field>

        <Field
          label="First room number"
          hint={category ? `Our own numbering, 1 to ${category.unitCount}` : undefined}
        >
          <Input
            type="number"
            min={1}
            value={slotFrom}
            onChange={(e) => setSlotFrom(e.target.value)}
          />
        </Field>

        <Field label="Last room number">
          <Input
            type="number"
            min={1}
            max={category?.unitCount}
            value={slotTo}
            placeholder={category ? String(category.unitCount) : ""}
            onChange={(e) => setSlotTo(e.target.value)}
          />
        </Field>

        <div />

        <Field label="Check-in">
          <Input
            type="date"
            value={checkIn}
            onChange={(e) => setCheckIn(e.target.value)}
          />
        </Field>

        <Field
          label="Check-out"
          hint="Check-out day is never a night — 10 Jul to 11 Jul is one night."
        >
          <Input
            type="date"
            value={checkOut}
            onChange={(e) => setCheckOut(e.target.value)}
          />
        </Field>

        <div className="flex items-end">
          <Button
            type="button"
            disabled={!categoryId || materialise.isPending}
            onClick={() => {
              setError(null);
              setResult(null);
              materialise.mutate({
                eventId,
                categoryId,
                slotFrom: Number(slotFrom) || 1,
                slotTo: Number(slotTo) || category?.unitCount || 1,
                checkIn: parseDay(checkIn),
                checkOut: parseDay(checkOut),
              });
            }}
          >
            {materialise.isPending ? "Adding…" : "Bring into inventory"}
          </Button>
        </div>
      </div>

      {error && (
        <div className="mt-4">
          <FormError message={error} />
        </div>
      )}
      {result && (
        <p className="mt-4 rounded-lg bg-[#12b878]/10 px-3 py-2 text-[13px] text-[#0d8f5d]">
          {result}
        </p>
      )}
    </Fieldset>
  );
}
