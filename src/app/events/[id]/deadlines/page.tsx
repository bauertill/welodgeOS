import { notFound, redirect } from "next/navigation";

import { DeadlineDashboard } from "~/app/_components/deadline-dashboard";
import { EventTabs } from "~/app/_components/event-tabs";
import { PageHeader } from "~/app/_components/ui";
import { formatRange } from "~/lib/format";
import { auth } from "~/server/auth";
import { api } from "~/trpc/server";

export const metadata = { title: "Deadlines" };

/** §4.6 — everything expiring, soonest first, with the value at stake. */
export default async function EventDeadlinesPage({
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
        subtitle={`Deadlines · ${formatRange(event.startDate, event.endDate)}`}
      />
      <EventTabs eventId={event.id} />
      <DeadlineDashboard eventId={event.id} />
    </>
  );
}
