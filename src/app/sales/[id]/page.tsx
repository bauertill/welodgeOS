import { notFound, redirect } from "next/navigation";

import { ActivityLog } from "~/app/_components/activity-log";
import { SalesRequestView } from "~/app/_components/sales-requests";
import { Card, PageHeader } from "~/app/_components/ui";
import { auth } from "~/server/auth";
import { api } from "~/trpc/server";

export default async function SalesRequestPage({ params }: { params: Promise<{ id: string }> }) {
  const session = await auth();
  if (!session?.user) redirect("/signin");

  const { id } = await params;
  const request = await api.sales.byId({ id });
  if (!request) notFound();

  return (
    <>
      <PageHeader
        back={{ href: "/sales", label: "Sales requests" }}
        title={request.client.name}
        subtitle={[request.event?.name ?? "No event", request.contact?.name].filter(Boolean).join(" · ")}
      />
      <SalesRequestView request={request} />
      <div className="mt-5">
        <Card>
          <h2 className="text-ink-900 mb-3 text-[15px] font-medium">History</h2>
          <ActivityLog entity="SalesRequest" entityId={request.id} />
        </Card>
      </div>
    </>
  );
}
