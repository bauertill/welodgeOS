import { redirect } from "next/navigation";

import {
  emptyProperty,
  PropertyForm,
} from "~/app/_components/property-form";
import { PageHeader } from "~/app/_components/ui";
import { auth } from "~/server/auth";
import { api } from "~/trpc/server";

export const metadata = { title: "Scout a property" };

export default async function NewPropertyPage({
  searchParams,
}: {
  searchParams: Promise<{ event?: string }>;
}) {
  const session = await auth();
  if (!session?.user) redirect("/signin");

  const { event: eventId } = await searchParams;
  const [amenities, event] = await Promise.all([
    api.amenity.list(),
    eventId ? api.event.byId({ id: eventId }) : Promise.resolve(null),
  ]);

  return (
    <>
      <PageHeader
        back={
          event
            ? { href: `/events/${event.id}`, label: event.name }
            : { href: "/properties", label: "All properties" }
        }
        title="Scout a property"
        subtitle={
          event
            ? `It will be added to ${event.name}'s scouting list once saved.`
            : "Nothing here commits us to anything — this is the long list."
        }
      />

      <PropertyForm
        initial={emptyProperty}
        amenities={amenities}
        addToEventId={event?.id}
      />
    </>
  );
}
