"use client";

import { useState } from "react";

import { Button, Field, FormError, friendlyError, Input, Select, Textarea } from "~/app/_components/form";
import { api } from "~/trpc/react";

export type ClientKind = "company" | "person";

/** A company, or a private person with no company behind them (doc §4.10). */
export function ClientKindToggle({ kind, onChange }: { kind: ClientKind; onChange: (kind: ClientKind) => void }) {
  const option = (value: ClientKind, label: string) => (
    <button
      type="button"
      onClick={() => onChange(value)}
      aria-pressed={kind === value}
      className={`rounded-md px-3 py-1.5 text-[13px] ${
        kind === value ? "text-ink-900 bg-white font-medium shadow-sm" : "text-ink-500 font-light hover:text-ink-900"
      }`}
    >
      {label}
    </button>
  );
  return (
    <div className="bg-ink-50 inline-flex rounded-lg p-1">
      {option("company", "A company")}
      {option("person", "A private person")}
    </div>
  );
}

/**
 * A private person as a client (doc §4.10): someone buying for themselves,
 * not for a company. The client is named after them and they are its one
 * contact — so their sales requests, emails and contracts work as any other's.
 */
export function PrivatePersonForm({
  accountManagerId: initialManager = "",
  onCreated,
  onCancel,
}: {
  accountManagerId?: string;
  onCreated: (client: { id: string; contactId: string | null }) => void;
  onCancel: () => void;
}) {
  const utils = api.useUtils();
  const people = api.user.list.useQuery();
  const [draft, setDraft] = useState({ name: "", email: "", mobile: "", phone: "", accountManagerId: initialManager, notes: "" });
  const set = (key: keyof typeof draft) => (e: { target: { value: string } }) => setDraft((current) => ({ ...current, [key]: e.target.value }));

  const create = api.clients.create.useMutation({
    onSuccess: (client) => {
      void utils.clients.invalidate();
      onCreated({ id: client.id, contactId: client.contactId });
    },
  });

  return (
    <form
      onSubmit={(e) => {
        e.preventDefault();
        const accountManagerId = draft.accountManagerId || null;
        create.mutate({
          name: draft.name,
          category: "PRIVATE_PERSON",
          accountManagerId,
          notes: draft.notes,
          contact: { name: draft.name, email: draft.email, mobile: draft.mobile, phone: draft.phone, accountManagerId },
        });
      }}
      className="space-y-4"
    >
      <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-4">
        <Field label="Name" className="lg:col-span-2">
          <Input value={draft.name} onChange={set("name")} placeholder="Jane Smith" autoFocus />
        </Field>
        <Field label="Email">
          <Input type="email" value={draft.email} onChange={set("email")} placeholder="jane@gmail.com" />
        </Field>
        <Field label="Mobile">
          <Input value={draft.mobile} onChange={set("mobile")} placeholder="+44 7700 900123" />
        </Field>
        <Field label="Phone">
          <Input value={draft.phone} onChange={set("phone")} />
        </Field>
        <Field label="Account manager">
          <Select value={draft.accountManagerId} onChange={set("accountManagerId")}>
            <option value="">Nobody yet</option>
            {(people.data ?? []).map((person) => (
              <option key={person.id} value={person.id}>
                {person.name ?? person.email}
              </option>
            ))}
          </Select>
        </Field>
        <Field label="Notes" className="sm:col-span-2">
          <Textarea rows={2} value={draft.notes} onChange={set("notes")} />
        </Field>
      </div>
      <div className="space-y-2">
        <FormError message={create.error ? friendlyError(create.error) : null} />
        <div className="flex gap-2">
          <Button type="submit" disabled={create.isPending || !draft.name.trim()}>
            {create.isPending ? "Adding…" : "Add person"}
          </Button>
          <Button type="button" variant="ghost" onClick={onCancel}>
            Cancel
          </Button>
        </div>
      </div>
    </form>
  );
}
