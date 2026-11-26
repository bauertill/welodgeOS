import { redirect } from "next/navigation";

import { InspectionRunner } from "~/app/_components/inspection-runner";
import { auth } from "~/server/auth";

export const metadata = { title: "Inspection" };

/** An apartment inspection (doc §6.10) — walked on a phone, read in the office. */
export default async function InspectionPage({ params }: { params: Promise<{ id: string }> }) {
  const session = await auth();
  if (!session?.user) redirect("/signin");
  const { id } = await params;
  return <InspectionRunner id={id} />;
}
