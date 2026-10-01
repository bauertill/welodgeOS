import { redirect } from "next/navigation";

import { CancellationsBoard } from "~/app/_components/finance";
import { PageHeader } from "~/app/_components/ui";
import { auth } from "~/server/auth";

export const metadata = { title: "Cancellations" };

export default async function CancellationsPage() {
  const session = await auth();
  if (!session?.user) redirect("/signin");
  return (
    <>
      <PageHeader
        title="Cancellation deadlines"
        subtitle="The cut-offs by which rooms may be given back — ours with suppliers, and clients' with us."
      />
      <CancellationsBoard />
    </>
  );
}
