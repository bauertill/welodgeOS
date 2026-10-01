import { notFound, redirect } from "next/navigation";

import { ActivityLog } from "~/app/_components/activity-log";
import { ContractView } from "~/app/_components/finance";
import { Card, PageHeader } from "~/app/_components/ui";
import { partyLabels } from "~/lib/finance";
import { auth } from "~/server/auth";
import { api } from "~/trpc/server";

export default async function ContractPage({ params }: { params: Promise<{ id: string }> }) {
  const session = await auth();
  if (!session?.user) redirect("/signin");
  const { id } = await params;
  const contract = await api.finance.contract({ id });
  if (!contract) notFound();
  return (
    <>
      <PageHeader
        back={{ href: "/finances/contracts", label: "Contracts" }}
        title={contract.name}
        subtitle={`${partyLabels[contract.party]} contract · ${contract.property?.name ?? contract.client?.name ?? ""} · ${contract.event.name}`}
      />
      <ContractView contract={contract} />
      <div className="mt-5">
        <Card>
          <h2 className="text-ink-900 mb-3 text-[15px] font-medium">History</h2>
          <ActivityLog entity="Contract" entityId={contract.id} />
        </Card>
      </div>
    </>
  );
}
