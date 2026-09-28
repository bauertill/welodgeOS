"use client";

import { keepPreviousData } from "@tanstack/react-query";
import type { ClientCategory } from "generated/prisma";
import Link from "next/link";
import { useEffect, useState } from "react";

import { Button, Field, Fieldset, FormError, Input, Select, Textarea } from "~/app/_components/form";
import { Initials } from "~/app/_components/property-groups";
import { EmptyState, Table, Td, Th } from "~/app/_components/ui";
import { clientCategoryLabels, clientCategoryOrder, contactTypeLabels, priorityLabels } from "~/lib/clients";
import { api } from "~/trpc/react";

type Person = { id: string; name: string | null; email: string | null; image: string | null };

/** A colleague as a small badge and first name, or a dash. */
export function Manager({ person }: { person: Person | null }) {
  if (!person) return <span className="text-ink-500">—</span>;
  return (
    <span className="inline-flex items-center gap-2 whitespace-nowrap">
      <Initials person={person} />
      <span className="text-[13px] font-light">{(person.name ?? person.email ?? "").split(" ")[0]}</span>
    </span>
  );
}

/**
 * The clients — the companies we sell room-nights to, or hope to — searched by
 * company or by person (doc §4.10). Clients are global rather than per-event:
 * the same federation comes back for the next Games, and a hold on a
 * room-night points at one of these.
 */
export function ClientList() {
  const [view, setView] = useState<"companies" | "people">("companies");
  const [typed, setTyped] = useState("");
  const [q, setQ] = useState("");
  const [adding, setAdding] = useState(false);

  // Searched a moment after typing stops, not on every keystroke.
  useEffect(() => {
    const timer = setTimeout(() => setQ(typed), 250);
    return () => clearTimeout(timer);
  }, [typed]);

  const tab = (value: typeof view, label: string) => (
    <button
      type="button"
      onClick={() => setView(value)}
      aria-pressed={view === value}
      className={`rounded-md px-3 py-1.5 text-[13px] ${
        view === value ? "text-ink-900 bg-white font-medium shadow-sm" : "text-ink-500 font-light hover:text-ink-900"
      }`}
    >
      {label}
    </button>
  );

  return (
    <div className="space-y-6">
      <div className="flex flex-wrap items-center gap-3">
        <div className="min-w-64 flex-1">
          <Input
            type="search"
            value={typed}
            onChange={(e) => setTyped(e.target.value)}
            placeholder={
              view === "companies"
                ? "Search by company, or by a person there — name, email, title, phone"
                : "Search people by name, email, title, phone, or their company"
            }
            aria-label="Search clients"
          />
        </div>
        <div className="bg-ink-50 flex rounded-lg p-1">
          {tab("companies", "Companies")}
          {tab("people", "People")}
        </div>
        {!adding && (
          <Button type="button" onClick={() => setAdding(true)}>
            + Add client
          </Button>
        )}
      </div>

      {adding && <AddClient onDone={() => setAdding(false)} />}

      {view === "companies" ? <Companies q={q} /> : <People q={q} />}
    </div>
  );
}

function Companies({ q }: { q: string }) {
  const clients = api.clients.search.useQuery({ q }, { placeholderData: keepPreviousData });
  const rows = clients.data ?? [];

  if (rows.length === 0 && !clients.isLoading) {
    return q.trim() ? (
      <EmptyState title="No client matches" description={`Nothing found for "${q.trim()}", by company or by person.`} />
    ) : (
      <EmptyState
        title="No clients yet"
        description="Add the first one above. Until a client exists, nothing can be blocked or sold."
      />
    );
  }

  return (
    <>
      <Table>
        <thead>
          <tr>
            <Th>Client</Th>
            <Th>Category</Th>
            <Th>Account manager</Th>
            <Th>Contacts</Th>
            <Th>Room-nights sold</Th>
            <Th>Requests open</Th>
          </tr>
        </thead>
        <tbody>
          {rows.map((client) => (
            <tr key={client.id}>
              <Td>
                <Link href={`/clients/${client.id}`} className="hover:text-brand-700 font-medium">
                  {client.name}
                </Link>
                {client.shortName && <span className="text-ink-500 ml-2 text-xs font-light">{client.shortName}</span>}
                {client.matchedContacts.length > 0 && (
                  <span className="text-ink-500 block text-xs font-light">
                    {client.matchedContacts
                      .map((contact) => (contact.title ? `${contact.name}, ${contact.title}` : contact.name))
                      .join(" · ")}
                  </span>
                )}
              </Td>
              <Td>{client.category ? clientCategoryLabels[client.category] : "—"}</Td>
              <Td>
                <Manager person={client.accountManager} />
              </Td>
              <Td>{client._count.contacts}</Td>
              <Td>{client._count.roomNights}</Td>
              <Td>{client._count.requests}</Td>
            </tr>
          ))}
        </tbody>
      </Table>
      <p className="text-ink-500 text-xs font-light">
        A search finds a company by its name, or by anyone who works there — the people who matched are listed
        under its name. &ldquo;Room-nights sold&rdquo; counts the nights this client has bought from us — not
        those they have only blocked, and not cancelled ones. &ldquo;Requests open&rdquo; counts soft
        requests, which lock nothing and which several clients may hold on the same night.
      </p>
    </>
  );
}

function People({ q }: { q: string }) {
  const people = api.clients.people.useQuery({ q }, { placeholderData: keepPreviousData });
  const rows = people.data ?? [];

  if (rows.length === 0 && !people.isLoading) {
    return q.trim() ? (
      <EmptyState title="Nobody matches" description={`No contact found for "${q.trim()}".`} />
    ) : (
      <EmptyState title="No contacts yet" description="Open a client and add the people who work there." />
    );
  }

  return (
    <Table>
      <thead>
        <tr>
          <Th>Name</Th>
          <Th>Client</Th>
          <Th>Title</Th>
          <Th>Email</Th>
          <Th>Mobile</Th>
          <Th>Type</Th>
          <Th>Priority</Th>
          <Th>Account manager</Th>
        </tr>
      </thead>
      <tbody>
        {rows.map((contact) => (
          <tr key={contact.id}>
            <Td>
              <Link href={`/clients/${contact.client.id}`} className="hover:text-brand-700 font-medium">
                {contact.name}
              </Link>
            </Td>
            <Td>
              <Link href={`/clients/${contact.client.id}`} className="hover:text-brand-700">
                {contact.client.name}
              </Link>
            </Td>
            <Td>{contact.title ?? "—"}</Td>
            <Td>
              {contact.email ? (
                <a href={`mailto:${contact.email}`} className="text-brand-700 hover:underline">
                  {contact.email}
                </a>
              ) : (
                "—"
              )}
            </Td>
            <Td>
              <span className="whitespace-nowrap">{contact.mobile ?? "—"}</span>
            </Td>
            <Td>{contact.type ? contactTypeLabels[contact.type] : "—"}</Td>
            <Td>{contact.priority ? priorityLabels[contact.priority] : "—"}</Td>
            <Td>
              <Manager person={contact.accountManager} />
            </Td>
          </tr>
        ))}
      </tbody>
    </Table>
  );
}

function AddClient({ onDone }: { onDone: () => void }) {
  const utils = api.useUtils();
  const people = api.user.list.useQuery();
  const [name, setName] = useState("");
  const [shortName, setShortName] = useState("");
  const [category, setCategory] = useState<ClientCategory | "">("");
  const [accountManagerId, setAccountManagerId] = useState("");
  const [notes, setNotes] = useState("");
  const [error, setError] = useState<string | null>(null);

  const create = api.clients.create.useMutation({
    onSuccess: () => {
      void utils.clients.invalidate();
      onDone();
    },
    onError: (e) => setError(e.message),
  });

  return (
    <Fieldset title="Add a client" description="A federation, broadcaster, sponsor or event team we sell to — or hope to.">
      <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-4">
        <Field label="Name" className="lg:col-span-2">
          <Input
            value={name}
            onChange={(e) => setName(e.target.value)}
            placeholder="Comité National Olympique et Sportif Français"
            autoFocus
          />
        </Field>
        <Field label="Short name" hint="Used on the stock sheet, where space is tight.">
          <Input value={shortName} onChange={(e) => setShortName(e.target.value)} placeholder="CNOSF" />
        </Field>
        <Field label="Category">
          <Select value={category} onChange={(e) => setCategory(e.target.value as ClientCategory | "")}>
            <option value="">Not set</option>
            {clientCategoryOrder.map((option) => (
              <option key={option} value={option}>
                {clientCategoryLabels[option]}
              </option>
            ))}
          </Select>
        </Field>
        <Field label="Account manager">
          <Select value={accountManagerId} onChange={(e) => setAccountManagerId(e.target.value)}>
            <option value="">Nobody yet</option>
            {(people.data ?? []).map((person) => (
              <option key={person.id} value={person.id}>
                {person.name ?? person.email}
              </option>
            ))}
          </Select>
        </Field>
        <Field label="Notes" className="lg:col-span-3">
          <Textarea rows={2} value={notes} onChange={(e) => setNotes(e.target.value)} />
        </Field>
      </div>
      <div className="mt-4 space-y-2">
        <FormError message={error} />
        <div className="flex gap-2">
          <Button
            type="button"
            disabled={!name.trim() || create.isPending}
            onClick={() =>
              create.mutate({
                name,
                shortName: shortName || undefined,
                notes: notes || undefined,
                category: category || null,
                accountManagerId: accountManagerId || null,
              })
            }
          >
            {create.isPending ? "Adding…" : "Add client"}
          </Button>
          <Button type="button" variant="ghost" onClick={onDone}>
            Cancel
          </Button>
        </div>
      </div>
    </Fieldset>
  );
}
