import { notFound, redirect } from "next/navigation";

import { AddToList } from "~/app/_components/add-to-list";
import {
  ScoutingList,
  ScoutingStatusKey,
} from "~/app/_components/scouting-list";
import { Card, PageHeader } from "~/app/_components/ui";
import { formatRange } from "~/lib/format";
import { auth } from "~/server/auth";
import { api } from "~/trpc/server";

export default async function EventScoutingPage({
  params,
}: {
  params: Promise<{ id: string }>;
}) {
  const session = await auth();
  if (!session?.user) redirect("/signin");

  const { id } = await params;
  const [event, amenities] = await Promise.all([
    api.event.byId({ id }),
    api.amenity.list(),
  ]);

  if (!event) notFound();

  const venue =
    event.venueLatitude !== null && event.venueLongitude !== null
      ? {
          name: event.venueName ?? "Venue",
          latitude: event.venueLatitude,
          longitude: event.venueLongitude,
        }
      : null;

  return (
    <>
      <PageHeader
        back={{ href: "/events", label: "All events" }}
        title={event.name}
        subtitle={`Scouting list · ${formatRange(event.startDate, event.endDate)}${
          event.city ? ` · ${event.city}` : ""
        }`}
        action={<AddToList eventId={event.id} />}
      />

      <ScoutingList eventId={event.id} venue={venue} amenities={amenities} />

      <Card className="mt-8">
        <h2 className="text-ink-900 mb-3 text-[15px] font-medium">
          What the statuses mean
        </h2>
        <ScoutingStatusKey />
      </Card>
    </>
  );
}
