import { notFound, redirect } from "next/navigation";

import { EventTabs } from "~/app/_components/event-tabs";
import { PositionReport } from "~/app/_components/position-report";
import { PageHeader } from "~/app/_components/ui";
import { formatRange } from "~/lib/format";
import { auth } from "~/server/auth";
import { api } from "~/trpc/server";

export const metadata = { title: "Position" };

/** §5 and §7 — where the commercial position leaves us, and what it is worth. */
export default async function EventPositionPage({
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
        subtitle={`Position · ${formatRange(event.startDate, event.endDate)}`}
      />
      <EventTabs eventId={event.id} />
      <PositionReport eventId={event.id} />
    </>
  );
}
