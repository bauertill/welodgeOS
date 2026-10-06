"use client";

import { useRouter } from "next/navigation";
import { useMemo, useState } from "react";
import type { PropertyType } from "generated/prisma";

import {
  Button,
  Field,
  Fieldset,
  FormError,
  Input,
  Label,
  Select,
  Textarea,
} from "~/app/_components/form";
import {
  contractingFields,
  propertyDetailFields,
  propertyServiceFields,
} from "~/lib/contracting";
import { LocationPreview } from "~/app/_components/location-preview";
import { normalizePropertyName } from "~/lib/scouting";
import { AddressSearch } from "~/app/_components/address-search";
import { SimilarProperties, useSimilarProperties } from "~/app/_components/similar-properties";
import { api } from "~/trpc/react";

type CategoryDraft = {
  /** Carried through an edit so room slots stay attached to their category. */
  id?: string;
  name: string;
  unitCount: string;
  capacity: string;
  bedConfiguration: string;
  bedrooms: string;
  bathrooms: string;
  priceMin: string;
  priceMax: string;
  currency: string;
  size: string;
  notes: string;
};

type ContactDraft = {
  name: string;
  role: string;
  email: string;
  phone: string;
};

export type PropertyFormValues = {
  id?: string;
  name: string;
  type: PropertyType;
  address: string;
  city: string;
  country: string;
  latitude: string;
  longitude: string;
  stars: string;
  totalRooms: string;
  website: string;
  phone: string;
  notes: string;
  amenityIds: string[];
  categories: CategoryDraft[];
  contacts: ContactDraft[];
  /** The details, services and contracting fields of doc §3.9, by key. */
  details: Partial<Record<DetailKey, string>>;
  yearBuilt: string;
  providerId: string;
};

const detailKeys = [
  ...propertyDetailFields.map((field) => field.key),
  ...propertyServiceFields.map((field) => field.key),
  ...contractingFields.map((field) => field.key),
] as const;
export type DetailKey = (typeof detailKeys)[number];

const emptyCategory = (type: PropertyType): CategoryDraft => ({
  name: type === "APARTMENT" ? "Apartment" : "",
  unitCount: "",
  capacity: "2",
  bedConfiguration: "",
  bedrooms: "",
  bathrooms: "",
  priceMin: "",
  priceMax: "",
  currency: "USD",
  size: "",
  notes: "",
});


export const emptyProperty: PropertyFormValues = {
  name: "",
  type: "HOTEL",
  address: "",
  city: "",
  country: "",
  latitude: "",
  longitude: "",
  stars: "",
  totalRooms: "",
  website: "",
  phone: "",
  notes: "",
  amenityIds: [],
  categories: [emptyCategory("HOTEL")],
  contacts: [],
  details: {},
  yearBuilt: "",
  providerId: "",
};

/** "" → undefined, so an untouched optional field is simply absent. */
const num = (value: string) => {
  const trimmed = value.trim();
  if (!trimmed) return undefined;
  const parsed = Number(trimmed);
  return Number.isFinite(parsed) ? parsed : undefined;
};

const text = (value: string) => value.trim() || undefined;

export function PropertyForm({
  initial,
  amenities,
  existingNames,
  /** When set, the new property is added straight to this event's list. */
  addToEventId,
  /** Where to go after saving, when the form was opened from somewhere else. */
  returnTo,
}: {
  initial: PropertyFormValues;
  amenities: { id: string; label: string }[];
  /** Every property's name, for real-time duplicate detection (doc §3.1). */
  existingNames: { id: string; name: string }[];
  addToEventId?: string;
  returnTo?: string;
}) {
  const router = useRouter();
  const [values, setValues] = useState(initial);
  const [error, setError] = useState<string | null>(null);

  const isEdit = Boolean(initial.id);
  // Hotel rooms carry a free-text bed configuration; apartments and
  // aparthotels are self-contained units, so they carry bedrooms/bathrooms
  // instead. Stars apply to anything but a plain apartment (doc §3.3).
  const hasBedConfiguration = values.type === "HOTEL";
  const showsStars = values.type !== "APARTMENT";

  // A set, not a list scan, so this stays instant with thousands of properties.
  const otherPropertyNames = useMemo(
    () =>
      new Set(
        existingNames
          .filter((property) => property.id !== initial.id)
          .map((property) => normalizePropertyName(property.name)),
      ),
    [existingNames, initial.id],
  );

  const isDuplicateProperty =
    values.name.trim().length > 0 &&
    otherPropertyNames.has(normalizePropertyName(values.name));

  // A new property that looks like one we have, typed another way (doc §3.1).
  const similarFound = useSimilarProperties(values);
  const similar = isEdit ? [] : similarFound;
  const [different, setDifferent] = useState(false);

  const [geocodeError, setGeocodeError] = useState<string | null>(null);
  const geocode = api.property.geocode.useMutation({
    onSuccess: (result) => {
      if (result) {
        setGeocodeError(null);
        set("latitude", String(result.latitude));
        set("longitude", String(result.longitude));
      } else {
        setGeocodeError(
          "Couldn't find coordinates for this address — enter them by hand.",
        );
      }
    },
    onError: () =>
      setGeocodeError(
        "Couldn't look up coordinates right now — enter them by hand.",
      ),
  });

  const addToList = api.scouting.add.useMutation();
  const utils = api.useUtils();

  const onDone = (propertyId: string) => {
    // The Properties tab keeps its own copy of every property on the list; a
    // saved edit must show there straight away, not after the next reload.
    void utils.scouting.invalidate();
    void utils.property.invalidate();
    void utils.provider.invalidate();
    if (addToEventId) {
      addToList.mutate(
        { eventId: addToEventId, propertyId },
        {
          onSuccess: () => {
            router.push(`/events/${addToEventId}`);
            router.refresh();
          },
          onError: (e) => setError(e.message),
        },
      );
      return;
    }
    router.push(returnTo ?? `/properties/${propertyId}`);
    router.refresh();
  };

  const create = api.property.create.useMutation({
    onSuccess: (property) => onDone(property.id),
    onError: (e) => setError(e.message),
  });
  const update = api.property.update.useMutation({
    onSuccess: (property) => onDone(property.id),
    onError: (e) => setError(e.message),
  });

  const saving = create.isPending || update.isPending || addToList.isPending;

  const set = <K extends keyof PropertyFormValues>(
    key: K,
    value: PropertyFormValues[K],
  ) => setValues((current) => ({ ...current, [key]: value }));

  const setCategory = (index: number, patch: Partial<CategoryDraft>) =>
    set(
      "categories",
      values.categories.map((category, i) =>
        i === index ? { ...category, ...patch } : category,
      ),
    );

  const setContact = (index: number, patch: Partial<ContactDraft>) =>
    set(
      "contacts",
      values.contacts.map((contact, i) =>
        i === index ? { ...contact, ...patch } : contact,
      ),
    );

  const submit = (event: React.FormEvent) => {
    event.preventDefault();
    setError(null);

    const categories = values.categories
      .filter((category) => category.name.trim())
      .map((category) => ({
        id: category.id,
        name: category.name.trim(),
        unitCount: num(category.unitCount) ?? 0,
        capacity: num(category.capacity) ?? 2,
        bedConfiguration: hasBedConfiguration
          ? text(category.bedConfiguration)
          : undefined,
        bedrooms: hasBedConfiguration ? undefined : num(category.bedrooms),
        bathrooms: hasBedConfiguration ? undefined : num(category.bathrooms),
        // Prices are typed in whole currency units and stored in minor units.
        indicativePriceMinCents: category.priceMin.trim()
          ? Math.round((num(category.priceMin) ?? 0) * 100)
          : undefined,
        indicativePriceMaxCents: category.priceMax.trim()
          ? Math.round((num(category.priceMax) ?? 0) * 100)
          : undefined,
        currency: category.currency.trim().toUpperCase() || "USD",
        size: category.size.trim(),
        notes: category.notes.trim(),
      }));

    const payload = {
      name: values.name.trim(),
      type: values.type,
      address: text(values.address),
      city: text(values.city),
      country: text(values.country),
      latitude: num(values.latitude),
      longitude: num(values.longitude),
      stars: showsStars ? num(values.stars) : undefined,
      totalRooms: num(values.totalRooms),
      website: text(values.website),
      phone: text(values.phone),
      notes: text(values.notes),
      ...Object.fromEntries(detailKeys.map((key) => [key, text(values.details[key] ?? "")])),
      yearBuilt: num(values.yearBuilt),
      providerId: values.providerId || null,
      amenityIds: values.amenityIds,
      categories,
      contacts: values.contacts
        .filter((contact) => contact.name.trim())
        .map((contact) => ({
          name: contact.name.trim(),
          role: text(contact.role),
          email: text(contact.email),
          phone: text(contact.phone),
        })),
    };

    if (!payload.name) {
      setError("A property needs a name.");
      return;
    }
    if (isDuplicateProperty) {
      setError(
        "Cannot add duplicate property — a property with this name already exists.",
      );
      return;
    }
    if (similar.length && !different) {
      setError("This looks like a property we already have — use that one, or tick that it is a different property.");
      return;
    }
    if ((payload.latitude === undefined) !== (payload.longitude === undefined)) {
      setError(
        "Give both a latitude and a longitude, or neither — one on its own cannot be put on the map.",
      );
      return;
    }

    if (initial.id) update.mutate({ ...payload, id: initial.id });
    else create.mutate({ ...payload, confirmedDifferent: different });
  };

  return (
    <form onSubmit={submit} className="max-w-3xl space-y-5">
      <FormError message={error} />

      <Fieldset
        title="The property"
        description="What it is and where it is. Coordinates are optional — with them, it appears on the map."
      >
        <div className="grid gap-4 sm:grid-cols-2">
          <Field label="Name" className="sm:col-span-2">
            <div className="relative">
              <Input
                value={values.name}
                onChange={(e) => set("name", e.target.value)}
                placeholder="Hotel Carmel"
                required
                invalid={isDuplicateProperty}
                className={isDuplicateProperty ? "pr-9" : undefined}
                aria-invalid={isDuplicateProperty}
                aria-describedby={
                  isDuplicateProperty ? "property-name-error" : undefined
                }
              />
              {isDuplicateProperty && (
                <svg
                  aria-hidden="true"
                  viewBox="0 0 20 20"
                  fill="none"
                  className="pointer-events-none absolute top-1/2 right-3 h-4 w-4 -translate-y-1/2 text-[#db4b68]"
                >
                  <circle cx="10" cy="10" r="8.25" stroke="currentColor" strokeWidth="1.5" />
                  <line x1="10" y1="6" x2="10" y2="11" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" />
                  <circle cx="10" cy="13.5" r="1" fill="currentColor" />
                </svg>
              )}
            </div>
            {isDuplicateProperty && (
              <p id="property-name-error" className="mt-1.5 text-xs text-[#c03654]">
                Cannot add duplicate property — a property with this name
                already exists.
              </p>
            )}
          </Field>

          {!isDuplicateProperty && similar.length > 0 && (
            <div className="sm:col-span-2">
              <SimilarProperties
                matches={similar}
                event={addToEventId ? { id: addToEventId, name: "this event" } : null}
                confirmed={different}
                onConfirmedChange={setDifferent}
                onUsed={() => {
                  router.push(addToEventId ? `/events/${addToEventId}` : "/events");
                  router.refresh();
                }}
              />
            </div>
          )}

          <Field label="Type">
            <Select
              value={values.type}
              onChange={(e) => {
                const type = e.target.value as PropertyType;
                set("type", type);
                // Reset a blank first category so the right fields show up.
                if (
                  values.categories.length === 1 &&
                  !values.categories[0]?.name.trim()
                )
                  set("categories", [emptyCategory(type)]);
              }}
            >
              <option value="HOTEL">Hotel</option>
              <option value="APARTMENT">Apartment</option>
              <option value="APARTHOTEL">Aparthotel</option>
            </Select>
          </Field>

          {showsStars && (
            <Field label="Stars">
              <Select
                value={values.stars}
                onChange={(e) => set("stars", e.target.value)}
              >
                <option value="">Not known</option>
                {[1, 2, 3, 4, 5].map((star) => (
                  <option key={star} value={star}>
                    {star}-star
                  </option>
                ))}
              </Select>
            </Field>
          )}

          {/* Not a Field: a label around it would send a click on a
              suggestion back to the box. */}
          <div className="sm:col-span-2">
            <Label>Address</Label>
            <AddressSearch
              value={values.address}
              onChange={(address) => set("address", address)}
              onFound={(place) => {
                setGeocodeError(null);
                // Where it is comes from Google; the rest only fills what is
                // still empty, so nothing typed is overwritten.
                setValues((current) => ({
                  ...current,
                  address: place.address ?? current.address,
                  city: place.city ?? current.city,
                  country: place.country ?? current.country,
                  latitude: place.latitude !== null ? String(place.latitude) : current.latitude,
                  longitude: place.longitude !== null ? String(place.longitude) : current.longitude,
                  name: !current.name.trim() && place.lodging && place.name ? place.name : current.name,
                  website: current.website.trim() ? current.website : (place.website ?? ""),
                  phone: current.phone.trim() ? current.phone : (place.phone ?? ""),
                }));
              }}
            />
          </div>

          <Field label="City">
            <Input
              value={values.city}
              onChange={(e) => set("city", e.target.value)}
            />
          </Field>

          <Field label="Country">
            <Input
              value={values.country}
              onChange={(e) => set("country", e.target.value)}
            />
          </Field>

          <div className="sm:col-span-2">
            <Button
              type="button"
              variant="secondary"
              disabled={
                geocode.isPending ||
                !(values.address || values.city || values.country)
              }
              onClick={() => {
                setGeocodeError(null);
                geocode.mutate({
                  address: values.address,
                  city: values.city,
                  country: values.country,
                });
              }}
            >
              {geocode.isPending ? "Looking up…" : "Find coordinates from address"}
            </Button>
            {geocodeError && (
              <p className="mt-1.5 text-xs text-[#c03654]">{geocodeError}</p>
            )}
          </div>

          <Field label="Latitude">
            <Input
              value={values.latitude}
              onChange={(e) => set("latitude", e.target.value)}
              inputMode="decimal"
              placeholder="e.g. 34.0259"
            />
          </Field>

          <Field label="Longitude">
            <Input
              value={values.longitude}
              onChange={(e) => set("longitude", e.target.value)}
              inputMode="decimal"
              placeholder="e.g. -118.4790"
            />
          </Field>

          <div className="sm:col-span-2">
            <LocationPreview
              latitude={values.latitude}
              longitude={values.longitude}
              onMove={(latitude, longitude) => setValues((current) => ({ ...current, latitude, longitude }))}
            />
          </div>

          <Field label="Website">
            <Input
              value={values.website}
              onChange={(e) => set("website", e.target.value)}
              placeholder="https://"
            />
          </Field>

          <Field label="Phone">
            <Input
              value={values.phone}
              onChange={(e) => set("phone", e.target.value)}
            />
          </Field>

          <Field label={hasBedConfiguration ? "Total rooms" : "Total units"}>
            <Input
              value={values.totalRooms}
              onChange={(e) => set("totalRooms", e.target.value)}
              inputMode="numeric"
              placeholder="Only if not listed below"
            />
          </Field>
        </div>
      </Fieldset>

      <Fieldset
        title={hasBedConfiguration ? "Room categories" : "Unit types"}
        description={
          hasBedConfiguration
            ? "One row per room type, with how many the hotel has. Rates come from its quotations."
            : "One row per unit type, with its bedrooms and bathrooms."
        }
      >
        <div className="space-y-3">
          {values.categories.map((category, index) => (
            <div
              key={index}
              className="border-ink-200/60 grid gap-3 rounded-lg border p-4 sm:grid-cols-3"
            >
              <Field label="Name">
                <Input
                  value={category.name}
                  onChange={(e) => setCategory(index, { name: e.target.value })}
                  placeholder={hasBedConfiguration ? "King Room" : "2 Bedroom"}
                />
              </Field>

              <Field
                label={hasBedConfiguration ? "Rooms" : "Units"}
                hint={
                  hasBedConfiguration
                    ? "# of rooms of this type at the property"
                    : "# of units of this type at the property"
                }
              >
                <Input
                  value={category.unitCount}
                  onChange={(e) =>
                    setCategory(index, { unitCount: e.target.value })
                  }
                  inputMode="numeric"
                />
              </Field>

              <Field label="Sleeps">
                <Input
                  value={category.capacity}
                  onChange={(e) =>
                    setCategory(index, { capacity: e.target.value })
                  }
                  inputMode="numeric"
                />
              </Field>

              {hasBedConfiguration ? (
                <Field label="Beds">
                  <Input
                    value={category.bedConfiguration}
                    onChange={(e) =>
                      setCategory(index, { bedConfiguration: e.target.value })
                    }
                    placeholder="e.g. 1 King, 2 Twin"
                  />
                </Field>
              ) : (
                <>
                  <Field label="Bedrooms">
                    <Input
                      value={category.bedrooms}
                      onChange={(e) =>
                        setCategory(index, { bedrooms: e.target.value })
                      }
                      inputMode="numeric"
                    />
                  </Field>
                  <Field label="Bathrooms">
                    <Input
                      value={category.bathrooms}
                      onChange={(e) =>
                        setCategory(index, { bathrooms: e.target.value })
                      }
                      inputMode="decimal"
                      placeholder="e.g. 1.5"
                    />
                  </Field>
                </>
              )}

{/* No indicative price any more (doc §3.9): the event rate comes from the quotations. */}

              <Field label="Size">
                <Input
                  value={category.size}
                  onChange={(e) => setCategory(index, { size: e.target.value })}
                  placeholder="28 m²"
                />
              </Field>

              <Field label="Notes" className="sm:col-span-2">
                <Input
                  value={category.notes}
                  onChange={(e) => setCategory(index, { notes: e.target.value })}
                  placeholder="King suite with separate living room"
                />
              </Field>

              <div className="flex items-end sm:col-span-1">
                <Button
                  type="button"
                  variant="ghost"
                  onClick={() =>
                    set(
                      "categories",
                      values.categories.filter((_, i) => i !== index),
                    )
                  }
                >
                  Remove
                </Button>
              </div>
            </div>
          ))}

          {values.categories.length === 0 && (
            <p className="text-ink-500 text-sm font-light">
              No categories yet. Add one, or fill in the total above if you only
              know the headline number.
            </p>
          )}

          <Button
            type="button"
            variant="secondary"
            onClick={() =>
              set("categories", [
                ...values.categories,
                emptyCategory(values.type),
              ])
            }
          >
            Add {hasBedConfiguration ? "category" : "unit type"}
          </Button>
        </div>
      </Fieldset>

      <Fieldset
        title="Amenities"
        description="A fixed list, so these stay searchable rather than becoming free text."
      >
        <div className="grid gap-2 sm:grid-cols-3">
          {amenities.map((amenity) => {
            const checked = values.amenityIds.includes(amenity.id);
            return (
              <label
                key={amenity.id}
                className="flex cursor-pointer items-center gap-2 text-sm font-light"
              >
                <input
                  type="checkbox"
                  checked={checked}
                  onChange={() =>
                    set(
                      "amenityIds",
                      checked
                        ? values.amenityIds.filter((id) => id !== amenity.id)
                        : [...values.amenityIds, amenity.id],
                    )
                  }
                  className="accent-brand-400 h-4 w-4"
                />
                {amenity.label}
              </label>
            );
          })}
        </div>
      </Fieldset>

      <Fieldset
        title="More about the property"
        description="The same on every event. What was agreed for a particular event — rates, deposit, terms — is kept on that event's Properties tab."
      >
        <div className="grid gap-4 sm:grid-cols-2">
          <Field label="Provider" hint="The chain or group it belongs to, if any.">
            <ProviderPicker value={values.providerId} onChange={(id) => set("providerId", id)} />
          </Field>
          <Field label="Year built">
            <Input
              inputMode="numeric"
              value={values.yearBuilt}
              onChange={(e) => set("yearBuilt", e.target.value)}
              placeholder="1998"
            />
          </Field>
          {propertyDetailFields.map((field) => (
            <Field key={field.key} label={field.label}>
              <Input
                value={values.details[field.key] ?? ""}
                onChange={(e) => set("details", { ...values.details, [field.key]: e.target.value })}
                placeholder={field.placeholder}
              />
            </Field>
          ))}
        </div>
      </Fieldset>

      <Fieldset title="Services" description="Short answers, as the hotel gives them.">
        <div className="grid gap-4 sm:grid-cols-2">
          {propertyServiceFields.map((field) => (
            <Field key={field.key} label={field.label}>
              <Input
                value={values.details[field.key] ?? ""}
                onChange={(e) => set("details", { ...values.details, [field.key]: e.target.value })}
                placeholder={field.placeholder}
              />
            </Field>
          ))}
        </div>
      </Fieldset>

      <Fieldset
        title="Contracting details"
        description="The legal entity we sign with. Leave these empty if the property's provider signs for it — its provider's details are used instead. Visible to every colleague."
      >
        <div className="grid gap-4 sm:grid-cols-2">
          {contractingFields.map((field) => (
            <Field key={field.key} label={field.label}>
              <Input
                type={field.key === "contractEmail" ? "email" : "text"}
                value={values.details[field.key] ?? ""}
                onChange={(e) => set("details", { ...values.details, [field.key]: e.target.value })}
              />
            </Field>
          ))}
        </div>
      </Fieldset>

      <Fieldset
        title="Contacts"
        description="Who we speak to at the property."
        action={
          <Button
            type="button"
            variant="secondary"
            onClick={() =>
              set("contacts", [
                ...values.contacts,
                { name: "", role: "", email: "", phone: "" },
              ])
            }
          >
            Add contact
          </Button>
        }
      >
        <div className="space-y-3">
          {values.contacts.map((contact, index) => (
            <div
              key={index}
              className="border-ink-200/60 grid gap-3 rounded-lg border p-4 sm:grid-cols-4"
            >
              <Field label="Name">
                <Input
                  value={contact.name}
                  onChange={(e) => setContact(index, { name: e.target.value })}
                />
              </Field>
              <Field label="Role">
                <Input
                  value={contact.role}
                  onChange={(e) => setContact(index, { role: e.target.value })}
                  placeholder="Revenue manager"
                />
              </Field>
              <Field label="Email">
                <Input
                  type="email"
                  value={contact.email}
                  onChange={(e) => setContact(index, { email: e.target.value })}
                />
              </Field>
              <div className="flex gap-2">
                <Field label="Phone" className="flex-1">
                  <Input
                    value={contact.phone}
                    onChange={(e) =>
                      setContact(index, { phone: e.target.value })
                    }
                  />
                </Field>
                <div className="flex items-end pb-1">
                  <Button
                    type="button"
                    variant="ghost"
                    onClick={() =>
                      set(
                        "contacts",
                        values.contacts.filter((_, i) => i !== index),
                      )
                    }
                  >
                    Remove
                  </Button>
                </div>
              </div>
            </div>
          ))}

          {values.contacts.length === 0 && (
            <p className="text-ink-500 text-sm font-light">No contacts yet.</p>
          )}
        </div>
      </Fieldset>

      <Fieldset title="Notes">
        <Label>Notes</Label>
        <Textarea
          value={values.notes}
          onChange={(e) => set("notes", e.target.value)}
          rows={4}
          placeholder="Anything a colleague would want to know before calling them."
        />
      </Fieldset>

      <div className="border-ink-200/60 sticky bottom-0 -mx-1 flex items-center gap-3 border-t bg-white/95 px-1 py-3 backdrop-blur">
        <Button type="submit" disabled={saving || isDuplicateProperty}>
          {saving
            ? "Saving…"
            : isEdit
              ? "Save changes"
              : addToEventId
                ? "Save and add to list"
                : "Save property"}
        </Button>
        <Button
          type="button"
          variant="ghost"
          onClick={() => router.back()}
          disabled={saving}
        >
          Cancel
        </Button>
      </div>
    </form>
  );
}

/** Choose the property's provider, or add a new one without leaving the form. */
export function ProviderPicker({ value, onChange }: { value: string; onChange: (id: string) => void }) {
  const utils = api.useUtils();
  const providers = api.provider.list.useQuery();
  const [adding, setAdding] = useState(false);
  const [name, setName] = useState("");
  const create = api.provider.create.useMutation({
    onSuccess: (provider) => {
      void utils.provider.list.invalidate();
      onChange(provider.id);
      setAdding(false);
      setName("");
    },
  });

  if (adding) {
    return (
      <div className="space-y-1">
        <div className="flex gap-2">
          <Input value={name} onChange={(e) => setName(e.target.value)} placeholder="Marriott International" autoFocus />
          <Button
            type="button"
            disabled={!name.trim() || create.isPending}
            onClick={() => create.mutate({ name })}
          >
            Add
          </Button>
          <Button type="button" variant="ghost" onClick={() => setAdding(false)}>
            Cancel
          </Button>
        </div>
        {create.error && <p className="text-xs text-[#c03654]">{create.error.message}</p>}
      </div>
    );
  }
  return (
    <Select
      value={value}
      onChange={(e) => (e.target.value === "__new__" ? setAdding(true) : onChange(e.target.value))}
    >
      <option value="">None — independent</option>
      {(providers.data ?? []).map((provider) => (
        <option key={provider.id} value={provider.id}>
          {provider.name}
        </option>
      ))}
      <option value="__new__">+ Add a new provider…</option>
    </Select>
  );
}
