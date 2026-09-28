"use client";

import Link from "next/link";
import { useRouter } from "next/navigation";
import { useState } from "react";

import { Button, Field, Fieldset, FormError, friendlyError, Input, Textarea } from "~/app/_components/form";
import { contractingFields, type ContractingKey } from "~/lib/contracting";
import { propertyTypeLabels } from "~/lib/scouting";
import { api, type RouterOutputs } from "~/trpc/react";

type Provider = NonNullable<RouterOutputs["provider"]["byId"]>;
type ContactDraft = { name: string; role: string; email: string; phone: string };

/** A provider's own details: contacts and contracting details its properties can fall back on. */
export function ProviderForm({ provider, backTo }: { provider: Provider; backTo?: string }) {
  const router = useRouter();
  const [name, setName] = useState(provider.name);
  const [website, setWebsite] = useState(provider.website ?? "");
  const [notes, setNotes] = useState(provider.notes ?? "");
  const [details, setDetails] = useState<Partial<Record<ContractingKey, string>>>(
    Object.fromEntries(contractingFields.map((field) => [field.key, provider[field.key] ?? ""])),
  );
  const [contacts, setContacts] = useState<ContactDraft[]>(
    provider.contacts.map((contact) => ({
      name: contact.name,
      role: contact.role ?? "",
      email: contact.email ?? "",
      phone: contact.phone ?? "",
    })),
  );
  const [saved, setSaved] = useState(false);

  const save = api.provider.update.useMutation({
    onSuccess: () => {
      setSaved(true);
      router.refresh();
    },
  });
  const remove = api.provider.remove.useMutation({ onSuccess: () => router.push(backTo ?? "/events") });

  const setContact = (index: number, patch: Partial<ContactDraft>) => {
    setSaved(false);
    setContacts((list) => list.map((contact, i) => (i === index ? { ...contact, ...patch } : contact)));
  };

  return (
    <form
      className="max-w-3xl space-y-5"
      onSubmit={(e) => {
        e.preventDefault();
        save.mutate({
          id: provider.id,
          name,
          website,
          notes,
          ...details,
          contacts: contacts.filter((contact) => contact.name.trim()),
        });
      }}
    >
      <Fieldset title="The provider">
        <div className="grid gap-4 sm:grid-cols-2">
          <Field label="Name">
            <Input value={name} onChange={(e) => { setSaved(false); setName(e.target.value); }} />
          </Field>
          <Field label="Website">
            <Input value={website} onChange={(e) => { setSaved(false); setWebsite(e.target.value); }} placeholder="https://…" />
          </Field>
          <Field label="Notes" className="sm:col-span-2">
            <Textarea value={notes} rows={3} onChange={(e) => { setSaved(false); setNotes(e.target.value); }} />
          </Field>
        </div>
      </Fieldset>

      <Fieldset
        title="Contracting details"
        description="For the group that signs one contract for several of its hotels. A property with no contracting details of its own uses these. Visible to every colleague."
      >
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

      <Fieldset
        title="Contacts"
        description="People at the group, not at one hotel. They are listed on each of its properties too."
        action={
          <Button
            type="button"
            variant="secondary"
            onClick={() => setContacts([...contacts, { name: "", role: "", email: "", phone: "" }])}
          >
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
                <Input value={contact.role} onChange={(e) => setContact(index, { role: e.target.value })} placeholder="Group sales" />
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

      <Fieldset title="Its properties" description="Choose the provider on a property's form to add it here.">
        {provider.properties.length === 0 ? (
          <p className="text-ink-500 text-sm font-light">None yet.</p>
        ) : (
          <ul className="space-y-1 text-sm">
            {provider.properties.map((property) => (
              <li key={property.id}>
                <Link
                  href={`/properties/${property.id}${backTo ? `?back=${encodeURIComponent(backTo)}` : ""}`}
                  className="hover:text-brand-700"
                >
                  {property.name}
                </Link>
                <span className="text-ink-500 font-light">
                  {" "}
                  · {propertyTypeLabels[property.type]}
                  {property.city ? ` · ${property.city}` : ""}
                </span>
              </li>
            ))}
          </ul>
        )}
      </Fieldset>

      <FormError message={friendlyError(save.error) ?? friendlyError(remove.error)} />
      <div className="flex items-center gap-3">
        <Button type="submit" disabled={!name.trim() || save.isPending}>
          {save.isPending ? "Saving…" : "Save provider"}
        </Button>
        {saved && <span className="text-sm font-light text-[#0d8f5d]">Saved.</span>}
        <Button
          type="button"
          variant="danger"
          className="ml-auto"
          disabled={remove.isPending}
          onClick={() => {
            if (
              window.confirm(
                `Delete ${provider.name}? Its ${provider.properties.length} properties stay, with no provider.`,
              )
            ) {
              remove.mutate({ id: provider.id });
            }
          }}
        >
          Delete provider
        </Button>
      </div>
    </form>
  );
}
