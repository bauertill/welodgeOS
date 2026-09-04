import Link from "next/link";
import { redirect } from "next/navigation";

import { NewEventPanel } from "~/app/_components/event-form";
import { EmptyState, PageHeader, Table, Td, Th } from "~/app/_components/ui";
import { formatRange } from "~/lib/format";
import { auth } from "~/server/auth";
import { api } from "~/trpc/server";

export const metadata = { title: "Events" };

const statusLabels = {
  PLANNING: "Planning",
  ACTIVE: "Active",
  CLOSED: "Closed",
} as const;

export default async function EventsPage() {
  const session = await auth();
  if (!session?.user) redirect("/signin");

  const events = await api.event.list();

  return (
    <>
      <PageHeader
        title="Events"
        subtitle="Every championship, congress or tour we are finding accommodation for. Each one carries its own scouting list and its own inventory."
        action={<NewEventPanel />}
      />

      {events.length === 0 ? (
        <EmptyState
          title="No events yet"
          description="An event is the container everything else hangs off. Create one, then start building its scouting list."
        />
      ) : (
        <Table>
          <thead>
            <tr>
              <Th>Event</Th>
              <Th>Where</Th>
              <Th>When</Th>
              <Th>Status</Th>
              <Th>Scouted</Th>
              <Th>Room-nights</Th>
              <Th>{""}</Th>
            </tr>
          </thead>
          <tbody>
            {events.map((event) => (
              <tr key={event.id}>
                <Td>
                  <Link
                    href={`/events/${event.id}`}
                    className="hover:text-brand-700 font-medium"
                  >
                    {event.name}
                  </Link>
                  {event.venueName && (
                    <span className="text-ink-500 block text-xs font-light">
                      {event.venueName}
                    </span>
                  )}
                </Td>
                <Td>
                  {[event.city, event.country].filter(Boolean).join(", ") || "—"}
                </Td>
                <Td>
                  <span className="whitespace-nowrap">
                    {formatRange(event.startDate, event.endDate)}
                  </span>
                </Td>
                <Td>{statusLabels[event.status]}</Td>
                <Td>{event._count.scoutingEntries}</Td>
                <Td>{event._count.roomNights || "—"}</Td>
                <Td>
                  <Link
                    href={`/events/${event.id}/inventory`}
                    className="text-brand-700 hover:text-brand-400 text-[13px] whitespace-nowrap"
                  >
                    Inventory →
                  </Link>
                </Td>
              </tr>
            ))}
          </tbody>
        </Table>
      )}
    </>
  );
}
