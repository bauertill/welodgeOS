import { type Metadata } from "next";
import { notFound, redirect } from "next/navigation";

import { ArtifactView } from "~/app/_components/artifacts";
import { auth } from "~/server/auth";
import { api } from "~/trpc/server";

export async function generateMetadata({ params }: { params: Promise<{ id: string }> }): Promise<Metadata> {
  const { id } = await params;
  const artifact = await api.artifact.byId({ id }).catch(() => null);
  return { title: artifact?.title ?? "Artifact" };
}

/** One artifact (doc §4.13): the page, its client link, a new page, earlier versions. */
export default async function ArtifactPage({ params }: { params: Promise<{ id: string }> }) {
  const session = await auth();
  if (!session?.user) redirect("/signin");
  const { id } = await params;
  const artifact = await api.artifact.byId({ id });
  if (!artifact) notFound();
  if (artifact.archived) redirect("/artifacts");
  return <ArtifactView key={artifact.id} artifact={artifact} />;
}
