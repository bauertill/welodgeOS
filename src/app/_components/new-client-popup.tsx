"use client";

import type { ClientCategory } from "generated/prisma";
import { useState } from "react";

import { Button, Field, FormError, friendlyError, Input, Select, Textarea } from "~/app/_components/form";
import { Popup } from "~/app/_components/popup";
import { clientCategoryLabels, clientCategoryOrder } from "~/lib/clients";
import { api } from "~/trpc/react";

/**
 * A client we have not dealt with yet, added from a sales request (doc
 * §4.10, §4.11): the company in full and, if known, the person asking — saved
 * together, then chosen on the request.
 */
export function NewClientPopup({
  accountManagerId,
  onClose,
  onCreated,
  onChooseExisting,
}: {
  accountManagerId: string;
  onClose: () => void;
  onCreated: (client: { id: string; contactId: string | null }) => void;
  onChooseExisting: (id: string) => void;
}) {
  const utils = api.useUtils();
  const people = api.user.list.useQuery();
  const clients = api.clients.list.useQuery();
  const [company, setCompany] = useState({
    name: "",
    shortName: "",
    category: "" as ClientCategory | "",
    accountManagerId,
    phone: "",
    email: "",
    website: "",
    notes: "",
  });
  const [contact, setContact] = useState({ name: "", title: "", email: "", mobile: "", phone: "" });
  const setC = (key: keyof typeof company) => (e: { target: { value: string } }) => setCompany((current) => ({ ...current, [key]: e.target.value }));
  const setP = (key: keyof typeof contact) => (e: { target: { value: string } }) => setContact((current) => ({ ...current, [key]: e.target.value }));

  // The same name as a client we have: choose that one instead of adding it twice.
  const typed = company.name.trim().toLowerCase();
  const existing = typed
    ? (clients.data ?? []).find((client) => client.name.toLowerCase() === typed || client.shortName?.toLowerCase() === typed)
    : undefined;

  const create = api.clients.create.useMutation({
    onSuccess: (client) => {
      void utils.clients.invalidate();
      onCreated({ id: client.id, contactId: client.contactId });
    },
  });

  return (
    <Popup title="A new client" subtitle="Who they are and who is asking — the rest can be added on their page later." onClose={onClose}>
      <form
        className="space-y-5"
        onSubmit={(e) => {
          e.preventDefault();
          if (existing) return;
          create.mutate({
            ...company,
            category: company.category || null,
            accountManagerId: company.accountManagerId || null,
            contact: contact.name.trim() ? { ...contact, accountManagerId: company.accountManagerId || null } : undefined,
          });
        }}
      >
        <div className="border-ink-200/60 rounded-xl border bg-white p-5">
          <h3 className="text-ink-900 mb-3 text-[15px] font-medium">The company</h3>
          <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-4">
            <Field label="Name" className="lg:col-span-2">
              <Input value={company.name} onChange={setC("name")} placeholder="Comité National Olympique et Sportif Français" autoFocus />
            </Field>
            <Field label="Short name" hint="Used on the stock sheet, where space is tight.">
              <Input value={company.shortName} onChange={setC("shortName")} placeholder="CNOSF" />
            </Field>
            <Field label="Category">
              <Select value={company.category} onChange={setC("category")}>
                <option value="">Not set</option>
                {clientCategoryOrder.map((option) => (
                  <option key={option} value={option}>
                    {clientCategoryLabels[option]}
                  </option>
                ))}
              </Select>
            </Field>
            <Field label="General phone">
              <Input value={company.phone} onChange={setC("phone")} placeholder="+33 1 40 78 28 00" />
            </Field>
            <Field label="General email">
              <Input type="email" value={company.email} onChange={setC("email")} placeholder="info@company.com" />
            </Field>
            <Field label="Website">
              <Input value={company.website} onChange={setC("website")} placeholder="company.com" />
            </Field>
            <Field label="Account manager">
              <Select value={company.accountManagerId} onChange={setC("accountManagerId")}>
                <option value="">Nobody yet</option>
                {(people.data ?? []).map((person) => (
                  <option key={person.id} value={person.id}>
                    {person.name ?? person.email}
                  </option>
                ))}
              </Select>
            </Field>
            <Field label="Notes" className="sm:col-span-2 lg:col-span-4">
              <Textarea rows={2} value={company.notes} onChange={setC("notes")} />
            </Field>
          </div>
          {existing && (
            <p className="mt-3 rounded-lg bg-[#fff4e0] px-3 py-2 text-[13px] font-light text-[#8a5a00]">
              {existing.name} is already a client.{" "}
              <button type="button" onClick={() => onChooseExisting(existing.id)} className="font-medium underline">
                Choose them instead
              </button>
            </p>
          )}
        </div>

        <div className="border-ink-200/60 rounded-xl border bg-white p-5">
          <h3 className="text-ink-900 text-[15px] font-medium">Who is asking</h3>
          <p className="text-ink-500 mb-3 text-xs font-light">Optional — the person at the client we are talking to. More can be added on their page.</p>
          <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-5">
            <Field label="Name">
              <Input value={contact.name} onChange={setP("name")} placeholder="Michelle Marchingo" />
            </Field>
            <Field label="Title">
              <Input value={contact.title} onChange={setP("title")} placeholder="Production Manager" />
            </Field>
            <Field label="Email">
              <Input type="email" value={contact.email} onChange={setP("email")} placeholder="name@company.com" />
            </Field>
            <Field label="Mobile">
              <Input value={contact.mobile} onChange={setP("mobile")} placeholder="+61 417 760 667" />
            </Field>
            <Field label="Phone">
              <Input value={contact.phone} onChange={setP("phone")} />
            </Field>
          </div>
        </div>

        <div className="space-y-2">
          <FormError message={create.error ? friendlyError(create.error) : null} />
          <div className="flex gap-2">
            <Button type="submit" disabled={create.isPending || !company.name.trim() || Boolean(existing)}>
              {create.isPending ? "Adding…" : "Add client"}
            </Button>
            <Button type="button" variant="ghost" onClick={onClose}>
              Cancel
            </Button>
          </div>
        </div>
      </form>
    </Popup>
  );
}
