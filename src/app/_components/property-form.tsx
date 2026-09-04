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
import { normalizePropertyName } from "~/lib/scouting";
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
  price: string;
  currency: string;
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
};

const emptyCategory = (type: PropertyType): CategoryDraft => ({
  name: type === "HOTEL" ? "" : "Apartment",
  unitCount: "",
  capacity: "2",
  bedConfiguration: "",
  bedrooms: "",
  bathrooms: "",
  price: "",
  currency: "CHF",
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
}: {
  initial: PropertyFormValues;
  amenities: { id: string; label: string }[];
  /** Every property's name, for real-time duplicate detection (doc §3.1). */
  existingNames: { id: string; name: string }[];
  addToEventId?: string;
}) {
  const router = useRouter();
  const [values, setValues] = useState(initial);
  const [error, setError] = useState<string | null>(null);

  const isEdit = Boolean(initial.id);
  const isHotel = values.type === "HOTEL";

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

  const addToList = api.scouting.add.useMutation();

  const onDone = (propertyId: string) => {
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
    router.push(`/properties/${propertyId}`);
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
        bedConfiguration: isHotel ? text(category.bedConfiguration) : undefined,
        bedrooms: isHotel ? undefined : num(category.bedrooms),
        bathrooms: isHotel ? undefined : num(category.bathrooms),
        // Prices are typed in whole currency units and stored in minor units.
        indicativePriceCents: category.price.trim()
          ? Math.round((num(category.price) ?? 0) * 100)
          : undefined,
        currency: category.currency.trim().toUpperCase() || "CHF",
      }));

    const payload = {
      name: values.name.trim(),
      type: values.type,
      address: text(values.address),
      city: text(values.city),
      country: text(values.country),
      latitude: num(values.latitude),
      longitude: num(values.longitude),
      stars: isHotel ? num(values.stars) : undefined,
      totalRooms: num(values.totalRooms),
      website: text(values.website),
      phone: text(values.phone),
      notes: text(values.notes),
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
    if ((payload.latitude === undefined) !== (payload.longitude === undefined)) {
      setError(
        "Give both a latitude and a longitude, or neither — one on its own cannot be put on the map.",
      );
      return;
    }

    if (initial.id) update.mutate({ ...payload, id: initial.id });
    else create.mutate(payload);
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
            </Select>
          </Field>

          {isHotel && (
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

          <Field label="Address" className="sm:col-span-2">
            <Input
              value={values.address}
              onChange={(e) => set("address", e.target.value)}
            />
          </Field>

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

          <Field label={isHotel ? "Total rooms" : "Total units"}>
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
        title={isHotel ? "Room categories" : "Unit types"}
        description={
          isHotel
            ? "One row per room type, with how many the hotel has and what a night indicatively costs."
            : "One row per unit type, with its bedrooms and bathrooms."
        }
        action={
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
            Add {isHotel ? "category" : "unit type"}
          </Button>
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
                  placeholder={isHotel ? "King Room" : "2 Bedroom"}
                />
              </Field>

              <Field label={isHotel ? "Rooms" : "Units"}>
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

              {isHotel ? (
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

              <Field label="Price per night">
                <Input
                  value={category.price}
                  onChange={(e) =>
                    setCategory(index, { price: e.target.value })
                  }
                  inputMode="decimal"
                  placeholder="220"
                />
              </Field>

              <Field label="Currency">
                <Input
                  value={category.currency}
                  onChange={(e) =>
                    setCategory(index, { currency: e.target.value })
                  }
                  maxLength={3}
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

      <div className="flex items-center gap-3">
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
