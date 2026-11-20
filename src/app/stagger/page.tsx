import { redirect } from "next/navigation";

import { StaggerList } from "~/app/_components/stagger/editor";
import { PageHeader } from "~/app/_components/ui";
import { auth } from "~/server/auth";

export const metadata = { title: "Stagger planner" };

/** Sales › Stagger planner (doc §4.12): every scenario. */
export default async function StaggerPage() {
  const session = await auth();
  if (!session?.user) redirect("/signin");
  return (
    <>
      <PageHeader title="Stagger planner" subtitle="How a client's apartments arrive and leave in waves, and the rent the owner earns — edited here, shown to the owner by a read-only link." />
      <StaggerList />
    </>
  );
}
