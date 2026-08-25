import { redirect } from "next/navigation";

import {
  EmptyState,
  PageHeader,
  Table,
  Td,
  Th,
} from "~/app/_components/ui";
import { formatRange } from "~/lib/format";
import { auth } from "~/server/auth";
import { api } from "~/trpc/server";

export const metadata = { title: "Events" };

export default async function EventsPage() {
  const session = await auth();
  if (!session?.user) redirect("/signin");

  const events = await api.event.list();

  return (
    <>
      <PageHeader
        title="Events"
        subtitle="Championships, congresses and tours we are accommodating."
      />

      {events.length === 0 ? (
        <EmptyState
          title="No events yet"
          description="Create an event to start attaching properties, room allotments and bookings to it."
        />
      ) : (
        <Table>
          <thead>
            <tr>
              <Th>Event</Th>
              <Th>Location</Th>
              <Th>Dates</Th>
              <Th>Properties</Th>
              <Th>Bookings</Th>
              <Th>Status</Th>
            </tr>
          </thead>
          <tbody>
            {events.map((event) => (
              <tr key={event.id}>
                <Td>
                  <span className="font-medium">{event.name}</span>
                </Td>
                <Td>
                  {[event.city, event.country].filter(Boolean).join(", ") || "—"}
                </Td>
                <Td>
                  <span className="whitespace-nowrap">
                    {formatRange(event.startDate, event.endDate)}
                  </span>
                </Td>
                <Td>{event._count.properties}</Td>
                <Td>{event._count.bookings}</Td>
                <Td>
                  <span className="bg-brand-50 text-brand-700 inline-flex rounded-full px-3 py-1 text-[11px] font-medium capitalize">
                    {event.status.toLowerCase()}
                  </span>
                </Td>
              </tr>
            ))}
          </tbody>
        </Table>
      )}
    </>
  );
}
