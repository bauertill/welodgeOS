import { notFound, redirect } from "next/navigation";

import { ActivityLog } from "~/app/_components/activity-log";
import { TaskView } from "~/app/_components/tasks";
import { Card, PageHeader } from "~/app/_components/ui";
import { auth } from "~/server/auth";
import { api } from "~/trpc/server";

export default async function TaskPage({ params }: { params: Promise<{ id: string }> }) {
  const session = await auth();
  if (!session?.user) redirect("/signin");
  const { id } = await params;
  const task = await api.task.byId({ id });
  if (!task) notFound();
  return (
    <>
      <PageHeader back={{ href: "/tasks", label: "Tasks" }} title={task.title} subtitle={task.type ? `${task.type.name} task` : "Task"} />
      <TaskView id={task.id} />
      <div className="mt-5">
        <Card>
          <h2 className="text-ink-900 mb-3 text-[15px] font-medium">Log</h2>
          <ActivityLog latestOnly entity="Task" entityId={task.id} />
        </Card>
      </div>
    </>
  );
}
