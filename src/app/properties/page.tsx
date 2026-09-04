import Link from "next/link";
import { redirect } from "next/navigation";

import {
  EmptyState,
  PageHeader,
  Pill,
  Table,
  Td,
  Th,
} from "~/app/_components/ui";
import { formatMoney } from "~/lib/format";
import {
  cheapestCategory,
  propertyTypeLabels,
  totalUnits,
} from "~/lib/scouting";
import { auth } from "~/server/auth";
import { api } from "~/trpc/server";

export const metadata = { title: "Properties" };

export default async function PropertiesPage() {
  const session = await auth();
  if (!session?.user) redirect("/signin");

  const properties = await api.property.list();

  return (
    <>
      <PageHeader
        title="Properties"
        subtitle="Every hotel and apartment we have scouted. A property is recorded once and can appear on any number of events' lists."
        action={
          <Link
            href="/properties/new"
            className="bg-brand-400 hover:bg-brand-500 inline-flex rounded-full px-5 py-2.5 text-[13px] font-light text-white transition-colors"
          >
            Scout a property
          </Link>
        }
      />

      {properties.length === 0 ? (
        <EmptyState
          title="Nothing scouted yet"
          description="Add the hotels and apartments that could be contracted. Price, room counts and amenities now save a phone call later."
          action={
            <Link
              href="/properties/new"
              className="bg-brand-400 hover:bg-brand-500 inline-flex rounded-full px-6 py-2.5 text-[13px] font-light text-white"
            >
              Scout a property
            </Link>
          }
        />
      ) : (
        <Table>
          <thead>
            <tr>
              <Th>Property</Th>
              <Th>Location</Th>
              <Th>Rooms</Th>
              <Th>From</Th>
              <Th>Amenities</Th>
              <Th>On lists</Th>
              <Th>Map</Th>
            </tr>
          </thead>
          <tbody>
            {properties.map((property) => {
              const cheapest = cheapestCategory(property.categories);
              const units =
                totalUnits(property.categories) || property.totalRooms || 0;

              return (
                <tr key={property.id}>
                  <Td>
                    <Link
                      href={`/properties/${property.id}`}
                      className="hover:text-brand-700 font-medium"
                    >
                      {property.name}
                    </Link>
                    <span className="text-ink-500 block text-xs font-light">
                      {propertyTypeLabels[property.type]}
                      {property.stars ? ` · ${property.stars}-star` : ""}
                    </span>
                  </Td>
                  <Td>
                    {[property.city, property.country]
                      .filter(Boolean)
                      .join(", ") || "—"}
                  </Td>
                  <Td>{units || "—"}</Td>
                  <Td>
                    {cheapest?.indicativePriceCents
                      ? formatMoney(
                          cheapest.indicativePriceCents,
                          cheapest.currency,
                        )
                      : "—"}
                  </Td>
                  <Td>
                    <div className="flex max-w-56 flex-wrap gap-1">
                      {property.amenities.slice(0, 3).map((amenity) => (
                        <Pill key={amenity.id}>{amenity.label}</Pill>
                      ))}
                      {property.amenities.length > 3 && (
                        <Pill>+{property.amenities.length - 3}</Pill>
                      )}
                      {property.amenities.length === 0 && "—"}
                    </div>
                  </Td>
                  <Td>{property._count.scoutingEntries}</Td>
                  <Td>
                    {property.latitude !== null && property.longitude !== null
                      ? "Pinned"
                      : "—"}
                  </Td>
                </tr>
              );
            })}
          </tbody>
        </Table>
      )}
    </>
  );
}
