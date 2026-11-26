import { redirect } from "next/navigation";

import { ChecklistTemplates } from "~/app/_components/checklist-templates";
import { PageHeader } from "~/app/_components/ui";
import { auth } from "~/server/auth";

export const metadata = { title: "Inspection checklists" };

/** The standard apartment checklists (doc §6.10) — kept here, adjusted per room type on an event's Operations tab. */
export default async function ChecklistsPage() {
  const session = await auth();
  if (!session?.user) redirect("/signin");
  return (
    <>
      <PageHeader title="Inspection checklists" subtitle="The standard apartment checklists — what to check works, and what should be there. Each room type starts from one and can be adjusted." />
      <ChecklistTemplates />
    </>
  );
}
