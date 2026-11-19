import { notFound, redirect } from "next/navigation";

import { StaggerEditor } from "~/app/_components/stagger/editor";
import { auth } from "~/server/auth";
import { api } from "~/trpc/server";

export const metadata = { title: "Stagger planner" };

/** One scenario in the editor (doc §4.12). */
export default async function StaggerScenarioPage({ params }: { params: Promise<{ id: string }> }) {
  const session = await auth();
  if (!session?.user) redirect("/signin");
  const { id } = await params;
  const scenario = await api.stagger.byId({ id });
  if (!scenario) notFound();
  if (scenario.archived) redirect("/stagger");
  return <StaggerEditor key={scenario.id} scenario={scenario} />;
}
