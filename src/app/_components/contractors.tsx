"use client";

import type { ContractorKind } from "generated/prisma";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { useState } from "react";

import { Combobox } from "~/app/_components/combobox";
import { Button, Field, Fieldset, FormError, friendlyError, Input, Select, Textarea } from "~/app/_components/form";
import { Popup } from "~/app/_components/popup";
import { contractingFields, type ContractingKey } from "~/lib/contracting";
import { contractorHref, contractorKindLabels, contractorKinds, contractorWhat } from "~/lib/contractors";
import { useRemembered } from "~/lib/remembered";
import { propertyTypeLabels } from "~/lib/scouting";
import { api, type RouterOutputs } from "~/trpc/react";

const th = "text-ink-500 border-ink-200/60 border-b px-3 py-2.5 text-[10px] font-medium tracking-wider whitespace-nowrap uppercase";
const td = "border-ink-200/40 border-b px-3 py-2.5 align-top text-[13px] font-light";

/**
 * An event's Contractors tab (doc §3.11): the furniture, cleaning and other
 * companies working on it besides the hotels — each belongs to this event
 * alone. Found by name, what they do or a contact; a click on a row opens its
 * page; + New contractor adds one.
 */
export function ContractorList({ eventId }: { eventId: string }) {
  const router = useRouter();
  const [search, setSearch] = useRemembered(`contractors:event:${eventId}:search`, "");
  const [kind, setKind] = useRemembered<string>(`contractors:event:${eventId}:kind`, "");
  const list = api.contractor.list.useQuery({ eventId });
  const [making, setMaking] = useState(false);

  const words = search.trim().toLowerCase().split(/\s+/).filter(Boolean);
  const rows = (list.data ?? []).filter((contractor) => {
    if (kind && contractor.kind !== kind) return false;
    const text = `${contractor.name} ${contractorWhat(contractor)} ${contractor.contacts.map((c) => `${c.name} ${c.email ?? ""}`).join(" ")} ${contractor.email ?? ""}`.toLowerCase();
    return words.every((word) => text.includes(word));
  });

  return (
    <div className="space-y-4">
      <div className="flex flex-wrap items-center gap-3">
        <span className="min-w-64 flex-1">
          <Input value={search} onChange={(e) => setSearch(e.target.value)} placeholder="Search by name, what they do or a contact" aria-label="Search contractors" />
        </span>
        <span className="w-48">
          <Select value={kind} onChange={(e) => setKind(e.target.value)} aria-label="What they do">
            <option value="">Everything they do</option>
            {contractorKinds.map((option) => (
              <option key={option} value={option}>
                {contractorKindLabels[option]}
              </option>
            ))}
          </Select>
        </span>
        <span className="ml-auto">
          <Button type="button" onClick={() => setMaking(true)}>
            + New contractor
          </Button>
        </span>
      </div>

      {list.isLoading ? (
        <p className="text-ink-500 text-sm font-light">Loading…</p>
      ) : rows.length === 0 ? (
        <p className="text-ink-500 text-sm font-light">
          {list.data?.length ? "No contractor matches." : "No contractors on this event yet. Add the furniture, cleaning and other companies working on it with + New contractor."}
        </p>
      ) : (
        <div className="overflow-x-auto rounded-xl bg-white">
          <table className="w-full text-left">
            <thead>
              <tr>
                <th className={`${th} pl-4`}>Contractor</th>
                <th className={th}>What they do</th>
                <th className={th}>Contact</th>
                <th className={th}>Properties</th>
                <th className={th}>Contracts</th>
                <th className={th}>Tasks</th>
              </tr>
            </thead>
            <tbody>
              {rows.map((contractor) => {
                const contact = contractor.contacts[0];
                return (
                  <tr
                    key={contractor.id}
                    className="hover:bg-brand-50/40 cursor-pointer"
                    onClick={(e) => {
                      if ((e.target as HTMLElement).closest("a, button")) return;
                      const href = contractorHref(eventId, contractor.id);
                      if (e.metaKey || e.ctrlKey) window.open(href, "_blank");
                      else router.push(href);
                    }}
                  >
                    <td className={`${td} text-ink-900 pl-4 font-medium`}>
                      <Link href={contractorHref(eventId, contractor.id)} className="hover:text-brand-700">
                        {contractor.name}
                      </Link>
                    </td>
                    <td className={td}>{contractorWhat(contractor)}</td>
                    <td className={td}>
                      {contact ? (
                        <>
                          {contact.name}
                          {(contact.email ?? contact.phone) && <span className="text-ink-500 block text-xs">{contact.email ?? contact.phone}</span>}
                        </>
                      ) : (
                        (contractor.email ?? contractor.phone ?? <span className="text-ink-500">—</span>)
                      )}
                    </td>
                    <td className={td}>{contractor._count.properties || "—"}</td>
                    <td className={td}>{contractor._count.contracts || "—"}</td>
                    <td className={td}>{contractor._count.tasks || "—"}</td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
      )}

      {making && <NewContractor eventId={eventId} onClose={() => setMaking(false)} />}
    </div>
  );
}

/** A new contractor: its name and what it does — the rest on its page, which opens straight after. */
function NewContractor({ eventId, onClose }: { eventId: string; onClose: () => void }) {
  const router = useRouter();
  const [name, setName] = useState("");
  const [kind, setKind] = useState<ContractorKind>("FURNITURE");
  const [service, setService] = useState("");
  const create = api.contractor.create.useMutation({ onSuccess: (made) => router.push(contractorHref(eventId, made.id)) });
  return (
    <Popup size="medium" title="New contractor" subtitle="A company working on this event besides the hotels. Its page opens next, for its contacts, properties and contracts." onClose={onClose}>
      <form
        className="space-y-4 rounded-xl bg-white p-5"
        onSubmit={(e) => {
          e.preventDefault();
          create.mutate({ name, kind, service, eventId });
        }}
      >
        <Field label="Name">
          <Input value={name} onChange={(e) => setName(e.target.value)} placeholder="CORT Furniture Rental" autoFocus />
        </Field>
        <div className="grid gap-4 sm:grid-cols-2">
          <Field label="What they do">
            <Select value={kind} onChange={(e) => setKind(e.target.value as ContractorKind)}>
              {contractorKinds.map((option) => (
                <option key={option} value={option}>
                  {contractorKindLabels[option]}
                </option>
              ))}
            </Select>
          </Field>
          <Field label={kind === "OTHER" ? "Which is" : "More about it — optional"}>
            <Input value={service} onChange={(e) => setService(e.target.value)} placeholder={kind === "OTHER" ? "Photography" : "Beds and sofas for the apartments"} />
          </Field>
        </div>
        <FormError message={create.error ? friendlyError(create.error) : null} />
        <Button type="submit" disabled={!name.trim() || create.isPending}>
          {create.isPending ? "Adding…" : "Add contractor"}
        </Button>
      </form>
    </Popup>
  );
}

type Contractor = NonNullable<RouterOutputs["contractor"]["byId"]>;
type ContactDraft = { name: string; role: string; email: string; phone: string };

/** A contractor's own details: what it does, how to reach it, its contacts and contracting details. */
export function ContractorForm({ contractor }: { contractor: Contractor }) {
  const router = useRouter();
  const [draft, setDraft] = useState({
    name: contractor.name,
    kind: contractor.kind,
    service: contractor.service ?? "",
    website: contractor.website ?? "",
    email: contractor.email ?? "",
    phone: contractor.phone ?? "",
    notes: contractor.notes ?? "",
  });
  const [details, setDetails] = useState<Partial<Record<ContractingKey, string>>>(Object.fromEntries(contractingFields.map((field) => [field.key, contractor[field.key] ?? ""])));
  const [contacts, setContacts] = useState<ContactDraft[]>(contractor.contacts.map((c) => ({ name: c.name, role: c.role ?? "", email: c.email ?? "", phone: c.phone ?? "" })));
  const [saved, setSaved] = useState(false);
  const set = (key: keyof typeof draft, value: string) => {
    setSaved(false);
    setDraft((current) => ({ ...current, [key]: value }));
  };
  const setContact = (index: number, patch: Partial<ContactDraft>) => {
    setSaved(false);
    setContacts((list) => list.map((contact, i) => (i === index ? { ...contact, ...patch } : contact)));
  };
  const save = api.contractor.update.useMutation({
    onSuccess: () => {
      setSaved(true);
      router.refresh();
    },
  });
  const remove = api.contractor.remove.useMutation({ onSuccess: ({ eventId }) => router.push(`/events/${eventId}/contractors`) });

  return (
    <form
      className="space-y-5"
      onSubmit={(e) => {
        e.preventDefault();
        save.mutate({ id: contractor.id, ...draft, ...details, contacts: contacts.filter((contact) => contact.name.trim()) });
      }}
    >
      <Fieldset title="The contractor">
        <div className="grid gap-4 sm:grid-cols-2">
          <Field label="Name">
            <Input value={draft.name} onChange={(e) => set("name", e.target.value)} />
          </Field>
          <div className="grid grid-cols-2 gap-3">
            <Field label="What they do">
              <Select value={draft.kind} onChange={(e) => set("kind", e.target.value)}>
                {contractorKinds.map((option) => (
                  <option key={option} value={option}>
                    {contractorKindLabels[option]}
                  </option>
                ))}
              </Select>
            </Field>
            <Field label={draft.kind === "OTHER" ? "Which is" : "More about it"}>
              <Input value={draft.service} onChange={(e) => set("service", e.target.value)} />
            </Field>
          </div>
          <Field label="Email">
            <Input type="email" value={draft.email} onChange={(e) => set("email", e.target.value)} />
          </Field>
          <Field label="Phone">
            <Input value={draft.phone} onChange={(e) => set("phone", e.target.value)} />
          </Field>
          <Field label="Website">
            <Input value={draft.website} onChange={(e) => set("website", e.target.value)} placeholder="https://…" />
          </Field>
          <Field label="Notes" className="sm:col-span-2">
            <Textarea value={draft.notes} rows={3} onChange={(e) => set("notes", e.target.value)} />
          </Field>
        </div>
      </Fieldset>

      <Fieldset
        title="Contacts"
        description="The people we deal with there."
        action={
          <Button type="button" variant="secondary" onClick={() => setContacts([...contacts, { name: "", role: "", email: "", phone: "" }])}>
            Add contact
          </Button>
        }
      >
        <div className="space-y-3">
          {contacts.map((contact, index) => (
            <div key={index} className="border-ink-200/60 grid gap-3 rounded-lg border p-4 sm:grid-cols-4">
              <Field label="Name">
                <Input value={contact.name} onChange={(e) => setContact(index, { name: e.target.value })} />
              </Field>
              <Field label="Role">
                <Input value={contact.role} onChange={(e) => setContact(index, { role: e.target.value })} placeholder="Account manager" />
              </Field>
              <Field label="Email">
                <Input type="email" value={contact.email} onChange={(e) => setContact(index, { email: e.target.value })} />
              </Field>
              <div className="flex gap-2">
                <Field label="Phone" className="flex-1">
                  <Input value={contact.phone} onChange={(e) => setContact(index, { phone: e.target.value })} />
                </Field>
                <div className="flex items-end pb-1">
                  <Button
                    type="button"
                    variant="ghost"
                    onClick={() => {
                      setSaved(false);
                      setContacts(contacts.filter((_, i) => i !== index));
                    }}
                  >
                    Remove
                  </Button>
                </div>
              </div>
            </div>
          ))}
          {contacts.length === 0 && <p className="text-ink-500 text-sm font-light">No contacts yet.</p>}
        </div>
      </Fieldset>

      <Fieldset title="Contracting details" description="The company a contract is signed with, and where it is paid. Visible to every colleague.">
        <div className="grid gap-4 sm:grid-cols-2">
          {contractingFields.map((field) => (
            <Field key={field.key} label={field.label}>
              <Input
                type={field.key === "contractEmail" ? "email" : "text"}
                value={details[field.key] ?? ""}
                onChange={(e) => {
                  setSaved(false);
                  setDetails({ ...details, [field.key]: e.target.value });
                }}
              />
            </Field>
          ))}
        </div>
      </Fieldset>

      <FormError message={friendlyError(save.error) ?? friendlyError(remove.error)} />
      <div className="flex items-center gap-3">
        <Button type="submit" disabled={!draft.name.trim() || save.isPending}>
          {save.isPending ? "Saving…" : "Save contractor"}
        </Button>
        {saved && <span className="text-sm font-light text-[#0d8f5d]">Saved.</span>}
        <Button
          type="button"
          variant="danger"
          className="ml-auto"
          disabled={remove.isPending}
          onClick={() => {
            if (window.confirm(`Delete ${contractor.name}? Its contacts and properties go with it; tasks stay, about nothing. Refused while it has a contract.`)) remove.mutate({ id: contractor.id });
          }}
        >
          Delete contractor
        </Button>
      </div>
    </form>
  );
}

/** The properties a contractor serves — among its event's — and what it does at each. */
export function ContractorProperties({ contractor }: { contractor: Contractor }) {
  const router = useRouter();
  const entries = api.scouting.listForEvent.useQuery({ eventId: contractor.eventId, amenityIds: [] });
  const properties = (entries.data ?? []).filter((entry) => entry.status !== "REJECTED").map((entry) => entry.property);
  const [adding, setAdding] = useState("");
  const [what, setWhat] = useState("");
  const set = api.contractor.setProperty.useMutation({
    onSuccess: () => {
      setAdding("");
      setWhat("");
      router.refresh();
    },
  });
  const linked = new Set(contractor.properties.map((p) => p.propertyId));
  return (
    <div className="space-y-3">
      {contractor.properties.length === 0 ? (
        <p className="text-ink-500 text-sm font-light">No properties yet.</p>
      ) : (
        <ul className="divide-ink-200/60 divide-y text-[13px]">
          {contractor.properties.map((entry) => (
            <li key={entry.propertyId} className="flex flex-wrap items-baseline gap-x-3 gap-y-1 py-2">
              <Link href={`/properties/${entry.propertyId}`} className="text-ink-900 hover:text-brand-700 font-medium">
                {entry.property.name}
              </Link>
              <span className="text-ink-500 text-xs font-light">
                {propertyTypeLabels[entry.property.type]}
                {entry.property.city ? ` · ${entry.property.city}` : ""}
              </span>
              <span className="text-ink-700 min-w-0 flex-1 font-light">{entry.what ?? ""}</span>
              <button
                type="button"
                onClick={() => {
                  const next = window.prompt(`What does ${contractor.name} do at ${entry.property.name}?`, entry.what ?? "");
                  if (next !== null) set.mutate({ contractorId: contractor.id, propertyId: entry.propertyId, on: true, what: next });
                }}
                className="text-brand-700 text-xs hover:underline"
              >
                Change
              </button>
              <button type="button" onClick={() => set.mutate({ contractorId: contractor.id, propertyId: entry.propertyId, on: false })} className="text-ink-500 text-xs hover:underline">
                Remove
              </button>
            </li>
          ))}
        </ul>
      )}
      <div className="flex flex-wrap items-center gap-2">
        <span className="w-72">
          <Combobox
            value={adding}
            onChange={setAdding}
            placeholder="Add a property it serves…"
            options={properties.filter((property) => !linked.has(property.id)).map((property) => ({ id: property.id, label: property.name, detail: property.city }))}
          />
        </span>
        <span className="min-w-56 flex-1">
          <Input value={what} onChange={(e) => setWhat(e.target.value)} placeholder="What it does there — “Furnishes the 12 apartments”" aria-label="What it does there" />
        </span>
        <Button type="button" variant="secondary" disabled={!adding || set.isPending} onClick={() => set.mutate({ contractorId: contractor.id, propertyId: adding, on: true, what })}>
          Add
        </Button>
      </div>
      <FormError message={set.error ? friendlyError(set.error) : null} />
    </div>
  );
}

/** On a property's page: the contractors serving it, and what each does there. */
export function PropertyContractors({ propertyId }: { propertyId: string }) {
  const rows = api.contractor.forProperty.useQuery({ propertyId });
  if (rows.isLoading) return <p className="text-ink-500 text-sm font-light">Loading…</p>;
  if (!rows.data?.length) {
    return (
      <p className="text-ink-500 text-sm font-light">None yet. Add a property to a contractor on its page, under the event&apos;s Contractors tab.</p>
    );
  }
  return (
    <ul className="divide-ink-200/60 divide-y text-[13px]">
      {rows.data.map((entry) => (
        <li key={entry.contractorId} className="flex flex-wrap items-baseline gap-x-3 py-2">
          <Link href={contractorHref(entry.contractor.eventId, entry.contractorId)} className="text-ink-900 hover:text-brand-700 font-medium">
            {entry.contractor.name}
          </Link>
          <span className="text-ink-500 text-xs font-light">
            {contractorWhat(entry.contractor)} · {entry.contractor.event.name}
          </span>
          {entry.what && <span className="text-ink-700 font-light">{entry.what}</span>}
          {(entry.contractor.phone ?? entry.contractor.email) && <span className="text-ink-500 ml-auto text-xs font-light">{entry.contractor.phone ?? entry.contractor.email}</span>}
        </li>
      ))}
    </ul>
  );
}
