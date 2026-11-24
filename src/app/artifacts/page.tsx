import { redirect } from "next/navigation";

import { ArtifactList } from "~/app/_components/artifacts";
import { PageHeader } from "~/app/_components/ui";
import { auth } from "~/server/auth";

export const metadata = { title: "Artifacts" };

/** Sales › Artifacts (doc §4.13): pages made with Claude, kept here and shared with clients by a link. */
export default async function ArtifactsPage() {
  const session = await auth();
  if (!session?.user) redirect("/signin");
  return (
    <>
      <PageHeader title="Artifacts" subtitle="Presentations, comparisons and proposals made with Claude — kept here, and shown to a client by a link at os.welodge.net." />
      <ArtifactList />
    </>
  );
}
