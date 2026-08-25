import Link from "next/link";

import {
  Card,
  EmptyState,
  PageHeader,
  StatCard,
  StatusBadge,
  Table,
  Td,
  Th,
} from "~/app/_components/ui";
import { auth } from "~/server/auth";
import { api } from "~/trpc/server";
import { formatRange } from "~/lib/format";

export default async function DashboardPage() {
  const session = await auth();

  if (!session?.user) {
    return <SignedOut />;
  }

  const [summary, upcoming] = await Promise.all([
    api.booking.summary(),
    api.booking.list({ limit: 8 }),
  ]);

  const firstName =
    session.user.name?.split(" ")[0] ??
    session.user.email?.split("@")[0] ??
    "there";

  return (
    <>
      <PageHeader
        title={`Welcome back, ${firstName}`}
        subtitle="Today at a glance across all We Lodge events."
      />

      <div className="mb-8 grid gap-4 sm:grid-cols-2 xl:grid-cols-4">
        <StatCard label="Total bookings" value={summary.total} />
        <StatCard
          label="Confirmed"
          value={summary.byStatus.CONFIRMED ?? 0}
          hint="Ready for arrival"
        />
        <StatCard
          label="Open inquiries"
          value={
            (summary.byStatus.INQUIRY ?? 0) + (summary.byStatus.OPTIONED ?? 0)
          }
          hint="Awaiting confirmation"
        />
        <StatCard label="Guests on file" value={summary.guests} />
      </div>

      <div className="mb-4 flex items-baseline justify-between">
        <h2 className="text-ink-900 text-lg font-semibold">Next arrivals</h2>
        <Link
          href="/bookings"
          className="text-brand-700 hover:text-brand-400 text-[13px]"
        >
          All bookings →
        </Link>
      </div>

      {upcoming.length === 0 ? (
        <EmptyState
          title="No bookings yet"
          description="Once bookings land in the system, the next arrivals will show up here."
        />
      ) : (
        <Table>
          <thead>
            <tr>
              <Th>Reference</Th>
              <Th>Guest</Th>
              <Th>Property</Th>
              <Th>Stay</Th>
              <Th>Status</Th>
            </tr>
          </thead>
          <tbody>
            {upcoming.map((booking) => (
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
                <Td>{booking.property?.name ?? "—"}</Td>
                <Td>
                  <span className="whitespace-nowrap">
                    {formatRange(booking.checkIn, booking.checkOut)}
                  </span>
                </Td>
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

function SignedOut() {
  return (
    <div className="mx-auto max-w-2xl py-16 text-center">
      <p className="text-brand-400 text-xl font-semibold">We Lodge OS</p>
      <h1 className="text-ink-900 mt-3 text-4xl font-bold">
        Booking management for We Lodge AG
      </h1>
      <p className="text-ink-500 mx-auto mt-4 max-w-lg font-light">
        Events, properties, room allotments and guest bookings — managed in one
        place across all five offices.
      </p>
      <Link
        href="/signin"
        className="bg-brand-400 hover:bg-brand-500 mt-8 inline-block rounded-full px-8 py-3.5 text-[13px] font-light text-white transition-colors"
      >
        Sign in
      </Link>

      <div className="mt-14 grid gap-4 text-left sm:grid-cols-3">
        {[
          ["Accommodation", "Inventory and allotments per event."],
          ["Guest relations", "Every guest, stay and special request."],
          ["Event teams", "Federations, media, sponsors and crews."],
        ].map(([title, copy]) => (
          <Card key={title}>
            <p className="text-ink-900 font-medium">{title}</p>
            <p className="text-ink-500 mt-1 text-sm font-light">{copy}</p>
          </Card>
        ))}
      </div>
    </div>
  );
}
