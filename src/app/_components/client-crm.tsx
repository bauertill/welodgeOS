"use client";

import type { ClientCategory, ContactType, Priority } from "generated/prisma";
import { useRouter } from "next/navigation";
import { useState } from "react";

import { Manager } from "~/app/_components/client-list";
import { Button, Field, FormError, friendlyError, Input, Select, Textarea } from "~/app/_components/form";
import { Card } from "~/app/_components/ui";
import {
  clientCategoryLabels,
  clientCategoryOrder,
  contactTypeLabels,
  contactTypeOrder,
  priorityLabels,
  priorityOrder,
} from "~/lib/clients";
import { api, type RouterOutputs } from "~/trpc/react";

type Client = NonNullable<RouterOutputs["clients"]["byId"]>;
type Contact = Client["contacts"][number];

/** Everything on the client's page re-reads after a save, its history included. */
function useSaved() {
  const router = useRouter();
  const utils = api.useUtils();
  return () => {
    void utils.clients.invalidate();
    void utils.audit.invalidate();
    router.refresh();
  };
}

function Row({ label, value }: { label: string; value?: React.ReactNode }) {
  return (
    <div className="flex gap-3">
      <dt className="text-ink-500 w-32 shrink-0">{label}</dt>
      <dd className="text-ink-900 min-w-0 break-words whitespace-pre-line">{value ?? "—"}</dd>
    </div>
  );
}

function PeoplePicker({ value, onChange }: { value: string; onChange: (id: string) => void }) {
  const people = api.user.list.useQuery();
  return (
    <Select value={value} onChange={(e) => onChange(e.target.value)}>
      <option value="">Nobody yet</option>
      {(people.data ?? []).map((person) => (
        <option key={person.id} value={person.id}>
          {person.name ?? person.email}
        </option>
      ))}
    </Select>
  );
}

const linkish = (href: string, text: string) => (
  <a href={href} target="_blank" rel="noreferrer" className="text-brand-700 hover:underline">
    {text}
  </a>
);

/** The company itself: its category, account manager and general details (doc §4.10). */
export function ClientDetailsCard({ client }: { client: Client }) {
  const [editing, setEditing] = useState(false);
  const website = client.website ? (/^https?:\/\//.test(client.website) ? client.website : `https://${client.website}`) : null;
  return (
    <Card>
      <div className="mb-3 flex items-baseline justify-between gap-3">
        <h2 className="text-ink-900 text-[15px] font-medium">About the client</h2>
        {!editing && (
          <button type="button" onClick={() => setEditing(true)} className="text-brand-700 text-[13px] font-light hover:underline">
            Edit
          </button>
        )}
      </div>
      {editing ? (
        <ClientEditor client={client} onDone={() => setEditing(false)} />
      ) : (
        <dl className="space-y-2 text-sm font-light">
          <Row label="Category" value={client.category ? clientCategoryLabels[client.category] : null} />
          <Row label="Account manager" value={client.accountManager ? <Manager person={client.accountManager} /> : null} />
          <Row label="Short name" value={client.shortName} />
          <Row label="General phone" value={client.phone} />
          <Row
            label="General email"
            value={client.email ? linkish(`mailto:${client.email}`, client.email) : null}
          />
          <Row label="Website" value={website ? linkish(website, client.website!) : null} />
          <Row label="Notes" value={client.notes} />
        </dl>
      )}
    </Card>
  );
}

function ClientEditor({ client, onDone }: { client: Client; onDone: () => void }) {
  const saved = useSaved();
  const [draft, setDraft] = useState({
    name: client.name,
    shortName: client.shortName ?? "",
    category: (client.category ?? "") as ClientCategory | "",
    accountManagerId: client.accountManagerId ?? "",
    phone: client.phone ?? "",
    email: client.email ?? "",
    website: client.website ?? "",
    notes: client.notes ?? "",
  });
  const set = (key: keyof typeof draft) => (value: string) => setDraft((current) => ({ ...current, [key]: value }));
  const save = api.clients.update.useMutation({
    onSuccess: () => {
      saved();
      onDone();
    },
  });

  return (
    <form
      onSubmit={(e) => {
        e.preventDefault();
        save.mutate({
          id: client.id,
          ...draft,
          category: draft.category || null,
          accountManagerId: draft.accountManagerId || null,
        });
      }}
      className="space-y-3"
    >
      <Field label="Name">
        <Input value={draft.name} onChange={(e) => set("name")(e.target.value)} />
      </Field>
      <div className="grid gap-3 sm:grid-cols-2">
        <Field label="Category">
          <Select value={draft.category} onChange={(e) => set("category")(e.target.value)}>
            <option value="">Not set</option>
            {clientCategoryOrder.map((option) => (
              <option key={option} value={option}>
                {clientCategoryLabels[option]}
              </option>
            ))}
          </Select>
        </Field>
        <Field label="Short name">
          <Input value={draft.shortName} onChange={(e) => set("shortName")(e.target.value)} placeholder="CNOSF" />
        </Field>
      </div>
      <Field label="Account manager">
        <PeoplePicker value={draft.accountManagerId} onChange={set("accountManagerId")} />
      </Field>
      <Field label="General phone">
        <Input value={draft.phone} onChange={(e) => set("phone")(e.target.value)} placeholder="+61 2 9650 1010" />
      </Field>
      <Field label="General email">
        <Input type="email" value={draft.email} onChange={(e) => set("email")(e.target.value)} placeholder="info@networkten.com.au" />
      </Field>
      <Field label="Website">
        <Input value={draft.website} onChange={(e) => set("website")(e.target.value)} placeholder="networkten.com.au" />
      </Field>
      <Field label="Notes">
        <Textarea rows={3} value={draft.notes} onChange={(e) => set("notes")(e.target.value)} />
      </Field>
      <div className="space-y-2 pt-1">
        <FormError message={save.error ? friendlyError(save.error) : null} />
        <div className="flex gap-2">
          <Button type="submit" disabled={save.isPending || !draft.name.trim()}>
            {save.isPending ? "Saving…" : "Save"}
          </Button>
          <Button type="button" variant="ghost" onClick={onDone}>
            Cancel
          </Button>
        </div>
      </div>
    </form>
  );
}

/** The people who work at the client, added and changed in place (doc §4.10). */
export function ClientContactsCard({ client }: { client: Client }) {
  const [editing, setEditing] = useState<string | "new" | null>(null);
  const th = "text-ink-500 border-ink-200/60 border-b px-3 py-2 text-[10px] font-medium tracking-wider whitespace-nowrap uppercase";
  const td = "border-ink-200/40 border-b px-3 py-2 align-top text-[13px] font-light";

  return (
    <Card>
      <div className="mb-3 flex items-baseline justify-between gap-3">
        <h2 className="text-ink-900 text-[15px] font-medium">Contacts</h2>
        {editing === null && (
          <button type="button" onClick={() => setEditing("new")} className="text-brand-700 text-[13px] font-light hover:underline">
            + Add contact
          </button>
        )}
      </div>
      {editing === "new" && (
        <div className="mb-4">
          <ContactEditor clientId={client.id} onDone={() => setEditing(null)} />
        </div>
      )}
      {client.contacts.length === 0 ? (
        editing !== "new" && <p className="text-ink-500 text-sm font-light">No contacts yet — add the people we deal with here.</p>
      ) : (
        <div className="border-ink-200/60 overflow-x-auto rounded-lg border">
          <table className="w-full text-left">
            <thead className="bg-ink-50/60">
              <tr>
                <th className={th}>Name</th>
                <th className={th}>Title</th>
                <th className={th}>Email</th>
                <th className={th}>Mobile · phone</th>
                <th className={th}>Type</th>
                <th className={th}>Priority</th>
                <th className={th}>Manager</th>
                <th className={th}>Comments</th>
                <th className={th}>{""}</th>
              </tr>
            </thead>
            <tbody>
              {client.contacts.map((contact) =>
                editing === contact.id ? (
                  <tr key={contact.id}>
                    <td colSpan={9} className="border-ink-200/40 bg-brand-50/40 border-b p-4">
                      <ContactEditor clientId={client.id} contact={contact} onDone={() => setEditing(null)} />
                    </td>
                  </tr>
                ) : (
                  <tr key={contact.id}>
                    <td className={`${td} text-ink-900 font-medium whitespace-nowrap`}>{contact.name}</td>
                    <td className={td}>{contact.title ?? "—"}</td>
                    <td className={td}>
                      {contact.email ? (
                        <a href={`mailto:${contact.email}`} className="text-brand-700 hover:underline">
                          {contact.email}
                        </a>
                      ) : (
                        "—"
                      )}
                    </td>
                    <td className={`${td} whitespace-nowrap`}>
                      {contact.mobile ?? (contact.phone ? null : "—")}
                      {contact.phone && <span className="text-ink-500 block text-xs">{contact.phone}</span>}
                    </td>
                    <td className={`${td} whitespace-nowrap`}>{contact.type ? contactTypeLabels[contact.type] : "—"}</td>
                    <td className={td}>{contact.priority ? priorityLabels[contact.priority] : "—"}</td>
                    <td className={td}>
                      <Manager person={contact.accountManager} />
                    </td>
                    <td className={`${td} max-w-56 whitespace-pre-line`}>{contact.comments ?? "—"}</td>
                    <td className={td}>
                      {editing === null && (
                        <button
                          type="button"
                          onClick={() => setEditing(contact.id)}
                          className="text-brand-700 text-xs font-light hover:underline"
                        >
                          Edit
                        </button>
                      )}
                    </td>
                  </tr>
                ),
              )}
            </tbody>
          </table>
        </div>
      )}
    </Card>
  );
}

function ContactEditor({ clientId, contact, onDone }: { clientId: string; contact?: Contact; onDone: () => void }) {
  const saved = useSaved();
  const [draft, setDraft] = useState({
    name: contact?.name ?? "",
    title: contact?.title ?? "",
    email: contact?.email ?? "",
    mobile: contact?.mobile ?? "",
    phone: contact?.phone ?? "",
    type: (contact?.type ?? "") as ContactType | "",
    priority: (contact?.priority ?? "") as Priority | "",
    accountManagerId: contact?.accountManagerId ?? "",
    comments: contact?.comments ?? "",
  });
  const [confirming, setConfirming] = useState(false);
  const set = (key: keyof typeof draft) => (value: string) => setDraft((current) => ({ ...current, [key]: value }));
  const done = {
    onSuccess: () => {
      saved();
      onDone();
    },
  };
  const save = api.clients.saveContact.useMutation(done);
  const remove = api.clients.removeContact.useMutation(done);
  const error = save.error ?? remove.error;

  return (
    <form
      onSubmit={(e) => {
        e.preventDefault();
        save.mutate({
          clientId,
          id: contact?.id,
          contact: {
            ...draft,
            type: draft.type || null,
            priority: draft.priority || null,
            accountManagerId: draft.accountManagerId || null,
          },
        });
      }}
    >
      <div className="grid max-w-4xl gap-3 sm:grid-cols-6">
        <Field label="Name" className="sm:col-span-2">
          <Input value={draft.name} onChange={(e) => set("name")(e.target.value)} placeholder="Michelle Marchingo" autoFocus />
        </Field>
        <Field label="Title" className="sm:col-span-2">
          <Input value={draft.title} onChange={(e) => set("title")(e.target.value)} placeholder="Production Manager" />
        </Field>
        <Field label="Email" className="sm:col-span-2">
          <Input type="email" value={draft.email} onChange={(e) => set("email")(e.target.value)} placeholder="name@company.com" />
        </Field>
        <Field label="Mobile" className="sm:col-span-2">
          <Input value={draft.mobile} onChange={(e) => set("mobile")(e.target.value)} placeholder="+61 417 760 667" />
        </Field>
        <Field label="Phone" className="sm:col-span-2">
          <Input value={draft.phone} onChange={(e) => set("phone")(e.target.value)} />
        </Field>
        <Field label="Account manager" className="sm:col-span-2">
          <PeoplePicker value={draft.accountManagerId} onChange={set("accountManagerId")} />
        </Field>
        <Field label="Type" className="sm:col-span-2">
          <Select value={draft.type} onChange={(e) => set("type")(e.target.value)}>
            <option value="">Not set</option>
            {contactTypeOrder.map((option) => (
              <option key={option} value={option}>
                {contactTypeLabels[option]}
              </option>
            ))}
          </Select>
        </Field>
        <Field label="Priority" className="sm:col-span-2">
          <Select value={draft.priority} onChange={(e) => set("priority")(e.target.value)}>
            <option value="">Not set</option>
            {priorityOrder.map((option) => (
              <option key={option} value={option}>
                {priorityLabels[option]}
              </option>
            ))}
          </Select>
        </Field>
        <Field label="Comments" className="sm:col-span-6">
          <Textarea rows={2} value={draft.comments} onChange={(e) => set("comments")(e.target.value)} />
        </Field>
      </div>
      <div className="mt-3 flex flex-wrap items-center gap-2">
        <Button type="submit" disabled={save.isPending || !draft.name.trim()}>
          {save.isPending ? "Saving…" : contact ? "Save" : "Add contact"}
        </Button>
        <Button type="button" variant="ghost" onClick={onDone}>
          Cancel
        </Button>
        {contact &&
          (confirming ? (
            <span className="text-xs font-light">
              Remove {contact.name}?{" "}
              <button type="button" onClick={() => remove.mutate({ id: contact.id })} className="font-medium text-[#c03654] hover:underline">
                Yes, remove
              </button>{" "}
              ·{" "}
              <button type="button" onClick={() => setConfirming(false)} className="text-ink-500 hover:underline">
                Keep
              </button>
            </span>
          ) : (
            <button type="button" onClick={() => setConfirming(true)} className="text-xs font-light text-[#c03654] hover:underline">
              Remove contact
            </button>
          ))}
        {error && <span className="text-xs text-[#c03654]">{friendlyError(error)}</span>}
      </div>
    </form>
  );
}
