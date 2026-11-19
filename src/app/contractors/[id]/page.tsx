import { notFound, redirect } from "next/navigation";

import { HistorySection } from "~/app/_components/activity-log";
import { ContractorEvents, ContractorForm, ContractorProperties } from "~/app/_components/contractors";
import { PropertyContracts } from "~/app/_components/finance";
import { RelatedTasks } from "~/app/_components/tasks";
import { Card, PageHeader } from "~/app/_components/ui";
import { UpdateThread } from "~/app/_components/update-thread";
import { contractorWhat } from "~/lib/contractors";
import { auth } from "~/server/auth";
import { api } from "~/trpc/server";

export const metadata = { title: "Contractor" };

/**
 * One contractor (doc §3.11): its details and contacts, the events it works
 * on, the properties it serves, its contracts and payments per event, its
 * tasks and its updates.
 */
export default async function ContractorPage({ params, searchParams }: { params: Promise<{ id: string }>; searchParams: Promise<{ back?: string }> }) {
  const session = await auth();
  if (!session?.user) redirect("/signin");
  const { id } = await params;
  const contractor = await api.contractor.byId({ id });
  if (!contractor) notFound();
  const { back } = await searchParams;
  const backTo = back && /^\/events\/[A-Za-z0-9]+\/contractors$/.test(back) ? back : undefined;
  const section = "text-ink-900 mb-3 text-[15px] font-medium";

  return (
    <>
      <PageHeader back={backTo ? { href: backTo, label: "Back to the event's contractors" } : { href: "/contractors", label: "All contractors" }} title={contractor.name} subtitle={contractorWhat(contractor)} />
      <div className="max-w-5xl space-y-6">
        <Card>
          <h2 className={section}>Events</h2>
          <ContractorEvents contractor={contractor} />
        </Card>
        <Card>
          <h2 className={section}>Properties it serves</h2>
          <ContractorProperties contractor={contractor} />
        </Card>
        <Card>
          <h2 className={section}>Contracts and payments</h2>
          <PropertyContracts contractorId={contractor.id} events={contractor.events.map((entry) => entry.event)} />
        </Card>
        <Card>
          <h2 className={section}>Tasks</h2>
          <RelatedTasks preset={{ contractorId: contractor.id, eventId: contractor.events.length === 1 ? contractor.events[0]!.eventId : undefined }} />
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
