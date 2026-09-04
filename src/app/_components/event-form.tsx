"use client";

import { useRouter } from "next/navigation";
import { useState } from "react";

import {
  Button,
  Field,
  Fieldset,
  FormError,
  Input,
  Select,
} from "~/app/_components/form";
import { api } from "~/trpc/react";

/**
 * An event is the container everything else hangs off (doc §2.3). The venue
 * coordinates are optional but worth having — distance-to-venue is derived
 * from them.
 */
export function EventForm({ onDone }: { onDone?: () => void }) {
  const router = useRouter();
  const [error, setError] = useState<string | null>(null);
  const [values, setValues] = useState({
    name: "",
    city: "",
    country: "",
    startDate: "",
    endDate: "",
    status: "PLANNING" as "PLANNING" | "ACTIVE" | "CLOSED",
    venueName: "",
    venueLatitude: "",
    venueLongitude: "",
  });

  const create = api.event.create.useMutation({
    onSuccess: (event) => {
      onDone?.();
      router.push(`/events/${event.id}`);
      router.refresh();
    },
    onError: (e) => setError(e.message),
  });

  const set = (key: keyof typeof values, value: string) =>
    setValues((current) => ({ ...current, [key]: value }));

  const num = (value: string) =>
    value.trim() && Number.isFinite(Number(value)) ? Number(value) : undefined;

  const submit = (event: React.FormEvent) => {
    event.preventDefault();
    setError(null);

    if (!values.name.trim()) return setError("An event needs a name.");
    if (!values.startDate || !values.endDate)
      return setError("An event needs a start and an end date.");

    const startDate = new Date(`${values.startDate}T00:00:00Z`);
    const endDate = new Date(`${values.endDate}T00:00:00Z`);
    if (endDate < startDate)
      return setError("The event cannot end before it starts.");

    create.mutate({
      name: values.name.trim(),
      city: values.city,
      country: values.country,
      startDate,
      endDate,
      status: values.status,
      venueName: values.venueName,
      venueLatitude: num(values.venueLatitude),
      venueLongitude: num(values.venueLongitude),
    });
  };

  return (
    <form onSubmit={submit} className="max-w-2xl space-y-4">
      <FormError message={error} />

      <Fieldset title="New event">
        <div className="grid gap-4 sm:grid-cols-2">
          <Field label="Name" className="sm:col-span-2">
            <Input
              value={values.name}
              onChange={(e) => set("name", e.target.value)}
              placeholder="LA28 Olympic Games"
              required
            />
          </Field>

          <Field label="City">
            <Input
              value={values.city}
              onChange={(e) => set("city", e.target.value)}
            />
          </Field>

          <Field label="Country">
            <Input
              value={values.country}
              onChange={(e) => set("country", e.target.value)}
            />
          </Field>

          <Field label="Starts">
            <Input
              type="date"
              value={values.startDate}
              onChange={(e) => set("startDate", e.target.value)}
              required
            />
          </Field>

          <Field label="Ends">
            <Input
              type="date"
              value={values.endDate}
              onChange={(e) => set("endDate", e.target.value)}
              required
            />
          </Field>

          <Field label="Status">
            <Select
              value={values.status}
              onChange={(e) =>
                set("status", e.target.value as typeof values.status)
              }
            >
              <option value="PLANNING">Planning</option>
              <option value="ACTIVE">Active</option>
              <option value="CLOSED">Closed</option>
            </Select>
          </Field>

          <Field label="Venue" hint="Optional — what guests need to be near.">
            <Input
              value={values.venueName}
              onChange={(e) => set("venueName", e.target.value)}
              placeholder="SoFi Stadium"
            />
          </Field>

          <Field label="Venue latitude">
            <Input
              value={values.venueLatitude}
              onChange={(e) => set("venueLatitude", e.target.value)}
              inputMode="decimal"
            />
          </Field>

          <Field label="Venue longitude">
            <Input
              value={values.venueLongitude}
              onChange={(e) => set("venueLongitude", e.target.value)}
              inputMode="decimal"
            />
          </Field>
        </div>
      </Fieldset>

      <div className="flex gap-3">
        <Button type="submit" disabled={create.isPending}>
          {create.isPending ? "Creating…" : "Create event"}
        </Button>
        {onDone && (
          <Button type="button" variant="ghost" onClick={onDone}>
            Cancel
          </Button>
        )}
      </div>
    </form>
  );
}

/** Toggles the form on the events index without navigating away. */
export function NewEventPanel() {
  const [open, setOpen] = useState(false);

  if (!open)
    return <Button onClick={() => setOpen(true)}>New event</Button>;

  return (
    <div className="w-full">
      <EventForm onDone={() => setOpen(false)} />
    </div>
  );
}
