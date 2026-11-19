import { redirect } from "next/navigation";

import { ContractorList } from "~/app/_components/contractors";
import { PageHeader } from "~/app/_components/ui";
import { auth } from "~/server/auth";

export const metadata = { title: "Contractors" };

/** Every contractor we use besides the hotels — furniture, cleaning… (doc §3.11). */
export default async function ContractorsPage() {
  const session = await auth();
  if (!session?.user) redirect("/signin");
  return (
    <>
      <PageHeader title="Contractors" subtitle="The furniture, cleaning and other companies we use besides the hotels — their contacts, events, properties, contracts and payments." />
      <ContractorList />
    </>
  );
}
