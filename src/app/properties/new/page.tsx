import Link from "next/link";
import { redirect } from "next/navigation";

import {
  emptyProperty,
  PropertyForm,
} from "~/app/_components/property-form";
import { QuickScout } from "~/app/_components/quick-scout";
import { PageHeader } from "~/app/_components/ui";
import { auth } from "~/server/auth";
import { api } from "~/trpc/server";

export const metadata = { title: "Scout a property" };

export default async function NewPropertyPage({
  searchParams,
}: {
  searchParams: Promise<{ event?: string; full?: string }>;
}) {
  const session = await auth();
  if (!session?.user) redirect("/signin");

  const { event: eventId, full } = await searchParams;
  // The quick screen by default (doc §3.1); the full form on request.
  const fullHref = `/properties/new?${new URLSearchParams({ ...(eventId ? { event: eventId } : {}), full: "1" }).toString()}`;
  const quickHref = `/properties/new${eventId ? `?event=${eventId}` : ""}`;
  const [amenities, existingNames, event] = await Promise.all([
    api.amenity.list(),
    api.property.listNames(),
    eventId ? api.event.byId({ id: eventId }) : Promise.resolve(null),
  ]);

  return (
    <>
      <PageHeader
        back={
          event
            ? { href: `/events/${event.id}`, label: event.name }
            : { href: "/events", label: "All events" }
        }
        title="Scout a property"
        subtitle={
          event
            ? `It will be added to ${event.name}'s scouting list once saved.`
            : "Nothing here commits us to anything — this is the long list."
        }
        action={
          <Link href={full ? quickHref : fullHref} className="text-brand-700 text-[13px] font-light hover:underline">
            {full ? "Use the quick form" : "Use the full form"}
          </Link>
        }
      />

      {full ? (
        <PropertyForm
          initial={emptyProperty}
          amenities={amenities}
          existingNames={existingNames}
          addToEventId={event?.id}
        />
      ) : (
        <QuickScout amenities={amenities} existingNames={existingNames} event={event ? { id: event.id, name: event.name } : null} />
      )}
    </>
  );
}
