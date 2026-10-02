import { notFound, redirect } from "next/navigation";

import { ActivityLog } from "~/app/_components/activity-log";
import { EventForm } from "~/app/_components/event-form";
import { PlacesOfInterest } from "~/app/_components/places-of-interest";
import { Card, PageHeader } from "~/app/_components/ui";
import { dayKey } from "~/lib/dates";
import { auth } from "~/server/auth";
import { api } from "~/trpc/server";

export const metadata = { title: "Edit event" };

export default async function EditEventPage({
  params,
}: {
  params: Promise<{ id: string }>;
}) {
  const session = await auth();
  if (!session?.user) redirect("/signin");

  const { id } = await params;
  const event = await api.event.byId({ id });
  if (!event) notFound();

  return (
    <>
      <PageHeader
        back={{ href: `/events/${event.id}`, label: event.name }}
        title={`Edit ${event.name}`}
      />

      <EventForm
        initial={{
          id: event.id,
          name: event.name,
          city: event.city ?? "",
          country: event.country ?? "",
          startDate: dayKey(event.startDate),
          endDate: dayKey(event.endDate),
          status: event.status,
        }}
      />

      {/* Part of setting the event up (doc §3.7): the Properties tab only
          measures to these. */}
      <div id="places" className="mt-5 scroll-mt-6">
        <PlacesOfInterest eventId={event.id} />
      </div>

      <div className="mt-5">
        <Card>
          <h2 className="text-ink-900 mb-3 text-[15px] font-medium">
            Log
          </h2>
          <ActivityLog entity="Event" entityId={event.id} />
        </Card>
      </div>
    </>
  );
}
