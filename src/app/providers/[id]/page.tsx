import { notFound, redirect } from "next/navigation";

import { ProviderForm } from "~/app/_components/provider-form";
import { SiteVisitList } from "~/app/_components/site-visits";
import { Card, PageHeader } from "~/app/_components/ui";
import { UpdateThread } from "~/app/_components/update-thread";
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
      {/* The chain's own updates — shown on each of its properties too — and theirs (doc §2.6). */}
      <Card className="mt-8">
        <h2 className="text-ink-900 mb-3 text-[15px] font-medium">Site visits</h2>
        <SiteVisitList providerId={provider.id} />
      </Card>
      <Card className="mt-8">
        <h2 className="text-ink-900 mb-3 text-[15px] font-medium">Updates</h2>
        <UpdateThread providerId={provider.id} />
      </Card>
    </>
  );
}
