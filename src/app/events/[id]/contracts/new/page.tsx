import { notFound, redirect } from "next/navigation";

import { NewContractForm } from "~/app/_components/finance";
import { PageHeader } from "~/app/_components/ui";
import { auth } from "~/server/auth";
import { api } from "~/trpc/server";

export const metadata = { title: "New contract" };

export default async function NewContractPage({
  params,
  searchParams,
}: {
  params: Promise<{ id: string }>;
  searchParams: Promise<{ request?: string; property?: string; sign?: string }>;
}) {
  const session = await auth();
  if (!session?.user) redirect("/signin");
  const { id } = await params;
  const event = await api.event.byId({ id });
  if (!event) notFound();
  const { request: requestId, property, sign } = await searchParams;
  // From a sales request: a client contract for that client, worth what the request is.
  const request = requestId ? await api.sales.byId({ id: requestId }) : null;
  return (
    <>
      <PageHeader
        back={
          request
            ? { href: `/sales/${request.id}`, label: "The sales request" }
            : property
              ? { href: `/properties/${property}?back=${encodeURIComponent(`/events/${event.id}`)}#contracts`, label: "The property" }
              : { href: `/events/${event.id}`, label: event.name }
        }
        title="New contract"
        subtitle={
          request && sign
            ? `${request.client.name} has signed: register their contract for ${event.name}, and the request is marked signed with it. Its payment and cancellation terms come next.`
            : `For ${event.name}. Who it is with, its total and the signed PDF — its payment and cancellation terms come next.`
        }
      />
      <NewContractForm
        preset={
          request
            ? {
                party: "CLIENT",
                eventId: event.id,
                eventName: event.name,
                clientId: request.client.id,
                salesRequestId: request.id,
                markRequestSigned: Boolean(sign),
                totalCents: request.valueCents,
                currency: request.valueCurrency,
              }
            : { party: property ? "SUPPLIER" : undefined, eventId: event.id, eventName: event.name, propertyId: property }
        }
      />
    </>
  );
}
