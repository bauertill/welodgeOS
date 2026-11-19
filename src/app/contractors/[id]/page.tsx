import { notFound, redirect } from "next/navigation";

import { contractorHref } from "~/lib/contractors";
import { auth } from "~/server/auth";
import { api } from "~/trpc/server";

/** Older links to a contractor (an email, a task, an update) open it on its event (doc §3.11). */
export default async function ContractorRedirect({ params }: { params: Promise<{ id: string }> }) {
  const session = await auth();
  if (!session?.user) redirect("/signin");
  const { id } = await params;
  const contractor = await api.contractor.byId({ id });
  if (!contractor) notFound();
  redirect(contractorHref(contractor.eventId, contractor.id));
}
