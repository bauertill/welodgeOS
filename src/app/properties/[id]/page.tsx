import Link from "next/link";
import { notFound, redirect } from "next/navigation";

import { ActivityLog } from "~/app/_components/activity-log";
import { DeleteProperty } from "~/app/_components/delete-property";
import {
  AmenitiesCard,
  ContactsCard,
  ContractingCard,
  MoreAboutCard,
  RoomCategoriesCard,
  WhereItIsCard,
} from "~/app/_components/property-cards";
import { Card, PageHeader, ScoutingStatusBadge } from "~/app/_components/ui";
import { UpdateThread } from "~/app/_components/update-thread";
import { propertyTypeLabels, totalUnits } from "~/lib/scouting";
import { auth } from "~/server/auth";
import { api } from "~/trpc/server";

export default async function PropertyPage({
  params,
  searchParams,
}: {
  params: Promise<{ id: string }>;
  searchParams: Promise<{ back?: string }>;
}) {
  const session = await auth();
  if (!session?.user) redirect("/signin");

  const { id } = await params;
  const [property, amenities] = await Promise.all([api.property.byId({ id }), api.amenity.list()]);
  if (!property) notFound();

  // Opened from an event's Properties tab: "back" goes to that event. Only an
  // event this property is actually on is accepted.
  const { back } = await searchParams;
  const cameFrom = property.scoutingEntries.find((entry) => back === `/events/${entry.event.id}`);
  const editHref = `/properties/${property.id}/edit${cameFrom ? `?back=${encodeURIComponent(back!)}` : ""}`;

  const units = totalUnits(property.categories) || property.totalRooms || 0;

  return (
    <>
      <PageHeader
        back={
          cameFrom
            ? { href: `/events/${cameFrom.event.id}`, label: cameFrom.event.name }
            : property.scoutingEntries[0]
              ? {
                  href: `/events/${property.scoutingEntries[0].event.id}`,
                  label: property.scoutingEntries[0].event.name,
                }
              : { href: "/events", label: "All events" }
        }
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
              href={editHref}
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
              Updates
            </h2>
            <UpdateThread propertyId={property.id} />
          </Card>

          <RoomCategoriesCard property={property} />

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

          <Card>
            <h2 className="text-ink-900 mb-3 text-[15px] font-medium">
              Activity
            </h2>
            <ActivityLog entity="Property" entityId={property.id} />
          </Card>
        </div>

        <div className="space-y-5">
          <WhereItIsCard property={property} totalLabel={units ? `${units} rooms` : null} />

          <ContactsCard property={property} />

          <AmenitiesCard property={property} amenities={amenities} />

          <MoreAboutCard property={property} backTo={cameFrom ? `/events/${cameFrom.event.id}` : undefined} />
          <ContractingCard property={property} />

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

