import { redirect } from "next/navigation";

import { ProviderList } from "~/app/_components/provider-form";
import { PageHeader } from "~/app/_components/ui";
import { auth } from "~/server/auth";

export const metadata = { title: "Providers" };

export default async function ProvidersPage() {
  const session = await auth();
  if (!session?.user) redirect("/signin");

  return (
    <>
      <PageHeader
        title="Providers"
        subtitle="The hotel chains and groups our properties belong to. One provider has many properties."
      />
      <ProviderList />
    </>
  );
}
