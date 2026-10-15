"use client";

import { useRouter } from "next/navigation";
import { useState } from "react";

import { Button, Field, FormError, friendlyError, Label, Select } from "~/app/_components/form";
import { Card } from "~/app/_components/ui";
import { api } from "~/trpc/react";

/**
 * The event's team (doc §2.3): its project lead, and its accommodation
 * managers — who are given each new sales request's sourcing task, the
 * project lead being told (doc §4.11).
 */
export function EventTeam({
  eventId,
  projectLeadId,
  accommodationManagerIds,
}: {
  eventId: string;
  projectLeadId: string | null;
  accommodationManagerIds: string[];
}) {
  const router = useRouter();
  const people = api.user.list.useQuery();
  const [lead, setLead] = useState(projectLeadId ?? "");
  const [managers, setManagers] = useState(accommodationManagerIds);
  const save = api.event.setTeam.useMutation({ onSuccess: () => router.refresh() });
  const changed = lead !== (projectLeadId ?? "") || managers.slice().sort().join() !== accommodationManagerIds.slice().sort().join();

  return (
    <Card>
      <h2 className="text-ink-900 text-[15px] font-medium">Team</h2>
      <p className="text-ink-500 mt-1 mb-4 text-sm font-light">
        When a sales request for this event has its details in, a sourcing task goes to the accommodation managers, and the project lead is
        told.
      </p>
      <div className="grid gap-4 sm:grid-cols-3">
        <Field label="Project lead">
          <Select value={lead} onChange={(e) => setLead(e.target.value)}>
            <option value="">Nobody yet</option>
            {(people.data ?? []).map((person) => (
              <option key={person.id} value={person.id}>
                {person.name ?? person.email}
              </option>
            ))}
          </Select>
        </Field>
        <div className="sm:col-span-2">
          <Label>Accommodation managers</Label>
          <div className="flex flex-wrap gap-1.5">
            {(people.data ?? []).map((person) => {
              const chosen = managers.includes(person.id);
              return (
                <button
                  key={person.id}
                  type="button"
                  aria-pressed={chosen}
                  onClick={() => setManagers(chosen ? managers.filter((id) => id !== person.id) : [...managers, person.id])}
                  className={`rounded-full border px-3 py-1.5 text-[13px] transition-colors ${
                    chosen ? "border-brand-400 bg-brand-50 text-brand-800 font-medium" : "border-ink-200 text-ink-500 hover:text-ink-900 bg-white font-light"
                  }`}
                >
                  {person.name ?? person.email}
                </button>
              );
            })}
          </div>
        </div>
      </div>
      <div className="mt-4 flex items-center gap-3">
        <Button
          type="button"
          disabled={!changed || save.isPending}
          onClick={() => save.mutate({ id: eventId, projectLeadId: lead || null, accommodationManagerIds: managers })}
        >
          {save.isPending ? "Saving…" : "Save team"}
        </Button>
        {save.isSuccess && !changed && <span className="text-ink-500 text-xs font-light">Saved.</span>}
      </div>
      {save.error && <FormError message={friendlyError(save.error)} />}
    </Card>
  );
}
