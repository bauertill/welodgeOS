"use client";

import type { PropertyType } from "generated/prisma";
import { useRouter } from "next/navigation";
import { createContext, useContext, useState } from "react";

import { Button, Field, FormError, friendlyError, Input, Select } from "~/app/_components/form";
import { LocationPreview } from "~/app/_components/location-preview";
import { ContactList, ContractingDetails, PropertyFacts } from "~/app/_components/property-details";
import { ProviderPicker } from "~/app/_components/property-form";
import { Card, Pill, Table, Td, Th } from "~/app/_components/ui";
import {
  contractingFields,
  propertyDetailFields,
  propertyServiceFields,
  type Contracting,
} from "~/lib/contracting";
import { formatMoneyRange } from "~/lib/format";
import { api } from "~/trpc/react";

/**
 * The cards of a property's page, each editable where it stands (doc §3.9):
 * an Edit button in the corner turns the card into its own small form, which
 * saves only what that card shows. The full Edit page still does everything
 * at once.
 */

type Contact = { id: string; name: string; role: string | null; email: string | null; phone: string | null };
type Category = {
  id: string;
  name: string;
  unitCount: number;
  capacity: number;
  bedConfiguration: string | null;
  bedrooms: number | null;
  bathrooms: number | null;
  indicativePriceMinCents: number | null;
  indicativePriceMaxCents: number | null;
  currency: string;
  size: string | null;
  notes: string | null;
};
export type PropertyForCards = Contracting &
  Record<(typeof propertyDetailFields)[number]["key"] | (typeof propertyServiceFields)[number]["key"], string | null> & {
    id: string;
    type: PropertyType;
    address: string | null;
    city: string | null;
    country: string | null;
    latitude: number | null;
    longitude: number | null;
    phone: string | null;
    website: string | null;
    totalRooms: number | null;
    yearBuilt: number | null;
    providerId: string | null;
    provider: (Contracting & { id: string; name: string; contacts: Contact[] }) | null;
    contacts: Contact[];
    amenities: { id: string; label: string }[];
    categories: Category[];
  };

/**
 * Inside the Details panel the cards are its sections rather than cards of
 * their own: divided by a line, and each folding open and shut, so a long
 * list of facts does not push everything else down the page.
 */
const InPanel = createContext(false);

/** The property's facts as one panel of folding sections, not a stack of cards. */
export function DetailsPanel({ children }: { children: React.ReactNode }) {
  return (
    // Empty facts are left out here — the section's summary says how many are
    // filled, and Edit shows every field.
    <div className="border-ink-200/60 divide-ink-200/60 divide-y rounded-xl border bg-white px-5 [&_[data-empty]]:hidden [&_dt]:w-24">
      <InPanel.Provider value={true}>{children}</InPanel.Provider>
    </div>
  );
}

/** One folding section of the Details panel. */
export function PanelSection({
  title,
  summary,
  defaultOpen = false,
  action,
  children,
}: {
  title: string;
  /** Said beside the title while the section is shut. */
  summary?: string | null;
  defaultOpen?: boolean;
  action?: React.ReactNode;
  children: React.ReactNode;
}) {
  const [open, setOpen] = useState(defaultOpen);
  return (
    <section className="py-4">
      <div className="flex items-center justify-between gap-3">
        <button
          type="button"
          onClick={() => setOpen(!open)}
          aria-expanded={open}
          className="group flex min-w-0 flex-1 items-center gap-2 text-left"
        >
          <svg
            viewBox="0 0 16 16"
            fill="none"
            className={`text-ink-400 group-hover:text-ink-700 h-3.5 w-3.5 shrink-0 transition-transform ${open ? "rotate-90" : ""}`}
            aria-hidden
          >
            <path d="M6 4l4 4-4 4" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round" />
          </svg>
          <h2 className="text-ink-900 text-[14px] font-medium">{title}</h2>
          {!open && summary && <span className="text-ink-500 truncate text-xs font-light">{summary}</span>}
        </button>
        {open && action}
      </div>
      {open && <div className="mt-3 pl-5.5">{children}</div>}
    </section>
  );
}

/** A card with an Edit button in its corner, and the form it opens. */
function EditableCard({
  title,
  children,
  editor,
  summary,
  defaultOpen,
}: {
  title: string;
  children: React.ReactNode;
  editor: (done: () => void) => React.ReactNode;
  /** In the Details panel: what the section holds, said while it is shut. */
  summary?: string | null;
  defaultOpen?: boolean;
}) {
  const [editing, setEditing] = useState(false);
  const inPanel = useContext(InPanel);
  if (inPanel) {
    return (
      <PanelSection
        title={title}
        summary={summary}
        defaultOpen={defaultOpen}
        action={
          !editing && (
            <button type="button" onClick={() => setEditing(true)} className="text-brand-700 text-[13px] font-light hover:underline">
              Edit
            </button>
          )
        }
      >
        {editing ? editor(() => setEditing(false)) : children}
      </PanelSection>
    );
  }
  return (
    <Card>
      <div className="mb-3 flex items-baseline justify-between gap-3">
        <h2 className="text-ink-900 text-[15px] font-medium">{title}</h2>
        {!editing && (
          <button
            type="button"
            onClick={() => setEditing(true)}
            className="text-brand-700 text-[13px] font-light hover:underline"
          >
            Edit
          </button>
        )}
      </div>
      {editing ? editor(() => setEditing(false)) : children}
    </Card>
  );
}

function useSaved() {
  const router = useRouter();
  const utils = api.useUtils();
  return () => {
    void utils.scouting.invalidate();
    void utils.property.invalidate();
    router.refresh();
  };
}

function SaveRow({ pending, onCancel, error }: { pending: boolean; onCancel: () => void; error?: string | null }) {
  return (
    <div className="mt-4 space-y-2">
      <FormError message={error} />
      <div className="flex gap-2">
        <Button type="submit" disabled={pending}>
          {pending ? "Saving…" : "Save"}
        </Button>
        <Button type="button" variant="ghost" onClick={onCancel}>
          Cancel
        </Button>
      </div>
    </div>
  );
}

type FieldSpec = { key: string; label: string; placeholder?: string; kind?: "text" | "number" | "email" };

/** A card of plain fields: shows them as text, edits them as boxes. */
function FieldsEditor({
  propertyId,
  fields,
  values,
  onDone,
  extra,
  after,
  extraValues,
}: {
  propertyId: string;
  fields: FieldSpec[];
  /** The property; only the fields' keys are read from it. */
  values: object;
  onDone: () => void;
  /** Anything that is not a plain box (the provider picker). */
  extra?: (set: (key: string, value: string) => void, draft: Record<string, string>) => React.ReactNode;
  /** Anything to show after the boxes (the map for coordinates). */
  after?: (set: (key: string, value: string) => void, draft: Record<string, string>) => React.ReactNode;
  extraValues?: Record<string, string | null>;
}) {
  const saved = useSaved();
  const [draft, setDraft] = useState<Record<string, string>>(() => ({
    ...Object.fromEntries(
      fields.map((field) => {
        const value = (values as Record<string, unknown>)[field.key];
        return [field.key, value === null || value === undefined ? "" : String(value)];
      }),
    ),
    ...Object.fromEntries(Object.entries(extraValues ?? {}).map(([key, value]) => [key, value ?? ""])),
  }));
  const [problem, setProblem] = useState<string | null>(null);
  const patch = api.property.patch.useMutation({
    onSuccess: () => {
      saved();
      onDone();
    },
  });
  const set = (key: string, value: string) => setDraft((current) => ({ ...current, [key]: value }));

  return (
    <form
      onSubmit={(e) => {
        e.preventDefault();
        setProblem(null);
        const payload: Record<string, unknown> = { id: propertyId };
        for (const field of fields) {
          const value = draft[field.key]!.trim();
          if (field.kind === "number") {
            if (!value) payload[field.key] = null;
            else if (!Number.isFinite(Number(value))) {
              setProblem(`${field.label} should be a number.`);
              return;
            } else payload[field.key] = Number(value);
          } else payload[field.key] = value;
        }
        for (const key of Object.keys(extraValues ?? {})) payload[key] = draft[key] || null;
        patch.mutate(payload as Parameters<typeof patch.mutate>[0]);
      }}
    >
      <div className="grid gap-3 sm:grid-cols-2">
        {extra?.(set, draft)}
        {fields.map((field) => (
          <Field key={field.key} label={field.label}>
            <Input
              type={field.kind === "email" ? "email" : "text"}
              inputMode={field.kind === "number" ? "decimal" : undefined}
              value={draft[field.key]}
              onChange={(e) => set(field.key, e.target.value)}
              placeholder={field.placeholder}
            />
          </Field>
        ))}
      </div>
      {after && <div className="mt-3">{after(set, draft)}</div>}
      <SaveRow pending={patch.isPending} onCancel={onDone} error={problem ?? friendlyError(patch.error)} />
    </form>
  );
}

/** "6 of 14 filled", or nothing when none are. */
function filledOf(property: object, keys: string[]) {
  const values = property as Record<string, unknown>;
  const filled = keys.filter((key) => values[key] !== null && values[key] !== undefined && values[key] !== "").length;
  return filled ? `${filled} of ${keys.length} filled` : null;
}

function Row({ label, value }: { label: string; value?: string | null }) {
  return (
    <div className="flex gap-3" data-empty={value == null || value === "" ? "" : undefined}>
      <dt className="text-ink-500 w-28 shrink-0">{label}</dt>
      <dd className="text-ink-900 min-w-0 break-words">{value ?? "—"}</dd>
    </div>
  );
}

// --- The cards -----------------------------------------------------------------

export function WhereItIsCard({ property, totalLabel }: { property: PropertyForCards; totalLabel: string | null }) {
  return (
    <EditableCard
      title="Where it is"
      defaultOpen
      summary={[property.area, property.city].filter(Boolean).join(", ") || null}
      editor={(done) => (
        <FieldsEditor
          propertyId={property.id}
          values={property}
          onDone={done}
          fields={[
            { key: "address", label: "Address" },
            { key: "area", label: "Area", placeholder: "Santa Monica" },
            { key: "city", label: "City" },
            { key: "country", label: "Country" },
            { key: "latitude", label: "Latitude", kind: "number", placeholder: "34.0219" },
            { key: "longitude", label: "Longitude", kind: "number", placeholder: "-118.3965" },
            { key: "phone", label: "Phone" },
            { key: "website", label: "Website", placeholder: "https://…" },
          ]}
          after={(set, draft) => (
            <LocationPreview
              latitude={draft.latitude ?? ""}
              longitude={draft.longitude ?? ""}
              onMove={(latitude, longitude) => {
                set("latitude", latitude);
                set("longitude", longitude);
              }}
            />
          )}
        />
      )}
    >
      <dl className="space-y-2 text-sm font-light">
        <Row label="Address" value={property.address} />
        <Row label="Area" value={property.area} />
        <Row label="City" value={[property.city, property.country].filter(Boolean).join(", ") || null} />
        <Row
          label="Coordinates"
          value={
            property.latitude !== null && property.longitude !== null
              ? `${property.latitude.toFixed(5)}, ${property.longitude.toFixed(5)}`
              : null
          }
        />
        <Row label="Total" value={totalLabel} />
        <Row label="Phone" value={property.phone} />
        <Row label="Website" value={property.website} />
      </dl>
    </EditableCard>
  );
}

export function MoreAboutCard({ property, backTo }: { property: PropertyForCards; backTo?: string }) {
  return (
    <EditableCard
      title="More about the property"
      summary={filledOf(property, [
        "providerId",
        "yearBuilt",
        ...propertyDetailFields.map((field) => field.key),
        ...propertyServiceFields.map((field) => field.key),
      ])}
      editor={(done) => (
        <FieldsEditor
          propertyId={property.id}
          values={property}
          onDone={done}
          extraValues={{ providerId: property.providerId }}
          extra={(set, draft) => (
            <Field label="Provider" className="sm:col-span-2">
              <ProviderPicker value={draft.providerId ?? ""} onChange={(id) => set("providerId", id)} />
            </Field>
          )}
          fields={[
            { key: "yearBuilt", label: "Year built", kind: "number", placeholder: "1998" },
            ...propertyDetailFields.filter((field) => field.key !== "area"),
            ...propertyServiceFields,
          ]}
        />
      )}
    >
      <PropertyFacts property={property} backTo={backTo} />
    </EditableCard>
  );
}

export function ContractingCard({ property }: { property: PropertyForCards }) {
  return (
    <EditableCard
      title="Contracting details"
      summary={filledOf(property, contractingFields.map((field) => field.key)) ?? (property.provider ? `from ${property.provider.name}` : "none recorded")}
      editor={(done) => (
        <>
          <p className="text-ink-500 mb-3 text-xs font-light">
            The property&apos;s own. Leave them empty if its provider signs for it — the provider&apos;s are used instead.
          </p>
          <FieldsEditor
            propertyId={property.id}
            values={property}
            onDone={done}
            fields={contractingFields.map((field) => ({
              key: field.key,
              label: field.label,
              kind: field.key === "contractEmail" ? ("email" as const) : ("text" as const),
            }))}
          />
        </>
      )}
    >
      <ContractingDetails property={property} />
    </EditableCard>
  );
}

export function AmenitiesCard({
  property,
  amenities,
}: {
  property: PropertyForCards;
  amenities: { id: string; label: string }[];
}) {
  return (
    <EditableCard
      title="Amenities"
      defaultOpen
      summary={property.amenities.length ? `${property.amenities.length}` : "none"}
      editor={(done) => <AmenitiesEditor property={property} amenities={amenities} onDone={done} />}
    >
      {property.amenities.length === 0 ? (
        <p className="text-ink-500 text-sm font-light">None recorded.</p>
      ) : (
        <div className="flex flex-wrap gap-1.5">
          {property.amenities.map((amenity) => (
            <Pill key={amenity.id}>{amenity.label}</Pill>
          ))}
        </div>
      )}
    </EditableCard>
  );
}

function AmenitiesEditor({
  property,
  amenities,
  onDone,
}: {
  property: PropertyForCards;
  amenities: { id: string; label: string }[];
  onDone: () => void;
}) {
  const saved = useSaved();
  const [chosen, setChosen] = useState(new Set(property.amenities.map((amenity) => amenity.id)));
  const save = api.property.setAmenities.useMutation({
    onSuccess: () => {
      saved();
      onDone();
    },
  });
  return (
    <form
      onSubmit={(e) => {
        e.preventDefault();
        save.mutate({ id: property.id, amenityIds: [...chosen] });
      }}
    >
      <div className="grid gap-2 sm:grid-cols-2">
        {amenities.map((amenity) => (
          <label key={amenity.id} className="flex items-center gap-2 text-sm font-light">
            <input
              type="checkbox"
              className="accent-brand-400 h-4 w-4"
              checked={chosen.has(amenity.id)}
              onChange={() =>
                setChosen((current) => {
                  const next = new Set(current);
                  if (next.has(amenity.id)) next.delete(amenity.id);
                  else next.add(amenity.id);
                  return next;
                })
              }
            />
            {amenity.label}
          </label>
        ))}
      </div>
      <SaveRow pending={save.isPending} onCancel={onDone} error={friendlyError(save.error)} />
    </form>
  );
}

export function ContactsCard({ property }: { property: PropertyForCards }) {
  return (
    <EditableCard
      title="Contacts"
      defaultOpen
      summary={property.contacts.length ? `${property.contacts.length}` : "none"}
      editor={(done) => <ContactsEditor property={property} onDone={done} />}>
      <ContactList property={property} />
    </EditableCard>
  );
}

function ContactsEditor({ property, onDone }: { property: PropertyForCards; onDone: () => void }) {
  const saved = useSaved();
  const [contacts, setContacts] = useState(
    property.contacts.map((contact) => ({
      name: contact.name,
      role: contact.role ?? "",
      email: contact.email ?? "",
      phone: contact.phone ?? "",
    })),
  );
  const save = api.property.setContacts.useMutation({
    onSuccess: () => {
      saved();
      onDone();
    },
  });
  const change = (index: number, patch: Partial<(typeof contacts)[number]>) =>
    setContacts((list) => list.map((contact, i) => (i === index ? { ...contact, ...patch } : contact)));
  return (
    <form
      onSubmit={(e) => {
        e.preventDefault();
        save.mutate({ id: property.id, contacts });
      }}
    >
      <div className="space-y-3">
        {contacts.map((contact, index) => (
          <div key={index} className="border-ink-200/60 grid gap-2 rounded-lg border p-3">
            <Input value={contact.name} onChange={(e) => change(index, { name: e.target.value })} placeholder="Name" aria-label="Name" />
            <Input value={contact.role} onChange={(e) => change(index, { role: e.target.value })} placeholder="Role" aria-label="Role" />
            <Input type="email" value={contact.email} onChange={(e) => change(index, { email: e.target.value })} placeholder="Email" aria-label="Email" />
            <div className="flex gap-2">
              <Input value={contact.phone} onChange={(e) => change(index, { phone: e.target.value })} placeholder="Phone" aria-label="Phone" />
              <Button type="button" variant="ghost" onClick={() => setContacts(contacts.filter((_, i) => i !== index))}>
                Remove
              </Button>
            </div>
          </div>
        ))}
        <Button
          type="button"
          variant="secondary"
          onClick={() => setContacts([...contacts, { name: "", role: "", email: "", phone: "" }])}
        >
          + Add contact
        </Button>
        {property.provider && property.provider.contacts.length > 0 && (
          <p className="text-ink-500 text-xs font-light">
            {property.provider.name}&apos;s own contacts are edited on its provider page.
          </p>
        )}
      </div>
      <SaveRow pending={save.isPending} onCancel={onDone} error={friendlyError(save.error)} />
    </form>
  );
}

// --- Room categories ---------------------------------------------------------------

const CURRENCIES = ["USD", "EUR", "CHF", "GBP"];

export function RoomCategoriesCard({ property, bare = false }: { property: PropertyForCards; /** In a tab: no card, no title. */ bare?: boolean }) {
  const hotel = property.type === "HOTEL";
  const [editing, setEditing] = useState<string | "new" | null>(null);
  const Frame = bare ? "div" : Card;
  return (
    <Frame>
      <div className={`mb-3 flex items-baseline gap-3 ${bare ? "justify-end" : "justify-between"}`}>
        {!bare && <h2 className="text-ink-900 text-[15px] font-medium">{hotel ? "Room categories" : "Unit types"}</h2>}
        {editing === null && (
          <button type="button" onClick={() => setEditing("new")} className="text-brand-700 text-[13px] font-light hover:underline">
            + Add {hotel ? "room category" : "unit type"}
          </button>
        )}
      </div>

      {property.categories.length === 0 && editing !== "new" ? (
        <p className="text-ink-500 text-sm font-light">
          No categories recorded.{property.totalRooms ? ` The property has ${property.totalRooms} in total.` : ""}
        </p>
      ) : (
        <Table>
          <thead>
            <tr>
              <Th>Category</Th>
              <Th>{hotel ? "Rooms" : "Units"}</Th>
              <Th>Sleeps</Th>
              <Th>{hotel ? "Beds" : "Bed / bath"}</Th>
              <Th>Size</Th>
              <Th>Indicative price</Th>
              <Th>{""}</Th>
            </tr>
          </thead>
          <tbody>
            {property.categories.map((category) =>
              editing === category.id ? (
                <CategoryEditor key={category.id} property={property} category={category} onDone={() => setEditing(null)} />
              ) : (
                <tr key={category.id}>
                  <Td>
                    <span className="font-medium">{category.name}</span>
                    {category.notes && <span className="text-ink-500 block text-xs font-light">{category.notes}</span>}
                  </Td>
                  <Td>{category.unitCount || "—"}</Td>
                  <Td>{category.capacity}</Td>
                  <Td>
                    {hotel
                      ? (category.bedConfiguration ?? "—")
                      : [
                          category.bedrooms !== null ? `${category.bedrooms} bed` : null,
                          category.bathrooms !== null ? `${category.bathrooms} bath` : null,
                        ]
                          .filter(Boolean)
                          .join(" · ") || "—"}
                  </Td>
                  <Td>{category.size ?? "—"}</Td>
                  <Td>
                    {formatMoneyRange(category.indicativePriceMinCents, category.indicativePriceMaxCents, category.currency)}
                    {(category.indicativePriceMinCents !== null || category.indicativePriceMaxCents !== null) && (
                      <span className="text-ink-500 block text-xs font-light">Indicative</span>
                    )}
                  </Td>
                  <Td>
                    {editing === null && (
                      <button
                        type="button"
                        onClick={() => setEditing(category.id)}
                        className="text-brand-700 text-xs font-light hover:underline"
                      >
                        Edit
                      </button>
                    )}
                  </Td>
                </tr>
              ),
            )}
            {editing === "new" && <CategoryEditor property={property} onDone={() => setEditing(null)} />}
          </tbody>
        </Table>
      )}
    </Frame>
  );
}

/** One room category, added or changed in place, as a full-width row. */
function CategoryEditor({
  property,
  category,
  onDone,
}: {
  property: PropertyForCards;
  category?: Category;
  onDone: () => void;
}) {
  const saved = useSaved();
  const hotel = property.type === "HOTEL";
  const text = (value: number | null | undefined, scale = 1) =>
    value === null || value === undefined ? "" : String(value / scale);
  const [draft, setDraft] = useState({
    name: category?.name ?? "",
    unitCount: text(category?.unitCount),
    capacity: text(category?.capacity ?? 2),
    bedConfiguration: category?.bedConfiguration ?? "",
    bedrooms: text(category?.bedrooms),
    bathrooms: text(category?.bathrooms),
    priceMin: text(category?.indicativePriceMinCents, 100),
    priceMax: text(category?.indicativePriceMaxCents, 100),
    currency: category?.currency ?? "USD",
    size: category?.size ?? "",
    notes: category?.notes ?? "",
  });
  const [problem, setProblem] = useState<string | null>(null);
  const set = (key: keyof typeof draft, value: string) => setDraft((current) => ({ ...current, [key]: value }));
  const done = { onSuccess: () => { saved(); onDone(); } };
  const save = api.property.saveCategory.useMutation(done);
  const remove = api.property.removeCategory.useMutation(done);

  const num = (value: string) => (value.trim() ? Number(value.replace(",", ".")) : undefined);
  const submit = () => {
    setProblem(null);
    if (!draft.name.trim()) {
      setProblem("Give the category a name.");
      return;
    }
    const numbers = [draft.unitCount, draft.capacity, draft.bedrooms, draft.bathrooms, draft.priceMin, draft.priceMax];
    if (numbers.some((value) => value.trim() && !Number.isFinite(Number(value.replace(",", "."))))) {
      setProblem("Rooms, sleeps, bedrooms, bathrooms and prices should be numbers.");
      return;
    }
    save.mutate({
      propertyId: property.id,
      category: {
        id: category?.id,
        name: draft.name,
        unitCount: Math.round(num(draft.unitCount) ?? 0),
        capacity: Math.max(1, Math.round(num(draft.capacity) ?? 2)),
        bedConfiguration: hotel ? draft.bedConfiguration.trim() || undefined : undefined,
        bedrooms: hotel ? undefined : num(draft.bedrooms),
        bathrooms: hotel ? undefined : num(draft.bathrooms),
        // Typed in whole currency units, stored in minor units (§4.5).
        indicativePriceMinCents: draft.priceMin.trim() ? Math.round((num(draft.priceMin) ?? 0) * 100) : undefined,
        indicativePriceMaxCents: draft.priceMax.trim() ? Math.round((num(draft.priceMax) ?? 0) * 100) : undefined,
        currency: draft.currency,
        size: draft.size,
        notes: draft.notes,
      },
    });
  };

  return (
    <tr>
      <td colSpan={7} className="bg-brand-50/40 border-ink-200/40 border-b p-4">
        <div className="grid gap-3 sm:grid-cols-4">
          <Field label="Name" className="sm:col-span-2">
            <Input value={draft.name} onChange={(e) => set("name", e.target.value)} placeholder="King Room" autoFocus />
          </Field>
          <Field label={hotel ? "Rooms" : "Units"}>
            <Input inputMode="numeric" value={draft.unitCount} onChange={(e) => set("unitCount", e.target.value)} placeholder="30" />
          </Field>
          <Field label="Sleeps">
            <Input inputMode="numeric" value={draft.capacity} onChange={(e) => set("capacity", e.target.value)} />
          </Field>
          {hotel ? (
            <Field label="Bed configuration" className="sm:col-span-2">
              <Input value={draft.bedConfiguration} onChange={(e) => set("bedConfiguration", e.target.value)} placeholder="1 King" />
            </Field>
          ) : (
            <>
              <Field label="Bedrooms">
                <Input inputMode="numeric" value={draft.bedrooms} onChange={(e) => set("bedrooms", e.target.value)} />
              </Field>
              <Field label="Bathrooms">
                <Input inputMode="decimal" value={draft.bathrooms} onChange={(e) => set("bathrooms", e.target.value)} placeholder="1.5" />
              </Field>
            </>
          )}
          <Field label="Size">
            <Input value={draft.size} onChange={(e) => set("size", e.target.value)} placeholder="28 m²" />
          </Field>
          <Field label="Currency">
            <Select value={draft.currency} onChange={(e) => set("currency", e.target.value)}>
              {(CURRENCIES.includes(draft.currency) ? CURRENCIES : [draft.currency, ...CURRENCIES]).map((currency) => (
                <option key={currency}>{currency}</option>
              ))}
            </Select>
          </Field>
          <Field label="Indicative price, from">
            <Input inputMode="decimal" value={draft.priceMin} onChange={(e) => set("priceMin", e.target.value)} placeholder="220" />
          </Field>
          <Field label="Indicative price, to">
            <Input inputMode="decimal" value={draft.priceMax} onChange={(e) => set("priceMax", e.target.value)} placeholder="280" />
          </Field>
          <Field label="Notes" className="sm:col-span-4">
            <Input value={draft.notes} onChange={(e) => set("notes", e.target.value)} placeholder="King suite with separate living room" />
          </Field>
        </div>
        <div className="mt-3 flex flex-wrap items-center gap-2">
          <Button type="button" disabled={save.isPending} onClick={submit}>
            {save.isPending ? "Saving…" : category ? "Save" : "Add"}
          </Button>
          <Button type="button" variant="ghost" onClick={onDone}>
            Cancel
          </Button>
          {category && (
            <Button
              type="button"
              variant="danger"
              className="ml-auto"
              disabled={remove.isPending}
              onClick={() => {
                if (window.confirm(`Remove "${category.name}" from this property?`)) remove.mutate({ id: category.id });
              }}
            >
              Remove
            </Button>
          )}
        </div>
        <FormError message={problem ?? friendlyError(save.error) ?? friendlyError(remove.error)} />
      </td>
    </tr>
  );
}
