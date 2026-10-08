"use client";

import { useEffect, useState } from "react";

import { Button, Field, FormError, friendlyError, Input } from "~/app/_components/form";
import { Card } from "~/app/_components/ui";
import { propertyServiceFields } from "~/lib/contracting";
import { formatMomentInWords } from "~/lib/format";
import { api, type RouterOutputs } from "~/trpc/react";

type Form = RouterOutputs["property"]["detailsForm"];
type Values = Form["values"];
type Key = keyof Values;
type Category = Omit<Form["categories"][number], "id"> & { id?: string };
type Contact = Form["contacts"][number];

const aboutFields: { key: Key; label: string; placeholder?: string; wide?: boolean }[] = [
  { key: "address", label: "Address", placeholder: "Street and number", wide: true },
  { key: "city", label: "City" },
  { key: "country", label: "Country" },
  { key: "area", label: "Neighbourhood", placeholder: "Santa Monica" },
  { key: "phone", label: "Phone" },
  { key: "generalEmail", label: "General email", placeholder: "reservations@hotel.com" },
  { key: "website", label: "Website" },
  { key: "checkInTime", label: "Check-in time", placeholder: "15:00" },
  { key: "checkOutTime", label: "Check-out time", placeholder: "11:00" },
];
const emptyCategory = (): Category => ({ name: "", unitCount: "", capacity: "2", bedConfiguration: "", bedrooms: "", bathrooms: "", size: "", notes: "" });
const emptyContact = (): Contact => ({ name: "", role: "", email: "", phone: "" });

/**
 * The page a hotel opens from its private link (doc §3.9): everything we keep
 * about the property but rates and contracting details — the property, its
 * room categories, amenities, services and the people to talk to — filled
 * with what we already have, sent straight to the property.
 */
export function HotelDetailsForm({ token }: { token: string }) {
  const form = api.property.detailsForm.useQuery({ token }, { retry: false, refetchOnWindowFocus: false });
  const [values, setValues] = useState<Values | null>(null);
  const [yearBuilt, setYearBuilt] = useState("");
  const [categories, setCategories] = useState<Category[]>([]);
  const [amenityIds, setAmenityIds] = useState<string[]>([]);
  const [contacts, setContacts] = useState<Contact[]>([]);
  const [sent, setSent] = useState(false);

  useEffect(() => {
    if (!form.data || values) return;
    setValues(form.data.values);
    setYearBuilt(form.data.yearBuilt);
    setCategories(form.data.categories.length ? form.data.categories : [emptyCategory()]);
    setAmenityIds(form.data.amenityIds);
    setContacts(form.data.contacts.length ? form.data.contacts : [emptyContact()]);
  }, [form.data, values]);

  const submit = api.property.submitDetails.useMutation({
    onSuccess: () => {
      setSent(true);
      window.scrollTo({ top: 0 });
    },
  });

  if (form.isLoading) return <p className="text-ink-500 text-sm font-light">Loading…</p>;
  if (form.error || !form.data) {
    return (
      <Card>
        <h1 className="text-ink-900 text-lg font-medium">This link is not in use any more</h1>
        <p className="text-ink-500 mt-2 text-sm font-light">Please ask your contact at We Lodge for a new one.</p>
      </Card>
    );
  }
  if (!values) return null;

  const hotel = form.data.type === "HOTEL";
  const set = (key: Key, value: string) => setValues({ ...values, [key]: value });
  const setCategory = (index: number, key: keyof Category, value: string) =>
    setCategories(categories.map((category, i) => (i === index ? { ...category, [key]: value } : category)));
  const setContact = (index: number, key: keyof Contact, value: string) =>
    setContacts(contacts.map((contact, i) => (i === index ? { ...contact, [key]: value } : contact)));
  const text = (key: Key, label: string, placeholder?: string, wide?: boolean) => (
    <Field key={key} label={label} className={wide ? "sm:col-span-2" : ""}>
      <Input
        type={key === "generalEmail" ? "email" : "text"}
        value={values[key]}
        onChange={(e) => set(key, e.target.value)}
        placeholder={placeholder}
      />
    </Field>
  );

  return (
    <form
      className="space-y-5"
      onSubmit={(e) => {
        e.preventDefault();
        submit.mutate({ token, values, yearBuilt, categories, amenityIds, contacts });
      }}
    >
      <div>
        <h1 className="text-ink-900 text-2xl font-semibold">{form.data.propertyName}</h1>
        <p className="text-ink-500 mt-1 text-sm font-light">
          Your property&apos;s details, as We Lodge has them — please check, correct and complete them. Rates are agreed separately. What you send
          comes straight to your contact at We Lodge.
        </p>
      </div>

      {sent && (
        <p className="rounded-lg bg-[#e3f8ee] px-4 py-3 text-sm text-[#0a7a47]">
          Thank you — your details have been sent to We Lodge. You can still correct them here and send again.
        </p>
      )}
      {!sent && form.data.submittedAt && (
        <p className="bg-brand-50 text-brand-800 rounded-lg px-4 py-3 text-sm font-light">
          You sent these {formatMomentInWords(form.data.submittedAt)}. Change anything that is wrong and send again.
        </p>
      )}

      <Card>
        <h2 className="text-ink-900 mb-3 text-[15px] font-medium">The property</h2>
        <div className="grid gap-4 sm:grid-cols-2">
          {aboutFields.map((field) => text(field.key, field.label, field.placeholder, field.wide))}
          <Field label="Year built">
            <Input inputMode="numeric" value={yearBuilt} onChange={(e) => setYearBuilt(e.target.value)} placeholder="1998" />
          </Field>
        </div>
      </Card>

      <Card>
        <h2 className="text-ink-900 text-[15px] font-medium">{hotel ? "Room categories" : "Unit types"}</h2>
        <p className="text-ink-500 mb-3 text-xs font-light">
          One line per {hotel ? "room type" : "unit type"}, with how many you have. To take one away, tell your contact at We Lodge.
        </p>
        <div className="space-y-3">
          {categories.map((category, index) => (
            <div key={index} className="border-ink-200/60 grid gap-3 rounded-lg border p-3 sm:grid-cols-6">
              <Field label="Name" className="sm:col-span-2">
                <Input value={category.name} onChange={(e) => setCategory(index, "name", e.target.value)} placeholder={hotel ? "King Room" : "1 Bedroom"} />
              </Field>
              <Field label={hotel ? "Rooms" : "Units"}>
                <Input inputMode="numeric" value={category.unitCount} onChange={(e) => setCategory(index, "unitCount", e.target.value)} placeholder="30" />
              </Field>
              <Field label="Sleeps">
                <Input inputMode="numeric" value={category.capacity} onChange={(e) => setCategory(index, "capacity", e.target.value)} />
              </Field>
              {hotel ? (
                <Field label="Beds" className="sm:col-span-2">
                  <Input value={category.bedConfiguration} onChange={(e) => setCategory(index, "bedConfiguration", e.target.value)} placeholder="1 King" />
                </Field>
              ) : (
                <>
                  <Field label="Bedrooms">
                    <Input inputMode="numeric" value={category.bedrooms} onChange={(e) => setCategory(index, "bedrooms", e.target.value)} />
                  </Field>
                  <Field label="Bathrooms">
                    <Input inputMode="decimal" value={category.bathrooms} onChange={(e) => setCategory(index, "bathrooms", e.target.value)} placeholder="1.5" />
                  </Field>
                </>
              )}
              <Field label="Size" className="sm:col-span-2">
                <Input value={category.size} onChange={(e) => setCategory(index, "size", e.target.value)} placeholder="28 m²" />
              </Field>
              <Field label="Notes" className="sm:col-span-4">
                <Input value={category.notes} onChange={(e) => setCategory(index, "notes", e.target.value)} placeholder="City view, sofa bed" />
              </Field>
              {!category.id && categories.length > 1 && (
                <button
                  type="button"
                  onClick={() => setCategories(categories.filter((_, i) => i !== index))}
                  className="text-left text-xs text-[#c03654] hover:underline sm:col-span-6"
                >
                  Remove this line
                </button>
              )}
            </div>
          ))}
          <button type="button" onClick={() => setCategories([...categories, emptyCategory()])} className="text-brand-700 text-[13px] font-light hover:underline">
            + Add a {hotel ? "room category" : "unit type"}
          </button>
        </div>
      </Card>

      <Card>
        <h2 className="text-ink-900 mb-3 text-[15px] font-medium">Amenities</h2>
        <div className="flex flex-wrap gap-1.5">
          {form.data.amenities.map((amenity) => {
            const on = amenityIds.includes(amenity.id);
            return (
              <button
                key={amenity.id}
                type="button"
                aria-pressed={on}
                onClick={() => setAmenityIds(on ? amenityIds.filter((id) => id !== amenity.id) : [...amenityIds, amenity.id])}
                className={`rounded-full border px-3 py-1 text-[13px] transition-colors ${
                  on ? "border-brand-400 bg-brand-50 text-brand-800 font-medium" : "border-ink-200 text-ink-700 bg-white font-light"
                }`}
              >
                {on ? "✓ " : ""}
                {amenity.label}
              </button>
            );
          })}
        </div>
      </Card>

      <Card>
        <h2 className="text-ink-900 mb-3 text-[15px] font-medium">Services</h2>
        <div className="grid gap-4 sm:grid-cols-2">{propertyServiceFields.map((field) => text(field.key, field.label, field.placeholder))}</div>
      </Card>

      <Card>
        <h2 className="text-ink-900 text-[15px] font-medium">Who we talk to</h2>
        <p className="text-ink-500 mb-3 text-xs font-light">Your sales, reservations or front office people.</p>
        <div className="space-y-3">
          {contacts.map((contact, index) => (
            <div key={index} className="grid items-end gap-3 sm:grid-cols-[1fr_1fr_1.3fr_1fr_auto]">
              <Field label="Name">
                <Input value={contact.name} onChange={(e) => setContact(index, "name", e.target.value)} />
              </Field>
              <Field label="Role">
                <Input value={contact.role} onChange={(e) => setContact(index, "role", e.target.value)} placeholder="Sales manager" />
              </Field>
              <Field label="Email">
                <Input type="email" value={contact.email} onChange={(e) => setContact(index, "email", e.target.value)} />
              </Field>
              <Field label="Phone">
                <Input value={contact.phone} onChange={(e) => setContact(index, "phone", e.target.value)} />
              </Field>
              <button type="button" onClick={() => setContacts(contacts.filter((_, i) => i !== index))} className="pb-2.5 text-xs text-[#c03654] hover:underline">
                Remove
              </button>
            </div>
          ))}
          <button type="button" onClick={() => setContacts([...contacts, emptyContact()])} className="text-brand-700 text-[13px] font-light hover:underline">
            + Add a person
          </button>
        </div>
      </Card>

      <div className="space-y-2">
        <FormError message={submit.error ? friendlyError(submit.error) : null} />
        <Button type="submit" disabled={submit.isPending}>
          {submit.isPending ? "Sending…" : form.data.submittedAt || sent ? "Send again" : "Send to We Lodge"}
        </Button>
      </div>
    </form>
  );
}
