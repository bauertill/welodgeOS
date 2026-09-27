import { notFound, redirect } from "next/navigation";

import { ProviderForm } from "~/app/_components/provider-form";
import { PageHeader } from "~/app/_components/ui";
import { auth } from "~/server/auth";
import { api } from "~/trpc/server";

export const metadata = { title: "Provider" };

export default async function ProviderPage({ params }: { params: Promise<{ id: string }> }) {
  const session = await auth();
  if (!session?.user) redirect("/signin");
  const { id } = await params;
  const provider = await api.provider.byId({ id });
  if (!provider) notFound();

  return (
    <>
      <PageHeader
        back={{ href: "/providers", label: "Providers" }}
        title={provider.name}
        subtitle={`${provider.properties.length} ${provider.properties.length === 1 ? "property" : "properties"}`}
      />
      <ProviderForm provider={provider} />
    </>
  );
}
