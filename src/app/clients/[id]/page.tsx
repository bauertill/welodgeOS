import { notFound, redirect } from "next/navigation";

import { HistorySection } from "~/app/_components/activity-log";
import { ClientContactsCard, ClientDetailsCard, ClientContractingCard, DeleteClient } from "~/app/_components/client-crm";
import { ClientContracts, ClientSalesRequests } from "~/app/_components/sales-requests";
import { UpdateThread } from "~/app/_components/update-thread";
import { ClientEmails } from "~/app/_components/client-emails";
import { Card, PageHeader } from "~/app/_components/ui";
import { clientCategoryLabels } from "~/lib/clients";
import { auth } from "~/server/auth";
import { api } from "~/trpc/server";

export default async function ClientPage({
  params,
}: {
  params: Promise<{ id: string }>;
}) {
  const session = await auth();
  if (!session?.user) redirect("/signin");

  const { id } = await params;
  const client = await api.clients.byId({ id });
  if (!client) notFound();

  return (
    <>
      <PageHeader
        back={{ href: "/clients", label: "Clients" }}
        title={client.name}
        subtitle={
          [client.shortName, client.category ? clientCategoryLabels[client.category] : null]
            .filter(Boolean)
            .join(" · ") || undefined
        }
      />

      {/* Full width: a contact has too many columns for the narrower side. */}
      <div className="mb-5">
        <ClientContactsCard client={client} />
      </div>

      <div className="grid gap-5 lg:grid-cols-3">
        <div className="space-y-5 lg:col-span-2">
          <ClientSalesRequests clientId={client.id} />
          <ClientContracts clientId={client.id} />

          <Card>
            <h2 className="text-ink-900 mb-3 text-[15px] font-medium">
              Updates
            </h2>
            <UpdateThread clientId={client.id} />
          </Card>

          {/* Every email the team has with the client's people, from connected Gmail (doc §4.10). */}
          <Card>
            <h2 className="text-ink-900 mb-3 text-[15px] font-medium">Emails</h2>
            <ClientEmails clientId={client.id} contacts={client.contacts.map((contact) => ({ id: contact.id, name: contact.name, email: contact.email }))} />
          </Card>
        </div>

        <div className="space-y-5">
          <ClientDetailsCard client={client} />
          <ClientContractingCard client={client} />

          <Card>
            <h2 className="text-ink-900 mb-3 text-[15px] font-medium">
              At a glance
            </h2>
            <dl className="space-y-2 text-sm font-light">
              <Row label="Room-nights sold" value={String(client._count.roomNights)} />
              <Row label="Sales requests open" value={String(client._count.salesRequests)} />
            </dl>
          </Card>
          <HistorySection entity="Client" entityId={client.id} className="" />
          <DeleteClient clientId={client.id} name={client.name} />
        </div>
      </div>
    </>
  );
}

function Row({ label, value }: { label: string; value?: string | null }) {
  return (
    <div className="flex gap-3">
      <dt className="text-ink-500 w-32 shrink-0">{label}</dt>
      <dd className="text-ink-900 min-w-0 break-words">{value ?? "—"}</dd>
    </div>
  );
}
