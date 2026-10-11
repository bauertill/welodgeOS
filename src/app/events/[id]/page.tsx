import { notFound, redirect } from "next/navigation";

import { AddToList } from "~/app/_components/add-to-list";
import { EventTabs } from "~/app/_components/event-tabs";
import {
  ScoutingList,
  ScoutingStatusKey,
} from "~/app/_components/scouting-list";
import { Card, PageHeader } from "~/app/_components/ui";
import { formatRange } from "~/lib/format";
import { auth } from "~/server/auth";
import { api } from "~/trpc/server";

export default async function EventPropertiesPage({
  params,
}: {
  params: Promise<{ id: string }>;
}) {
  const session = await auth();
  if (!session?.user) redirect("/signin");

  const { id } = await params;
  const event = await api.event.byId({ id });

  if (!event) notFound();

  // The map and the list both read from the event's places of interest
  // (doc §3.7) — the map shows all of them, the list measures to the venues.
  const places = event.placesOfInterest.map((place) => ({
    id: place.id,
    name: place.name,
    category: place.category,
    lines: place.lines,
    latitude: place.latitude,
    longitude: place.longitude,
  }));

  return (
    <>
      <PageHeader
        back={{ href: "/events", label: "All events" }}
        title={event.name}
        subtitle={`Properties · ${formatRange(event.startDate, event.endDate)}${
          event.city ? ` · ${event.city}` : ""
        }`}
        action={
          <div className="flex items-start gap-2">
            <AddToList eventId={event.id} eventName={event.name} />
          </div>
        }
      />

      <EventTabs eventId={event.id} />

      <ScoutingList eventId={event.id} places={places} />

      <Card className="mt-8">
        <h2 className="text-ink-900 mb-3 text-[15px] font-medium">
          What the statuses mean
        </h2>
        <ScoutingStatusKey />
      </Card>
    </>
  );
}
