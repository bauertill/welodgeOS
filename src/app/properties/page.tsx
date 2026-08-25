import { redirect } from "next/navigation";

import {
  EmptyState,
  PageHeader,
  Table,
  Td,
  Th,
} from "~/app/_components/ui";
import { formatMoney } from "~/lib/format";
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
        subtitle="Hotels and apartment inventory held across our events."
      />

      {properties.length === 0 ? (
        <EmptyState
          title="No properties yet"
          description="Add hotels and apartment blocks, then hold room allotments against them for an event."
        />
      ) : (
        <Table>
          <thead>
            <tr>
              <Th>Property</Th>
              <Th>Location</Th>
              <Th>Event</Th>
              <Th>Room types</Th>
              <Th>Allotment</Th>
              <Th>From</Th>
              <Th>Bookings</Th>
            </tr>
          </thead>
          <tbody>
            {properties.map((property) => {
              const allotment = property.rooms.reduce(
                (sum, room) => sum + room.allotment,
                0,
              );
              const cheapest = property.rooms.reduce<
                (typeof property.rooms)[number] | undefined
              >(
                (min, room) =>
                  !min || room.rateCents < min.rateCents ? room : min,
                undefined,
              );

              return (
                <tr key={property.id}>
                  <Td>
                    <span className="font-medium">{property.name}</span>
                    {property.stars && (
                      <span className="text-ink-500 block text-xs font-light">
                        {property.stars}-star
                      </span>
                    )}
                  </Td>
                  <Td>
                    {[property.city, property.country]
                      .filter(Boolean)
                      .join(", ") || "—"}
                  </Td>
                  <Td>{property.event?.name ?? "—"}</Td>
                  <Td>{property.rooms.length}</Td>
                  <Td>{allotment}</Td>
                  <Td>
                    {cheapest
                      ? formatMoney(cheapest.rateCents, cheapest.currency)
                      : "—"}
                  </Td>
                  <Td>{property._count.bookings}</Td>
                </tr>
              );
            })}
          </tbody>
        </Table>
      )}
    </>
  );
}
