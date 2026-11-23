"use client";

import { Photo } from "~/app/_components/photo";
import { parseDay } from "~/lib/dates";
import { formatDate, formatRange } from "~/lib/format";
import { guestFields, type CustomField, type GuestInfo } from "~/lib/guest-info";
import { propertyTypeLabels } from "~/lib/scouting";
import type { RouterOutputs } from "~/trpc/react";

type Shared = RouterOutputs["guestInfo"]["shared"];
type StayProperty = Partial<Omit<Shared["properties"][number], "custom">> & GuestInfo & { name: string; type: Shared["properties"][number]["type"]; custom?: CustomField[] };

const mapLink = (property: { latitude?: number | null; longitude?: number | null; address?: string | null; name: string; city?: string | null }) =>
  property.latitude != null && property.longitude != null
    ? `https://www.google.com/maps/search/?api=1&query=${property.latitude},${property.longitude}`
    : property.address
      ? `https://www.google.com/maps/search/?api=1&query=${encodeURIComponent([property.name, property.address, property.city].filter(Boolean).join(", "))}`
      : null;

/**
 * One property as guests read it (doc §6.8): where it is, the client's rooms
 * there, and what guests need to know — only the parts filled in. Used on the
 * client's page and as the team's preview on the property.
 */
export function StayPropertySection({ property }: { property: StayProperty }) {
  const where = [property.address, property.city, property.country].filter(Boolean).join(", ");
  const map = mapLink(property);
  // The team's own fields go after the standard ones, before "Anything else".
  const filled = guestFields.filter((field) => property[field.key]?.trim());
  const rows = [
    ...filled.filter((field) => field.key !== "guestOther").map((field) => ({ key: field.key, label: field.label, value: property[field.key]!, wide: !("short" in field) })),
    ...(property.custom ?? []).filter((field) => field.value.trim()).map((field) => ({ key: field.id, label: field.label, value: field.value, wide: true })),
    ...filled.filter((field) => field.key === "guestOther").map((field) => ({ key: field.key, label: field.label, value: property[field.key]!, wide: true })),
  ];
  return (
    <section className="border-ink-200/60 break-inside-avoid-page overflow-hidden rounded-2xl border bg-white print:rounded-none print:border-0 print:border-t">
      {property.photo && (
        <div className="relative h-48 w-full sm:h-64 print:h-40">
          <Photo src={property.photo} alt={property.name} sizes="(max-width: 768px) 100vw, 768px" />
        </div>
      )}
      <div className="p-5 sm:p-6 print:px-0">
        <h2 className="text-ink-900 text-xl font-medium">{property.name}</h2>
        <p className="text-ink-500 mt-0.5 text-[13px] font-light">
          {propertyTypeLabels[property.type]}
          {where && <> · {where}</>}
        </p>
        <div className="mt-2 flex flex-wrap gap-x-4 text-[13px] print:hidden">
          {map && (
            <a href={map} target="_blank" rel="noreferrer" className="text-brand-700 hover:underline">
              Open in Google Maps ↗
            </a>
          )}
          {property.website && (
            <a href={property.website} target="_blank" rel="noreferrer" className="text-brand-700 hover:underline">
              Website ↗
            </a>
          )}
        </div>

        {property.rooms && property.rooms.length > 0 && (
          <div className="bg-brand-50/60 mt-4 rounded-xl px-4 py-3 print:bg-transparent print:px-0">
            <p className="text-ink-900 text-[13px] font-medium">Your rooms</p>
            <ul className="text-ink-700 mt-1 space-y-0.5 text-[13px] font-light">
              {property.rooms.map((run) => (
                <li key={`${run.category}-${run.checkIn}-${run.checkOut}`}>
                  {run.rooms} × {run.category}, {formatRange(parseDay(run.checkIn), parseDay(run.checkOut))}
                </li>
              ))}
            </ul>
          </div>
        )}

        {rows.length > 0 ? (
          <dl className="mt-4 grid gap-x-6 gap-y-3 sm:grid-cols-2">
            {rows.map((row) => (
              <div key={row.key} className={row.wide ? "sm:col-span-2" : ""}>
                <dt className="text-ink-500 text-xs font-light">{row.label}</dt>
                <dd className="text-ink-900 text-[14px] font-light whitespace-pre-line">{row.value}</dd>
              </div>
            ))}
          </dl>
        ) : (
          <p className="text-ink-500 mt-4 text-[13px] font-light italic">More details to follow.</p>
        )}
      </div>
    </section>
  );
}

/** The client's property information page (doc §6.8): every property they have rooms in, at one link. */
export function StayPage({ stay }: { stay: Shared }) {
  return (
    <div className="mx-auto max-w-3xl space-y-5 px-4 py-6 sm:py-10 print:max-w-none print:p-0">
      <header className="flex flex-wrap items-start justify-between gap-3">
        <div>
          <p className="text-brand-700 text-xs font-medium tracking-wide uppercase">We Lodge · Property information</p>
          <h1 className="text-ink-900 mt-1 text-2xl font-medium">{stay.event.name}</h1>
          <p className="text-ink-500 mt-0.5 text-[13px] font-light">
            For {stay.client} · {formatDate(stay.event.startDate)} – {formatDate(stay.event.endDate)}
          </p>
        </div>
        <button
          type="button"
          onClick={() => window.print()}
          className="border-ink-200 text-ink-700 hover:bg-ink-50 rounded-full border bg-white px-4 py-2 text-[13px] font-light print:hidden"
        >
          Save as PDF
        </button>
      </header>

      {stay.event.guestContact && (
        <div className="rounded-2xl border border-[#0a7a47]/20 bg-[#e8f6ee] px-5 py-4 print:border-0 print:bg-transparent print:px-0">
          <p className="text-ink-900 text-[13px] font-medium">Your We Lodge contact</p>
          <p className="text-ink-700 mt-0.5 text-[14px] font-light whitespace-pre-line">{stay.event.guestContact}</p>
        </div>
      )}

      {stay.properties.length ? (
        stay.properties.map((property) => <StayPropertySection key={property.id} property={property} />)
      ) : (
        <p className="text-ink-500 rounded-2xl bg-white p-6 text-center text-sm font-light">Your properties will show here once your rooms are confirmed.</p>
      )}

      <p className="text-ink-400 pt-2 text-center text-xs font-light print:hidden">This page is kept up to date by We Lodge — the link always shows the latest.</p>
    </div>
  );
}
