import { notFound, redirect } from "next/navigation";

import { EventTabs } from "~/app/_components/event-tabs";
import { InventoryBoard } from "~/app/_components/inventory-board";
import { PageHeader } from "~/app/_components/ui";
import { dayKey } from "~/lib/dates";
import { formatRange } from "~/lib/format";
import { auth } from "~/server/auth";
import { api } from "~/trpc/server";

export const metadata = { title: "Inventory" };

/** Phase 2 — what we hold and what we have promised (doc §4). */
export default async function EventInventoryPage({
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
        back={{ href: "/events", label: "All events" }}
        title={event.name}
        subtitle={`Inventory · ${formatRange(event.startDate, event.endDate)}`}
      />
      <EventTabs eventId={event.id} />
      <InventoryBoard
        eventId={event.id}
        defaultCheckIn={dayKey(event.startDate)}
        defaultCheckOut={dayKey(event.endDate)}
      />
    </>
  );
}
