import { redirect } from "next/navigation";

import { HistorySection } from "~/app/_components/activity-log";
import { FactSheetView } from "~/app/_components/fact-sheets";
import { PageHeader } from "~/app/_components/ui";
import { auth } from "~/server/auth";

export const metadata = { title: "Fact sheet" };

export default async function FactSheetPage({ params }: { params: Promise<{ id: string }> }) {
  const session = await auth();
  if (!session?.user) redirect("/signin");
  const { id } = await params;
  return (
    <>
      <PageHeader back={{ href: "/fact-sheets", label: "Fact sheets" }} title="Fact sheet" />
      <FactSheetView id={id} />
      <HistorySection entity="FactSheet" entityId={id} />
    </>
  );
}
