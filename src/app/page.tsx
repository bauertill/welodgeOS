import Link from "next/link";
import { redirect } from "next/navigation";

import {
  Card,
  EmptyState,
  PageHeader,
  StatCard,
  Table,
  Td,
  Th,
} from "~/app/_components/ui";
import { formatRange } from "~/lib/format";
import { auth } from "~/server/auth";
import { api } from "~/trpc/server";

export default async function DashboardPage() {
  const session = await auth();
  if (!session?.user) return <SignedOut />;

  const [events, properties] = await Promise.all([
    api.event.list(),
    api.property.list(),
  ]);

  const firstName =
    session.user.name?.split(" ")[0] ??
    session.user.email?.split("@")[0] ??
    "there";

  const onAList = properties.filter(
    (property) => property._count.scoutingEntries > 0,
  ).length;
  const pinned = properties.filter(
    (property) => property.latitude !== null && property.longitude !== null,
  ).length;

  return (
    <>
      <PageHeader
        title={`Welcome back, ${firstName}`}
        subtitle="Scouting — the long list of hotels and apartments we could contract."
      />

      <div className="mb-8 grid gap-4 sm:grid-cols-2 xl:grid-cols-4">
        <StatCard label="Events" value={events.length} />
        <StatCard
          label="Properties scouted"
          value={properties.length}
          hint="Across every event"
        />
        <StatCard
          label="On a scouting list"
          value={onAList}
          hint="The rest are in the library only"
        />
        <StatCard
          label="On the map"
          value={pinned}
          hint="Have coordinates recorded"
        />
      </div>

      <div className="mb-4 flex items-baseline justify-between">
        <h2 className="text-ink-900 text-lg font-semibold">Events</h2>
        <Link
          href="/events"
          className="text-brand-700 hover:text-brand-400 text-[13px]"
        >
          All events →
        </Link>
      </div>

      {events.length === 0 ? (
        <EmptyState
          title="No events yet"
          description="Everything hangs off an event. Create one, then build its scouting list."
          action={
            <Link
              href="/events"
              className="bg-brand-400 hover:bg-brand-500 inline-flex rounded-full px-6 py-2.5 text-[13px] font-light text-white"
            >
              Go to events
            </Link>
          }
        />
      ) : (
        <Table>
          <thead>
            <tr>
              <Th>Event</Th>
              <Th>Where</Th>
              <Th>When</Th>
              <Th>Properties scouted</Th>
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
                </Td>
                <Td>
                  {[event.city, event.country].filter(Boolean).join(", ") || "—"}
                </Td>
                <Td>
                  <span className="whitespace-nowrap">
                    {formatRange(event.startDate, event.endDate)}
                  </span>
                </Td>
                <Td>{event._count.scoutingEntries}</Td>
              </tr>
            ))}
          </tbody>
        </Table>
      )}

      <Card className="mt-8">
        <p className="text-ink-900 font-medium">What comes next</p>
        <p className="text-ink-500 mt-1 text-sm font-light">
          Scouting is Phase 1 of three. Phase 2 turns shortlisted properties into
          room-nights we buy and sell; Phase 3 checks the rooming lists against
          what we hold. Both are specified in{" "}
          <span className="text-ink-700">docs/product-scope.md</span> and are not
          built yet.
        </p>
      </Card>
    </>
  );
}

function SignedOut() {
  return (
    <div className="mx-auto max-w-2xl py-16 text-center">
      <p className="text-brand-400 text-xl font-semibold">We Lodge OS</p>
      <h1 className="text-ink-900 mt-3 text-4xl font-bold">
        Accommodation inventory for We Lodge AG
      </h1>
      <p className="text-ink-500 mx-auto mt-4 max-w-lg font-light">
        Scout the properties worth contracting, hold what we buy and sell, and
        prove the rooming lists will work — in one place.
      </p>
      <Link
        href="/signin"
        className="bg-brand-400 hover:bg-brand-500 mt-8 inline-block rounded-full px-8 py-3.5 text-[13px] font-light text-white transition-colors"
      >
        Sign in
      </Link>

      <div className="mt-14 grid gap-4 text-left sm:grid-cols-3">
        {[
          ["Scouting", "The long list of hotels and apartments, on a map."],
          ["Acquisition & sales", "What we hold, what we promised, where we are exposed."],
          ["Operations", "Rooming lists checked against what we actually own."],
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
