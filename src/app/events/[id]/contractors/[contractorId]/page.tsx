import { notFound, redirect } from "next/navigation";

import { HistorySection } from "~/app/_components/activity-log";
import { ContractorFiles, ContractorQuotes } from "~/app/_components/contractor-quotes";
import { ContractorForm, ContractorProperties } from "~/app/_components/contractors";
import { EventTabs } from "~/app/_components/event-tabs";
import { PropertyContracts } from "~/app/_components/finance";
import { RelatedTasks } from "~/app/_components/tasks";
import { Card, PageHeader } from "~/app/_components/ui";
import { UpdateThread } from "~/app/_components/update-thread";
import { contractorHref, contractorWhat } from "~/lib/contractors";
import { auth } from "~/server/auth";
import { api } from "~/trpc/server";

export const metadata = { title: "Contractor" };

/**
 * One contractor, on its event's Contractors tab (doc §3.11): its details and
 * contacts, the properties it serves, its contracts and payments, its tasks
 * and its updates.
 */
export default async function ContractorPage({ params }: { params: Promise<{ id: string; contractorId: string }> }) {
  const session = await auth();
  if (!session?.user) redirect("/signin");
  const { id, contractorId } = await params;
  const contractor = await api.contractor.byId({ id: contractorId });
  if (!contractor) notFound();
  if (contractor.eventId !== id) redirect(contractorHref(contractor.eventId, contractor.id));
  const section = "text-ink-900 mb-3 text-[15px] font-medium";

  return (
    <>
      <PageHeader back={{ href: `/events/${id}/contractors`, label: `${contractor.event.name} · Contractors` }} title={contractor.name} subtitle={`${contractorWhat(contractor)} · ${contractor.event.name}`} />
      <EventTabs eventId={id} />
      <div className="max-w-5xl space-y-6">
        <Card>
          <h2 className={section}>Properties it serves</h2>
          <ContractorProperties contractor={contractor} />
        </Card>
        <Card>
          <h2 className={section}>Quotes</h2>
          <ContractorQuotes contractorId={contractor.id} />
        </Card>
        <Card>
          <h2 className={section}>Files and links</h2>
          <ContractorFiles contractorId={contractor.id} />
        </Card>
        <Card>
          <h2 className={section}>Contracts and payments</h2>
          <PropertyContracts contractorId={contractor.id} events={[contractor.event]} />
        </Card>
        <Card>
          <h2 className={section}>Tasks</h2>
          <RelatedTasks preset={{ contractorId: contractor.id, eventId: contractor.eventId }} />
        </Card>
        <ContractorForm contractor={contractor} />
        <Card>
          <h2 className={section}>Updates</h2>
          <UpdateThread contractorId={contractor.id} />
        </Card>
        <HistorySection entity="Contractor" entityId={contractor.id} />
      </div>
    </>
  );
}
