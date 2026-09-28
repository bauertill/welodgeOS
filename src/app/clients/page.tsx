import { redirect } from "next/navigation";

import { ClientList } from "~/app/_components/client-list";
import { PageHeader } from "~/app/_components/ui";
import { auth } from "~/server/auth";

export const metadata = { title: "Clients" };

export default async function ClientsPage() {
  const session = await auth();
  if (!session?.user) redirect("/signin");

  return (
    <>
      <PageHeader
        title="Clients"
        subtitle="The companies we sell room-nights to, or hope to, and the people there. A client is global — the same buyer comes back for the next event."
      />
      <ClientList />
    </>
  );
}
