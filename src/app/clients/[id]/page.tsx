import { notFound, redirect } from "next/navigation";

import { ActivityLog } from "~/app/_components/activity-log";
import { UpdateThread } from "~/app/_components/update-thread";
import { Card, PageHeader } from "~/app/_components/ui";
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
        back={{ href: "/clients", label: "All clients" }}
        title={client.name}
        subtitle={client.shortName ?? undefined}
      />

      <div className="grid gap-5 lg:grid-cols-3">
        <div className="space-y-5 lg:col-span-2">
          <Card>
            <h2 className="text-ink-900 mb-3 text-[15px] font-medium">
              Updates
            </h2>
            <UpdateThread clientId={client.id} />
          </Card>
        </div>

        <div className="space-y-5">
          <Card>
            <h2 className="text-ink-900 mb-3 text-[15px] font-medium">
              At a glance
            </h2>
            <dl className="space-y-2 text-sm font-light">
              <Row label="Room-nights held" value={String(client._count.roomNights)} />
              <Row label="Requests open" value={String(client._count.requests)} />
            </dl>
          </Card>

          {client.notes && (
            <Card>
              <h2 className="text-ink-900 mb-2 text-[15px] font-medium">
                Notes
              </h2>
              <p className="text-ink-500 text-sm font-light whitespace-pre-line">
                {client.notes}
              </p>
            </Card>
          )}

          <Card>
            <h2 className="text-ink-900 mb-3 text-[15px] font-medium">
              Activity
            </h2>
            <ActivityLog entity="Client" entityId={client.id} />
          </Card>
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
