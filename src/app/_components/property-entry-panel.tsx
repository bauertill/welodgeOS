"use client";

import type { Cleaning, RateInclusion } from "generated/prisma";
import { useEffect, useState } from "react";

import { Button, Field, FormError, friendlyError, Input, Select, Textarea } from "~/app/_components/form";
import { PendingLink } from "~/app/_components/pending-link";
import { formatDuration, formatKm, TravelTimes } from "~/app/_components/travel-times";
import { ContactList, ContractingDetails, PropertyFacts } from "~/app/_components/property-details";
import { termTextFields } from "~/lib/contracting";
import { dayKey, parseDay } from "~/lib/dates";
import { describeRateIncludes, propertyTypeLabels } from "~/lib/scouting";
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
    extraCosts: "",
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

              {(() => {
                const drafts = draftFromCategories(entry.data);
                if (!drafts.applicablePeriod && !drafts.ratesInclude) return null;
                return (
                  <div className="flex items-center gap-2">
                    <Button
                      type="button"
                      variant="secondary"
                      className="px-4 py-1.5"
                      onClick={() => {
                        const overwriting = (["applicablePeriod", "ratesInclude"] as const).filter(
                          (key) => drafts[key] && terms[key].trim() && terms[key].trim() !== drafts[key],
                        );
                        if (
                          overwriting.length > 0 &&
                          !window.confirm("Replace what is already written in Applicable period and Rates include?")
                        ) {
                          return;
                        }
                        edited();
                        setTerms({
                          ...terms,
                          applicablePeriod: drafts.applicablePeriod || terms.applicablePeriod,
                          ratesInclude: drafts.ratesInclude || terms.ratesInclude,
                        });
                      }}
                    >
                      Fill from room categories
                    </Button>
                    <span className="text-ink-500 text-xs font-light">
                      Drafts the two boxes below from the room categories&apos; periods and what their rates include — edit from there.
                    </span>
                  </div>
                );
              })()}

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
                <PendingLink
                  href={`/properties/${property.id}/edit?back=${encodeURIComponent(`/events/${entry.data.eventId}`)}`}
                  className="text-brand-700 text-[13px] font-light hover:underline"
                >
                  Edit property
                </PendingLink>
              </div>
              <ContractingDetails property={property} />
            </section>

            <section>
              <h3 className="text-ink-900 mb-3 text-[15px] font-medium">Contacts</h3>
              <ContactList property={property} />
            </section>

            <section>
              <h3 className="text-ink-900 mb-3 text-[15px] font-medium">Getting around</h3>
              <GettingAround propertyId={property.id} eventId={entry.data.eventId} />
            </section>

            <section>
              <h3 className="text-ink-900 mb-3 text-[15px] font-medium">About the property</h3>
              <PropertyFacts property={property} backTo={`/events/${entry.data.eventId}`} />
              <PendingLink
                href={`/properties/${property.id}`}
                className="text-brand-700 mt-3 inline-block text-[13px] font-light hover:underline"
              >
                Open the property&apos;s page
              </PendingLink>
            </section>
          </div>
        )}
      </aside>
    </>
  );
}

/**
 * A first draft of the property's contracting text from its room categories
 * (doc §3.9): one line per category, or a single line when every category
 * says the same thing. Only ever a draft — the rep edits and saves it.
 */
function draftFromCategories(data: {
  categoryContracts: {
    categoryId: string;
    applicablePeriod: string | null;
    rateIncludes: RateInclusion[];
    rateIncludesOther: string | null;
    cleaning: Cleaning | null;
    cleaningOther: string | null;
  }[];
  property: { categories: { id: string; name: string }[] };
}) {
  const draft = (pick: (contract: (typeof data.categoryContracts)[number]) => string | null) => {
    const lines = data.property.categories
      .map((category) => {
        const contract = data.categoryContracts.find((c) => c.categoryId === category.id);
        const value = contract ? pick(contract)?.trim() : null;
        return value ? { name: category.name, value } : null;
      })
      .filter((line): line is { name: string; value: string } => line !== null);
    if (lines.length === 0) return "";
    const same = lines.every((line) => line.value === lines[0]!.value);
    // The same wording for every category that has one is said once.
    if (same && lines.length === data.property.categories.length) return lines[0]!.value;
    return lines.map((line) => `${line.name}: ${line.value}`).join("\n");
  };
  return {
    applicablePeriod: draft((contract) => contract.applicablePeriod),
    ratesInclude: draft((contract) => describeRateIncludes(contract.rateIncludes, contract.rateIncludesOther, contract.cleaning, contract.cleaningOther)),
  };
}

/**
 * Travel times to the event's places of interest — the IBC, the stadium —
 * and the nearest dining and convenience store, all by Google, when the panel
 * opens, and none of it stored (doc §3.8, §3.9).
 */
function GettingAround({ propertyId, eventId }: { propertyId: string; eventId: string }) {
  const places = api.place.listForEvent.useQuery({ eventId });
  const nearby = api.travel.nearby.useQuery({ propertyId }, { staleTime: 0 });

  const drive = (place: { name: string; car: { seconds: number; metres: number } | null }) => (
    <li key={place.name} className="flex items-baseline justify-between gap-3 text-[13px] font-light">
      <span className="text-ink-900 min-w-0 truncate">{place.name}</span>
      <span className="text-ink-500 shrink-0">
        {place.car ? `${formatDuration(place.car.seconds)} by car · ${formatKm(place.car.metres)}` : "drive not available"}
      </span>
    </li>
  );

  return (
    <div className="space-y-5">
      {places.data && (
        <TravelTimes
          propertyId={propertyId}
          eventId={eventId}
          places={places.data.map((place) => ({
            id: place.id,
            name: place.name,
            category: place.category,
            lines: place.lines,
            latitude: place.latitude,
            longitude: place.longitude,
          }))}
        />
      )}

      <div>
        <h4 className="text-ink-500 mb-2 text-[11px] font-medium tracking-wider uppercase">Nearby</h4>
        {nearby.isPending ? (
          <p className="text-ink-500 text-xs font-light">Asking Google…</p>
        ) : nearby.isError || !nearby.data ? (
          <p className="text-ink-500 text-xs font-light">Nearby places are not available right now.</p>
        ) : nearby.data.status === "no-location" ? (
          <p className="text-ink-500 text-xs font-light">
            Add the property&apos;s coordinates and the nearest dining and convenience store appear here.
          </p>
        ) : nearby.data.status === "no-key" ? (
          <p className="text-ink-500 text-xs font-light">
            Google is not set up here, so nearby places cannot be looked up.
          </p>
        ) : nearby.data.status !== "ok" ? (
          <p className="text-ink-500 text-xs font-light">
            Google would not look up nearby places — the Places service may need switching on for our Google key.
          </p>
        ) : (
          <div className="space-y-3">
            <div>
              <p className="text-ink-700 mb-1 text-xs font-medium">Dining options</p>
              {nearby.data.dining.length ? (
                <ul className="space-y-1">{nearby.data.dining.map(drive)}</ul>
              ) : (
                <p className="text-ink-500 text-xs font-light">None within 5 km.</p>
              )}
            </div>
            <div>
              <p className="text-ink-700 mb-1 text-xs font-medium">Closest convenience store</p>
              {nearby.data.convenienceStore ? (
                <ul>{drive(nearby.data.convenienceStore)}</ul>
              ) : (
                <p className="text-ink-500 text-xs font-light">None within 5 km.</p>
              )}
            </div>
            <p className="text-ink-500 text-[10px] font-light">Found by Google, closest first. Car times ignore live traffic.</p>
          </div>
        )}
      </div>
    </div>
  );
}
