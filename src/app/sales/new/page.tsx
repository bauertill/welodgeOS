import { redirect } from "next/navigation";

import { NewSalesRequestForm } from "~/app/_components/sales-requests";
import { PageHeader } from "~/app/_components/ui";
import { auth } from "~/server/auth";

export const metadata = { title: "New sales request" };

export default async function NewSalesRequestPage({
  searchParams,
}: {
  searchParams: Promise<{ client?: string }>;
}) {
  const session = await auth();
  if (!session?.user) redirect("/signin");
  const { client } = await searchParams;

  return (
    <>
      <PageHeader
        back={{ href: "/sales", label: "Sales requests" }}
        title="New sales request"
        subtitle="Register it as soon as a client shares their first interest, so it is followed through to the end."
      />
      <NewSalesRequestForm me={session.user.id} clientId={client} />
    </>
  );
}
