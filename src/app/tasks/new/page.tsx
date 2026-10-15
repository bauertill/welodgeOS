import { redirect } from "next/navigation";

import { TaskForm } from "~/app/_components/tasks";
import { Card, PageHeader } from "~/app/_components/ui";
import { auth } from "~/server/auth";

export const metadata = { title: "New task" };

export default async function NewTaskPage({
  searchParams,
}: {
  searchParams: Promise<{ event?: string; property?: string; client?: string; request?: string }>;
}) {
  const session = await auth();
  if (!session?.user) redirect("/signin");
  const { event, property, client, request } = await searchParams;
  return (
    <>
      <PageHeader back={{ href: "/tasks", label: "Tasks" }} title="New task" subtitle="What it is, who completes it, and by when." />
      <Card>
        <TaskForm preset={{ eventId: event, propertyId: property, clientId: client, salesRequestId: request }} />
      </Card>
    </>
  );
}
