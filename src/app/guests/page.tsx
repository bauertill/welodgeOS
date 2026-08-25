import { redirect } from "next/navigation";

import {
  EmptyState,
  PageHeader,
  Table,
  Td,
  Th,
} from "~/app/_components/ui";
import { auth } from "~/server/auth";
import { api } from "~/trpc/server";

export const metadata = { title: "Guests" };

export default async function GuestsPage() {
  const session = await auth();
  if (!session?.user) redirect("/signin");

  const guests = await api.guest.list();

  return (
    <>
      <PageHeader
        title="Guests"
        subtitle="Everyone we have accommodated, across all events."
      />

      {guests.length === 0 ? (
        <EmptyState
          title="No guests yet"
          description="Guests are created alongside bookings and collected here for easy lookup."
        />
      ) : (
        <Table>
          <thead>
            <tr>
              <Th>Name</Th>
              <Th>Email</Th>
              <Th>Phone</Th>
              <Th>Bookings</Th>
            </tr>
          </thead>
          <tbody>
            {guests.map((guest) => (
              <tr key={guest.id}>
                <Td>
                  <span className="font-medium">
                    {guest.lastName}, {guest.firstName}
                  </span>
                </Td>
                <Td>{guest.email ?? "—"}</Td>
                <Td>{guest.phone ?? "—"}</Td>
                <Td>{guest._count.bookings}</Td>
              </tr>
            ))}
          </tbody>
        </Table>
      )}
    </>
  );
}
