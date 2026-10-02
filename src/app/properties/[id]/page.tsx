import Link from "next/link";
import { notFound, redirect } from "next/navigation";

import { ActivityLog } from "~/app/_components/activity-log";
import { DeleteProperty } from "~/app/_components/delete-property";
import { PropertyQuotations } from "~/app/_components/quotations";
import {
  AmenitiesCard,
  ContactsCard,
  ContractingCard,
  DetailsPanel,
  MoreAboutCard,
  PanelSection,
  RoomCategoriesCard,
  WhereItIsCard,
} from "~/app/_components/property-cards";
import { PropertyContracts } from "~/app/_components/finance";
import { PropertyTabs } from "~/app/_components/property-tabs";
import { PageHeader, ScoutingStatusBadge } from "~/app/_components/ui";
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
  // The event it was opened from first.
  const entries = [...property.scoutingEntries].sort(
    (a, b) => Number(b.id === cameFrom?.id) - Number(a.id === cameFrom?.id),
  );

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

      {/* The events it is on, under its name, rather than a card of their own. */}
      {property.scoutingEntries.length > 0 && (
        <div className="-mt-5 mb-6 flex flex-wrap items-center gap-2 text-[13px] font-light">
          <span className="text-ink-500">On</span>
          {property.scoutingEntries.map((entry) => (
            <Link
              key={entry.id}
              href={`/events/${entry.eventId}`}
              className="border-ink-200 hover:border-brand-400 flex items-center gap-2 rounded-full border bg-white py-1 pr-1 pl-3 transition-colors"
            >
              {entry.event.name}
              <ScoutingStatusBadge status={entry.status} />
            </Link>
          ))}
        </div>
      )}

      <div className="grid items-start gap-5 lg:grid-cols-3">
        <div className="min-w-0 lg:col-span-2">
          <PropertyTabs
            tabs={[
              {
                key: "quotations",
                label: "Quotations",
                highlight: true,
                count: property.scoutingEntries.reduce((sum, entry) => sum + entry._count.quotations, 0),
                content: <PropertyQuotations entries={entries} categories={property.categories} />,
              },
              {
                key: "contracts",
                label: "Contracts",
                count: property._count.contracts,
                content: <PropertyContracts propertyId={property.id} events={entries.map((entry) => entry.event)} />,
              },
              {
                key: "rooms",
                label: property.type === "HOTEL" ? "Room categories" : "Unit types",
                count: property.categories.length,
                content: <RoomCategoriesCard property={property} bare />,
              },
              { key: "feedback", label: "Feedback", content: <UpdateThread propertyId={property.id} /> },
              // Kept for the record, rarely read: a tab of its own, out of the way.
              { key: "log", label: "Log", content: <ActivityLog entity="Property" entityId={property.id} /> },
            ]}
          />
        </div>

        <div className="space-y-3">
          <DetailsPanel>
            {property.notes && (
              <PanelSection title="Notes" defaultOpen>
                <p className="text-ink-700 text-sm font-light whitespace-pre-line">{property.notes}</p>
              </PanelSection>
            )}
            <WhereItIsCard property={property} totalLabel={units ? `${units} rooms` : null} />
            <ContactsCard property={property} />
            <AmenitiesCard property={property} amenities={amenities} />
            <MoreAboutCard property={property} backTo={cameFrom ? `/events/${cameFrom.event.id}` : undefined} />
            <ContractingCard property={property} />
          </DetailsPanel>

          {property.scoutedBy && (
            <p className="text-ink-500 px-1 text-xs font-light">
              Scouted by {property.scoutedBy.name ?? property.scoutedBy.email}
            </p>
          )}
        </div>
      </div>
    </>
  );
}

