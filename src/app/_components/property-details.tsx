import Link from "next/link";

import {
  contractingFields,
  effectiveContracting,
  propertyDetailFields,
  propertyServiceFields,
  type Contracting,
} from "~/lib/contracting";

/**
 * How a property's details (doc §3.9) read, wherever they are shown — its own
 * page and the side panel on an event's Properties tab — so the two agree.
 */

type Contact = { id: string; name: string; role: string | null; email: string | null; phone: string | null };

type PropertyLike = Contracting &
  Record<(typeof propertyDetailFields)[number]["key"] | (typeof propertyServiceFields)[number]["key"], string | null> & {
    yearBuilt: number | null;
    contacts: Contact[];
    provider: (Contracting & { id: string; name: string; contacts: Contact[] }) | null;
  };

export function DetailRow({ label, value }: { label: string; value?: React.ReactNode }) {
  return (
    <div className="flex gap-3">
      <dt className="text-ink-500 w-40 shrink-0">{label}</dt>
      <dd className="text-ink-900 min-w-0 break-words whitespace-pre-line">{value ?? "—"}</dd>
    </div>
  );
}

const linkish = (value: string | null) =>
  value && /^https?:\/\//.test(value) ? (
    <a href={value} target="_blank" rel="noreferrer" className="text-brand-700 hover:underline">
      {value}
    </a>
  ) : (
    value
  );

/** The property itself: provider, year built, general email, video, times, services. */
export function PropertyFacts({ property, backTo }: { property: PropertyLike; backTo?: string }) {
  return (
    <dl className="space-y-2 text-sm font-light">
      <DetailRow
        label="Provider"
        value={
          property.provider ? (
            <Link
              href={`/providers/${property.provider.id}${backTo ? `?back=${encodeURIComponent(backTo)}` : ""}`}
              className="text-brand-700 hover:underline"
            >
              {property.provider.name}
            </Link>
          ) : null
        }
      />
      <DetailRow label="Year built" value={property.yearBuilt ? String(property.yearBuilt) : null} />
      {propertyDetailFields.map((field) => (
        <DetailRow
          key={field.key}
          label={field.label}
          value={field.key === "videoUrl" ? linkish(property[field.key]) : property[field.key]}
        />
      ))}
      {propertyServiceFields.map((field) => (
        <DetailRow key={field.key} label={field.label} value={property[field.key]} />
      ))}
    </dl>
  );
}

/** The contracting details that apply: the property's own, or its provider's, said so. */
export function ContractingDetails({ property }: { property: PropertyLike }) {
  const { details, from, providerName } = effectiveContracting(property, property.provider);
  return (
    <>
      {from === "provider" && (
        <p className="bg-brand-50 text-brand-800 mb-3 rounded-lg px-3 py-2 text-xs font-light">
          From <span className="font-medium">{providerName}</span> — this property has no contracting details
          of its own, so its provider&apos;s are used.
        </p>
      )}
      {from === null ? (
        <p className="text-ink-500 text-sm font-light">
          None recorded{property.provider ? `, here or on ${property.provider.name}` : ""}.
        </p>
      ) : (
        <dl className="space-y-2 text-sm font-light">
          {contractingFields.map((field) => (
            <DetailRow key={field.key} label={field.label} value={details[field.key]} />
          ))}
        </dl>
      )}
    </>
  );
}

/** The property's contacts, then its provider's, each marked as such. */
export function ContactList({ property }: { property: PropertyLike }) {
  const providerContacts = property.provider?.contacts ?? [];
  if (property.contacts.length === 0 && providerContacts.length === 0) {
    return <p className="text-ink-500 text-sm font-light">No contacts recorded.</p>;
  }
  const show = (contact: Contact, fromProvider: boolean) => (
    <li key={contact.id} className="text-sm font-light">
      <span className="text-ink-900 font-medium">{contact.name}</span>
      {fromProvider && <span className="text-ink-500 text-xs"> · {property.provider!.name}</span>}
      {contact.role && <span className="text-ink-500 block text-xs">{contact.role}</span>}
      {contact.email && (
        <a href={`mailto:${contact.email}`} className="text-brand-700 block text-xs">
          {contact.email}
        </a>
      )}
      {contact.phone && <span className="text-ink-500 block text-xs">{contact.phone}</span>}
    </li>
  );
  return (
    <ul className="space-y-3">
      {property.contacts.map((contact) => show(contact, false))}
      {providerContacts.map((contact) => show(contact, true))}
    </ul>
  );
}
