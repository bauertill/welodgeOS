import { notFound, redirect } from "next/navigation";

import { HistorySection } from "~/app/_components/activity-log";
import { ContractView } from "~/app/_components/finance";
import { PageHeader } from "~/app/_components/ui";
import { contractBack, partyLabels } from "~/lib/finance";
import { auth } from "~/server/auth";
import { api } from "~/trpc/server";

export default async function ContractPage({ params }: { params: Promise<{ id: string; contractId: string }> }) {
  const session = await auth();
  if (!session?.user) redirect("/signin");
  const { id, contractId } = await params;
  const contract = await api.finance.contract({ id: contractId });
  // A contract is found under its own event only.
  if (!contract || contract.event.id !== id) notFound();
  return (
    <>
      <PageHeader
        back={contractBack(contract)}
        title={contract.name}
        subtitle={`${partyLabels[contract.party]} contract · ${contract.property?.name ?? contract.client?.name ?? ""} · ${contract.event.name}`}
      />
      <ContractView contract={contract} />
      <HistorySection entity="Contract" entityId={contract.id} />
    </>
  );
}
