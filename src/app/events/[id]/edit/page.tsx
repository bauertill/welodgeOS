import { notFound, redirect } from "next/navigation";

import { EventForm } from "~/app/_components/event-form";
import { PageHeader } from "~/app/_components/ui";
import { dayKey } from "~/lib/dates";
import { auth } from "~/server/auth";
import { api } from "~/trpc/server";

export const metadata = { title: "Edit event" };

/** Numbers and dates come back from the database; the form works in strings. */
const str = (value: number | null | undefined) =>
  value === null || value === undefined ? "" : String(value);

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
          venueName: event.venueName ?? "",
          venueLatitude: str(event.venueLatitude),
          venueLongitude: str(event.venueLongitude),
        }}
      />
    </>
  );
}
