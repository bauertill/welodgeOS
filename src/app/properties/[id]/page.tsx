import Link from "next/link";
import { notFound, redirect } from "next/navigation";

import { DeleteProperty } from "~/app/_components/delete-property";
import {
  Card,
  PageHeader,
  Pill,
  ScoutingStatusBadge,
  Table,
  Td,
  Th,
} from "~/app/_components/ui";
import { formatMoney } from "~/lib/format";
import { propertyTypeLabels, totalUnits } from "~/lib/scouting";
import { auth } from "~/server/auth";
import { api } from "~/trpc/server";

export default async function PropertyPage({
  params,
}: {
  params: Promise<{ id: string }>;
}) {
  const session = await auth();
  if (!session?.user) redirect("/signin");

  const { id } = await params;
  const property = await api.property.byId({ id });
  if (!property) notFound();

  const isHotel = property.type === "HOTEL";
  const units = totalUnits(property.categories) || property.totalRooms || 0;

  return (
    <>
      <PageHeader
        back={{ href: "/properties", label: "All properties" }}
        title={property.name}
        subtitle={[
          propertyTypeLabels[property.type],
          property.stars ? `${property.stars}-star` : null,
          [property.city, property.country].filter(Boolean).join(", ") || null,
        ]
          .filter(Boolean)
          .join(" · ")}
        action={
          <div className="flex items-start gap-2">
            <Link
              href={`/properties/${property.id}/edit`}
              className="border-ink-200 text-ink-700 hover:bg-ink-50 inline-flex rounded-full border bg-white px-5 py-2.5 text-[13px] font-light transition-colors"
            >
              Edit
            </Link>
            <DeleteProperty id={property.id} name={property.name} />
          </div>
        }
      />

      <div className="grid gap-5 lg:grid-cols-3">
        <div className="space-y-5 lg:col-span-2">
          <Card>
            <h2 className="text-ink-900 mb-3 text-[15px] font-medium">
              {isHotel ? "Room categories" : "Unit types"}
            </h2>

            {property.categories.length === 0 ? (
              <p className="text-ink-500 text-sm font-light">
                No categories recorded.
                {property.totalRooms
                  ? ` The property has ${property.totalRooms} in total.`
                  : ""}
              </p>
            ) : (
              <Table>
                <thead>
                  <tr>
                    <Th>Category</Th>
                    <Th>{isHotel ? "Rooms" : "Units"}</Th>
                    <Th>Sleeps</Th>
                    <Th>{isHotel ? "Beds" : "Bed / bath"}</Th>
                    <Th>Price per night</Th>
                  </tr>
                </thead>
                <tbody>
                  {property.categories.map((category) => (
                    <tr key={category.id}>
                      <Td>
                        <span className="font-medium">{category.name}</span>
                      </Td>
                      <Td>{category.unitCount || "—"}</Td>
                      <Td>{category.capacity}</Td>
                      <Td>
                        {isHotel
                          ? (category.bedConfiguration ?? "—")
                          : [
                              category.bedrooms !== null
                                ? `${category.bedrooms} bed`
                                : null,
                              category.bathrooms !== null
                                ? `${category.bathrooms} bath`
                                : null,
                            ]
                              .filter(Boolean)
                              .join(" · ") || "—"}
                      </Td>
                      <Td>
                        {category.indicativePriceCents
                          ? formatMoney(
                              category.indicativePriceCents,
                              category.currency,
                            )
                          : "—"}
                        {category.indicativePriceCents && (
                          <span className="text-ink-500 block text-xs font-light">
                            Indicative
                          </span>
                        )}
                      </Td>
                    </tr>
                  ))}
                </tbody>
              </Table>
            )}
          </Card>

          {property.notes && (
            <Card>
              <h2 className="text-ink-900 mb-2 text-[15px] font-medium">
                Notes
              </h2>
              <p className="text-ink-500 text-sm font-light whitespace-pre-line">
                {property.notes}
              </p>
            </Card>
          )}

          <Card>
            <h2 className="text-ink-900 mb-3 text-[15px] font-medium">
              On these scouting lists
            </h2>
            {property.scoutingEntries.length === 0 ? (
              <p className="text-ink-500 text-sm font-light">
                Not on any event&apos;s list yet.
              </p>
            ) : (
              <ul className="space-y-2">
                {property.scoutingEntries.map((entry) => (
                  <li
                    key={entry.id}
                    className="flex items-center justify-between gap-3"
                  >
                    <Link
                      href={`/events/${entry.eventId}`}
                      className="hover:text-brand-700 text-sm"
                    >
                      {entry.event.name}
                    </Link>
                    <ScoutingStatusBadge status={entry.status} />
                  </li>
                ))}
              </ul>
            )}
          </Card>
        </div>

        <div className="space-y-5">
          <Card>
            <h2 className="text-ink-900 mb-3 text-[15px] font-medium">
              Where it is
            </h2>
            <dl className="space-y-2 text-sm font-light">
              <Row label="Address" value={property.address} />
              <Row
                label="City"
                value={
                  [property.city, property.country].filter(Boolean).join(", ") ||
                  null
                }
              />
              <Row
                label="Coordinates"
                value={
                  property.latitude !== null && property.longitude !== null
                    ? `${property.latitude.toFixed(5)}, ${property.longitude.toFixed(5)}`
                    : null
                }
              />
              <Row label="Total" value={units ? `${units} rooms` : null} />
              <Row label="Phone" value={property.phone} />
              <Row label="Website" value={property.website} />
            </dl>
          </Card>

          <Card>
            <h2 className="text-ink-900 mb-3 text-[15px] font-medium">
              Amenities
            </h2>
            {property.amenities.length === 0 ? (
              <p className="text-ink-500 text-sm font-light">None recorded.</p>
            ) : (
              <div className="flex flex-wrap gap-1.5">
                {property.amenities.map((amenity) => (
                  <Pill key={amenity.id}>{amenity.label}</Pill>
                ))}
              </div>
            )}
          </Card>

          <Card>
            <h2 className="text-ink-900 mb-3 text-[15px] font-medium">
              Contacts
            </h2>
            {property.contacts.length === 0 ? (
              <p className="text-ink-500 text-sm font-light">
                No contacts recorded.
              </p>
            ) : (
              <ul className="space-y-3">
                {property.contacts.map((contact) => (
                  <li key={contact.id} className="text-sm font-light">
                    <span className="text-ink-900 font-medium">
                      {contact.name}
                    </span>
                    {contact.role && (
                      <span className="text-ink-500 block text-xs">
                        {contact.role}
                      </span>
                    )}
                    {contact.email && (
                      <a
                        href={`mailto:${contact.email}`}
                        className="text-brand-700 block text-xs"
                      >
                        {contact.email}
                      </a>
                    )}
                    {contact.phone && (
                      <span className="text-ink-500 block text-xs">
                        {contact.phone}
                      </span>
                    )}
                  </li>
                ))}
              </ul>
            )}
          </Card>

          {property.scoutedBy && (
            <p className="text-ink-500 text-xs font-light">
              Scouted by {property.scoutedBy.name ?? property.scoutedBy.email}
            </p>
          )}
        </div>
      </div>
    </>
  );
}

function Row({ label, value }: { label: string; value?: string | null }) {
  return (
    <div className="flex gap-3">
      <dt className="text-ink-500 w-28 shrink-0">{label}</dt>
      <dd className="text-ink-900 min-w-0 break-words">{value ?? "—"}</dd>
    </div>
  );
}
