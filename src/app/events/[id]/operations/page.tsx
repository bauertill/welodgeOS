import { notFound, redirect } from "next/navigation";

import { EventTabs } from "~/app/_components/event-tabs";
import { OperationsBoard } from "~/app/_components/operations";
import { PageHeader } from "~/app/_components/ui";
import { formatRange } from "~/lib/format";
import { auth } from "~/server/auth";
import { api } from "~/trpc/server";

export const metadata = { title: "Operations" };

/** §6.10 — the apartments to get ready for check-in: inspections, defects, the defect inbox. */
export default async function EventOperationsPage({ params }: { params: Promise<{ id: string }> }) {
  const session = await auth();
  if (!session?.user) redirect("/signin");
  const { id } = await params;
  const event = await api.event.byId({ id });
  if (!event) notFound();
  return (
    <>
      <PageHeader back={{ href: "/events", label: "All events" }} title={event.name} subtitle={`Operations · ${formatRange(event.startDate, event.endDate)}`} />
      <EventTabs eventId={event.id} />
      <OperationsBoard eventId={event.id} />
    </>
  );
}
