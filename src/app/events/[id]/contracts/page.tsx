import { notFound, redirect } from "next/navigation";

import { EventContracts } from "~/app/_components/event-contracts";
import { EventTabs } from "~/app/_components/event-tabs";
import { PageHeader } from "~/app/_components/ui";
import { formatRange } from "~/lib/format";
import { auth } from "~/server/auth";
import { api } from "~/trpc/server";

export const metadata = { title: "Contracts" };

/** §7.1 — the event's contracts, supplier and client side, and what falls due under them. */
export default async function EventContractsPage({ params }: { params: Promise<{ id: string }> }) {
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
        subtitle={`Contracts · ${formatRange(event.startDate, event.endDate)}`}
      />
      <EventTabs eventId={event.id} />
      <EventContracts eventId={event.id} />
    </>
  );
}
