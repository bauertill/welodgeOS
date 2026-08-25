import { redirect } from "next/navigation";

import {
  EmptyState,
  PageHeader,
  StatusBadge,
  Table,
  Td,
  Th,
} from "~/app/_components/ui";
import { formatRange, nights } from "~/lib/format";
import { auth } from "~/server/auth";
import { api } from "~/trpc/server";

export const metadata = { title: "Bookings" };

export default async function BookingsPage() {
  const session = await auth();
  if (!session?.user) redirect("/signin");

  const bookings = await api.booking.list({ limit: 100 });

  return (
    <>
      <PageHeader
        title="Bookings"
        subtitle="Every stay we are managing, ordered by arrival."
      />

      {bookings.length === 0 ? (
        <EmptyState
          title="No bookings yet"
          description="Bookings created for an event will be listed here with their guest, property and status."
        />
      ) : (
        <Table>
          <thead>
            <tr>
              <Th>Reference</Th>
              <Th>Guest</Th>
              <Th>Client</Th>
              <Th>Event</Th>
              <Th>Property</Th>
              <Th>Stay</Th>
              <Th>Nights</Th>
              <Th>Status</Th>
            </tr>
          </thead>
          <tbody>
            {bookings.map((booking) => (
              <tr key={booking.id}>
                <Td>
                  <span className="font-medium whitespace-nowrap">
                    {booking.reference}
                  </span>
                </Td>
                <Td>
                  {booking.guest
                    ? `${booking.guest.firstName} ${booking.guest.lastName}`
                    : "—"}
                </Td>
                <Td>{booking.client?.name ?? "—"}</Td>
                <Td>{booking.event?.name ?? "—"}</Td>
                <Td>
                  {booking.property?.name ?? "—"}
                  {booking.room && (
                    <span className="text-ink-500 block text-xs font-light">
                      {booking.room.name}
                    </span>
                  )}
                </Td>
                <Td>
                  <span className="whitespace-nowrap">
                    {formatRange(booking.checkIn, booking.checkOut)}
                  </span>
                </Td>
                <Td>{nights(booking.checkIn, booking.checkOut)}</Td>
                <Td>
                  <StatusBadge status={booking.status} />
                </Td>
              </tr>
            ))}
          </tbody>
        </Table>
      )}
    </>
  );
}
