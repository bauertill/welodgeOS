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

export type EventFormValues = {
  id?: string;
  name: string;
  city: string;
  country: string;
  startDate: string;
  endDate: string;
  status: "PLANNING" | "ACTIVE" | "CLOSED";
};

export const emptyEvent: EventFormValues = {
  name: "",
  city: "",
  country: "",
  startDate: "",
  endDate: "",
  status: "PLANNING",
};

/**
 * An event is the container everything else hangs off (doc §2.3). Venues are
 * not here: an event can have several, so they live on its list of places of
 * interest (doc §3.7) alongside airports, stations and the IBC.
 */
export function EventForm({
  initial = emptyEvent,
  onDone,
}: {
  initial?: EventFormValues;
  onDone?: () => void;
}) {
  const router = useRouter();
  const [error, setError] = useState<string | null>(null);
  const [values, setValues] = useState(initial);

  const isEdit = Boolean(initial.id);

  const onSaved = (event: { id: string }) => {
    onDone?.();
    router.push(`/events/${event.id}/inventory`);
    router.refresh();
  };

  const create = api.event.create.useMutation({
    onSuccess: onSaved,
    onError: (e) => setError(e.message),
  });
  const update = api.event.update.useMutation({
    onSuccess: onSaved,
    onError: (e) => setError(e.message),
  });

  const saving = create.isPending || update.isPending;

  const set = (key: keyof typeof values, value: string) =>
    setValues((current) => ({ ...current, [key]: value }));

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

    const payload = {
      name: values.name.trim(),
      city: values.city,
      country: values.country,
      startDate,
      endDate,
      status: values.status,
    };

    if (initial.id) update.mutate({ ...payload, id: initial.id });
    else create.mutate(payload);
  };

  return (
    <form onSubmit={submit} className="max-w-2xl space-y-4">
      <FormError message={error} />

      <Fieldset title={isEdit ? "Edit event" : "New event"}>
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
        </div>

        <p className="text-ink-500 mt-4 text-xs font-light">
          Venues, airports, stations and the IBC are kept on the event itself,
          under Places of interest.
        </p>
      </Fieldset>

      <div className="flex gap-3">
        <Button type="submit" disabled={saving}>
          {saving ? "Saving…" : isEdit ? "Save changes" : "Create event"}
        </Button>
        <Button
          type="button"
          variant="ghost"
          onClick={onDone ?? (() => router.back())}
          disabled={saving}
        >
          Cancel
        </Button>
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
