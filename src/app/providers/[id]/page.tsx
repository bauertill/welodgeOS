import { notFound, redirect } from "next/navigation";

import { ProviderForm } from "~/app/_components/provider-form";
import { PageHeader } from "~/app/_components/ui";
import { auth } from "~/server/auth";
import { api } from "~/trpc/server";

export const metadata = { title: "Provider" };

export default async function ProviderPage({
  params,
  searchParams,
}: {
  params: Promise<{ id: string }>;
  searchParams: Promise<{ back?: string }>;
}) {
  const session = await auth();
  if (!session?.user) redirect("/signin");
  const { id } = await params;
  const provider = await api.provider.byId({ id });
  if (!provider) notFound();
  // A provider is reached through an event (doc §3.9), and "back" returns to
  // it. Only an event page is accepted.
  const { back } = await searchParams;
  const backTo = back && /^\/events\/[A-Za-z0-9]+$/.test(back) ? back : undefined;

  return (
    <>
      <PageHeader
        back={backTo ? { href: backTo, label: "Back to the event's properties" } : { href: "/events", label: "All events" }}
        title={provider.name}
        subtitle={`${provider.properties.length} ${provider.properties.length === 1 ? "property" : "properties"}`}
      />
      <ProviderForm provider={provider} backTo={backTo} />
    </>
  );
}
