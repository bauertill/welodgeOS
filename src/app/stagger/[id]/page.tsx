import { type Metadata } from "next";
import { notFound, redirect } from "next/navigation";

import { StaggerEditor } from "~/app/_components/stagger/editor";
import { LeaseEditor } from "~/app/_components/stagger/lease";
import { leaseTitle } from "~/lib/stagger-lease-model";
import { pageTitle } from "~/lib/stagger-model";
import { auth } from "~/server/auth";
import { api } from "~/trpc/server";

/** The reference's title ("Decron Apartments OBS"), which is also the saved PDF's name. */
export async function generateMetadata({ params }: { params: Promise<{ id: string }> }): Promise<Metadata> {
  const { id } = await params;
  const scenario = await api.stagger.byId({ id }).catch(() => null);
  if (!scenario) return { title: "Stagger planner" };
  return { title: { absolute: scenario.kind === "lease" ? leaseTitle(scenario.lease) : pageTitle(scenario.clientLabel) } };
}

/** One scenario in the editor (doc §4.12). */
export default async function StaggerScenarioPage({ params }: { params: Promise<{ id: string }> }) {
  const session = await auth();
  if (!session?.user) redirect("/signin");
  const { id } = await params;
  const scenario = await api.stagger.byId({ id });
  if (!scenario) notFound();
  if (scenario.archived) redirect("/stagger");
  return scenario.kind === "lease" ? <LeaseEditor key={scenario.id} scenario={scenario} /> : <StaggerEditor key={scenario.id} scenario={scenario} />;
}
