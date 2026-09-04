"use client";

import { useState } from "react";

import { Button, Field, Fieldset, FormError, Input, Textarea } from "~/app/_components/form";
import { EmptyState, Table, Td, Th } from "~/app/_components/ui";
import { api } from "~/trpc/react";

/**
 * The B2B buyers we sell room-nights to. Clients are global rather than
 * per-event — the same federation comes back for the next Games, and a hold on
 * a room-night points at one of these.
 */
export function ClientList() {
  const clients = api.clients.list.useQuery();
  const [name, setName] = useState("");
  const [shortName, setShortName] = useState("");
  const [notes, setNotes] = useState("");
  const [error, setError] = useState<string | null>(null);

  const create = api.clients.create.useMutation({
    onSuccess: () => {
      setName("");
      setShortName("");
      setNotes("");
      setError(null);
      void clients.refetch();
    },
    onError: (e) => setError(e.message),
  });

  const rows = clients.data ?? [];

  return (
    <div className="space-y-8">
      <Fieldset
        title="Add a client"
        description="A federation, broadcaster, sponsor or event team we sell to."
      >
        <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
          <Field label="Name">
            <Input
              value={name}
              onChange={(e) => setName(e.target.value)}
              placeholder="Comité National Olympique et Sportif Français"
            />
          </Field>
          <Field label="Short name" hint="Used on the stock sheet, where space is tight.">
            <Input
              value={shortName}
              onChange={(e) => setShortName(e.target.value)}
              placeholder="CNOSF"
            />
          </Field>
          <div className="flex flex-col">
            <span
              aria-hidden="true"
              className="text-ink-700 mb-1.5 block text-[13px] font-medium"
            >
              &nbsp;
            </span>
            <Button
              type="button"
              disabled={!name.trim() || create.isPending}
              onClick={() =>
                create.mutate({
                  name,
                  shortName: shortName || undefined,
                  notes: notes || undefined,
                })
              }
            >
              {create.isPending ? "Adding…" : "Add client"}
            </Button>
          </div>
          <Field label="Notes" className="lg:col-span-3">
            <Textarea
              rows={2}
              value={notes}
              onChange={(e) => setNotes(e.target.value)}
            />
          </Field>
        </div>
        {error && (
          <div className="mt-4">
            <FormError message={error} />
          </div>
        )}
      </Fieldset>

      {rows.length === 0 && !clients.isLoading ? (
        <EmptyState
          title="No clients yet"
          description="Add the first one above. Until a client exists, nothing can be blocked or sold."
        />
      ) : (
        <Table>
          <thead>
            <tr>
              <Th>Client</Th>
              <Th>Short name</Th>
              <Th>Room-nights held</Th>
              <Th>Requests open</Th>
              <Th>Notes</Th>
            </tr>
          </thead>
          <tbody>
            {rows.map((client) => (
              <tr key={client.id}>
                <Td>
                  <span className="font-medium">{client.name}</span>
                </Td>
                <Td>{client.shortName ?? "—"}</Td>
                <Td>{client._count.roomNights}</Td>
                <Td>{client._count.requests}</Td>
                <Td>
                  <span className="text-ink-500 block max-w-md text-xs font-light">
                    {client.notes ?? "—"}
                  </span>
                </Td>
              </tr>
            ))}
          </tbody>
        </Table>
      )}

      <p className="text-ink-500 text-xs font-light">
        &ldquo;Room-nights held&rdquo; counts every night this client has blocked,
        bought or had cancelled — a hard hold, which only one client can have on
        a night. &ldquo;Requests open&rdquo; counts soft requests, which lock
        nothing and which several clients may hold on the same night.
      </p>
    </div>
  );
}
