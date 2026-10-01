import { redirect } from "next/navigation";

import { NewContractForm } from "~/app/_components/finance";
import { PageHeader } from "~/app/_components/ui";
import { auth } from "~/server/auth";
import { api } from "~/trpc/server";

export const metadata = { title: "New contract" };

export default async function NewContractPage({
  searchParams,
}: {
  searchParams: Promise<{ request?: string; event?: string; property?: string }>;
}) {
  const session = await auth();
  if (!session?.user) redirect("/signin");
  const { request: requestId, event, property } = await searchParams;
  // From a sales request: a client contract for that client and event, worth what the request is.
  const request = requestId ? await api.sales.byId({ id: requestId }) : null;
  return (
    <>
      <PageHeader
        back={request ? { href: `/sales/${request.id}`, label: "The sales request" } : { href: "/finances/contracts", label: "Contracts" }}
        title="New contract"
        subtitle="Who it is with, its total and the signed PDF. Its payment and cancellation terms come next."
      />
      <NewContractForm
        preset={
          request
            ? {
                party: "CLIENT",
                eventId: request.event?.id,
                clientId: request.client.id,
                salesRequestId: request.id,
                totalCents: request.valueCents,
                currency: request.valueCurrency,
              }
            : { party: property ? "SUPPLIER" : undefined, eventId: event, propertyId: property }
        }
      />
    </>
  );
}
