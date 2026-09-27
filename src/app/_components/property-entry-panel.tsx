"use client";

import Link from "next/link";
import { useEffect, useState } from "react";

import { Button, Field, FormError, friendlyError, Input, Select, Textarea } from "~/app/_components/form";
import { ContactList, ContractingDetails, PropertyFacts } from "~/app/_components/property-details";
import { termTextFields } from "~/lib/contracting";
import { dayKey, parseDay } from "~/lib/dates";
import { propertyTypeLabels } from "~/lib/scouting";
import { api } from "~/trpc/react";

type TermKey = (typeof termTextFields)[number]["key"];

/**
 * A property on this event, opened from the Properties tab (doc §3.9): the
 * terms agreed for this event — kept on the event, never shared with another —
 * beside what the property itself carries, including the contracting details
 * that go to the lawyers.
 */
export function PropertyEntryPanel({ entryId, onClose }: { entryId: string; onClose: () => void }) {
  const utils = api.useUtils();
  const entry = api.scouting.entry.useQuery({ id: entryId });
  const people = api.user.list.useQuery();

  const [accountManagerId, setAccountManagerId] = useState("");
  const [terms, setTerms] = useState<Record<TermKey, string>>({
    applicablePeriod: "",
    ratesInclude: "",
    deposit: "",
    cancellationTerms: "",
    paymentTerms: "",
  });
  const [blockExpiry, setBlockExpiry] = useState("");
  const [roomingListDeadline, setRoomingListDeadline] = useState("");
  const [minimumStay, setMinimumStay] = useState("");
  const [saved, setSaved] = useState(false);

  useEffect(() => {
    const data = entry.data;
    if (!data) return;
    setAccountManagerId(data.accountManagerId ?? "");
    setTerms(
      Object.fromEntries(termTextFields.map(({ key }) => [key, data[key] ?? ""])) as Record<TermKey, string>,
    );
    setBlockExpiry(data.blockExpiry ? dayKey(data.blockExpiry) : "");
    setRoomingListDeadline(data.roomingListDeadline ? dayKey(data.roomingListDeadline) : "");
    setMinimumStay(data.minimumStayNights ? String(data.minimumStayNights) : "");
  }, [entry.data]);

  useEffect(() => {
    const onEscape = (e: KeyboardEvent) => {
      if (e.key === "Escape") onClose();
    };
    window.addEventListener("keydown", onEscape);
    return () => window.removeEventListener("keydown", onEscape);
  }, [onClose]);

  const save = api.scouting.updateTerms.useMutation({
    onSuccess: () => {
      setSaved(true);
      void utils.scouting.entry.invalidate({ id: entryId });
      void utils.scouting.listForEvent.invalidate();
    },
  });

  const edited = () => setSaved(false);
  const property = entry.data?.property;

  return (
    <>
      <div className="fixed inset-0 z-30 bg-black/20" onClick={onClose} aria-hidden="true" />
      <aside
        role="dialog"
        aria-label={property?.name ?? "Property"}
        className="border-ink-200/60 fixed inset-y-0 right-0 z-40 w-full max-w-xl overflow-y-auto border-l bg-white p-6 shadow-xl"
      >
        <div className="mb-5 flex items-start justify-between gap-3">
          <div className="min-w-0">
            <h2 className="text-ink-900 text-lg font-semibold">{property?.name ?? "Loading…"}</h2>
            {property && (
              <p className="text-ink-500 text-sm font-light">
                {[
                  property.provider?.name,
                  propertyTypeLabels[property.type],
                  property.stars ? `${property.stars}-star` : null,
                  // The area, then the city — once, when they are the same.
                  [...new Set([property.area, property.city].filter(Boolean))].join(", ") || null,
                ]
                  .filter(Boolean)
                  .join(" · ")}
              </p>
            )}
          </div>
          <button type="button" onClick={onClose} aria-label="Close" className="text-ink-500 hover:text-ink-900 text-xl leading-none">
            ×
          </button>
        </div>

        {entry.data && property && (
          <div className="space-y-8">
            <form
              className="space-y-4"
              onSubmit={(e) => {
                e.preventDefault();
                save.mutate({
                  id: entryId,
                  accountManagerId: accountManagerId || null,
                  ...terms,
                  blockExpiry: blockExpiry ? parseDay(blockExpiry) : null,
                  roomingListDeadline: roomingListDeadline ? parseDay(roomingListDeadline) : null,
                  minimumStayNights: minimumStay.trim() ? Number(minimumStay) : null,
                });
              }}
            >
              <div>
                <h3 className="text-ink-900 text-[15px] font-medium">Agreed for this event</h3>
                <p className="text-ink-500 text-xs font-light">
                  Kept on this event only — another event&apos;s terms for the same hotel are never touched.
                </p>
              </div>

              <Field label="Account manager" hint="The colleague who owns this hotel on this event.">
                <Select
                  value={accountManagerId}
                  onChange={(e) => {
                    edited();
                    setAccountManagerId(e.target.value);
                  }}
                >
                  <option value="">Nobody yet</option>
                  {(people.data ?? []).map((person) => (
                    <option key={person.id} value={person.id}>
                      {person.name ?? person.email}
                    </option>
                  ))}
                </Select>
              </Field>

              {termTextFields.map((field) => (
                <Field key={field.key} label={field.label} hint={"hint" in field ? field.hint : undefined}>
                  <Textarea
                    rows={field.key === "applicablePeriod" || field.key === "ratesInclude" ? 3 : 2}
                    value={terms[field.key]}
                    onChange={(e) => {
                      edited();
                      setTerms({ ...terms, [field.key]: e.target.value });
                    }}
                  />
                </Field>
              ))}

              <div className="grid gap-4 sm:grid-cols-3">
                <Field label="Block expiry" hint="When the hotel's hold on our rooms runs out.">
                  <Input type="date" value={blockExpiry} onChange={(e) => { edited(); setBlockExpiry(e.target.value); }} />
                </Field>
                <Field label="Rooming list deadline">
                  <Input
                    type="date"
                    value={roomingListDeadline}
                    onChange={(e) => { edited(); setRoomingListDeadline(e.target.value); }}
                  />
                </Field>
                <Field label="Minimum stay (nights)">
                  <Input
                    inputMode="numeric"
                    value={minimumStay}
                    onChange={(e) => { edited(); setMinimumStay(e.target.value.replace(/[^0-9]/g, "")); }}
                    placeholder="3"
                  />
                </Field>
              </div>

              <FormError message={friendlyError(save.error)} />
              <div className="flex items-center gap-3">
                <Button type="submit" disabled={save.isPending}>
                  {save.isPending ? "Saving…" : "Save terms"}
                </Button>
                {saved && <span className="text-sm font-light text-[#0d8f5d]">Saved.</span>}
              </div>
            </form>

            <section>
              <div className="mb-3 flex items-baseline justify-between gap-3">
                <h3 className="text-ink-900 text-[15px] font-medium">Contracting details</h3>
                <Link href={`/properties/${property.id}/edit`} className="text-brand-700 text-[13px] font-light hover:underline">
                  Edit property
                </Link>
              </div>
              <ContractingDetails property={property} />
            </section>

            <section>
              <h3 className="text-ink-900 mb-3 text-[15px] font-medium">Contacts</h3>
              <ContactList property={property} />
            </section>

            <section>
              <h3 className="text-ink-900 mb-3 text-[15px] font-medium">About the property</h3>
              <PropertyFacts property={property} />
              <Link
                href={`/properties/${property.id}`}
                className="text-brand-700 mt-3 inline-block text-[13px] font-light hover:underline"
              >
                Open the property&apos;s page
              </Link>
            </section>
          </div>
        )}
      </aside>
    </>
  );
}
