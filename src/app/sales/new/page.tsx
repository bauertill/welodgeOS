import { redirect } from "next/navigation";

import { NewSalesRequestForm } from "~/app/_components/sales-requests";
import { PageHeader } from "~/app/_components/ui";
import { auth } from "~/server/auth";

export const metadata = { title: "New sales request" };

export default async function NewSalesRequestPage({
  searchParams,
}: {
  searchParams: Promise<{ client?: string; addendumTo?: string }>;
}) {
  const session = await auth();
  if (!session?.user) redirect("/signin");
  const { client, addendumTo } = await searchParams;

  return (
    <>
      <PageHeader
        back={{ href: "/sales", label: "Sales requests" }}
        title={addendumTo ? "New addendum" : "New enquiry"}
        subtitle={
          addendumTo
            ? "More rooms, or a change, under an agreement the client already has — followed like any request, from the offer to the signed addendum."
            : "Register it as soon as a client shows interest, however vague — it becomes a sales request once the details are in."
        }
      />
      <NewSalesRequestForm me={session.user.id} clientId={client} addendumTo={addendumTo} />
    </>
  );
}
