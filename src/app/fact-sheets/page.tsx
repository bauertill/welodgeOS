import { redirect } from "next/navigation";

import { FactSheetList } from "~/app/_components/fact-sheets";
import { PageHeader } from "~/app/_components/ui";
import { auth } from "~/server/auth";

export const metadata = { title: "Fact sheets" };

export default async function FactSheetsPage() {
  const session = await auth();
  if (!session?.user) redirect("/signin");
  return (
    <>
      <PageHeader
        title="Fact sheets"
        subtitle="PDFs for the newsletter. Each has a link for the download button: readers give their email to download it, and you see who did."
      />
      <FactSheetList />
    </>
  );
}
