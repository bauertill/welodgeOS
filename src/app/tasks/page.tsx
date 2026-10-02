import { redirect } from "next/navigation";

import { TaskBoard } from "~/app/_components/tasks";
import { PageHeader } from "~/app/_components/ui";
import { auth } from "~/server/auth";

export const metadata = { title: "Tasks" };

export default async function TasksPage() {
  const session = await auth();
  if (!session?.user) redirect("/signin");
  return (
    <>
      <PageHeader title="Tasks" subtitle="Everyone's work in one place — drag a card to move it on." />
      <TaskBoard />
    </>
  );
}
