import { redirect } from "next/navigation";

import { UpdateBoard } from "~/app/_components/update-board";
import { PageHeader } from "~/app/_components/ui";
import { auth } from "~/server/auth";

export const metadata = { title: "Updates" };

export default async function UpdatesPage({ searchParams }: { searchParams: Promise<{ tab?: string }> }) {
  const session = await auth();
  if (!session?.user) redirect("/signin");
  const { tab } = await searchParams;
  return (
    <>
      <PageHeader title="Updates" subtitle="What the team should know — on clients, accommodation, other providers, or for everyone." />
      <UpdateBoard initialTab={tab} />
    </>
  );
}
