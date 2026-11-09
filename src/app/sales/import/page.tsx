import { redirect } from "next/navigation";

import { MondayImport } from "~/app/_components/monday-import";
import { PageHeader } from "~/app/_components/ui";
import { auth } from "~/server/auth";

export const metadata = { title: "Import from monday.com" };

export default async function MondayImportPage() {
  const session = await auth();
  if (!session?.user) redirect("/signin");
  return (
    <>
      <PageHeader
        back={{ href: "/sales", label: "Sales requests" }}
        title="Import from monday.com"
        subtitle="Choose the file of monday deals, match monday's events to ours, check what each deal becomes, then import. Each deal becomes its own sales request at Initial interest."
      />
      <MondayImport />
    </>
  );
}
