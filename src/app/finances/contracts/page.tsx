import Link from "next/link";
import { redirect } from "next/navigation";

import { ContractsList } from "~/app/_components/finance";
import { PageHeader } from "~/app/_components/ui";
import { auth } from "~/server/auth";

export const metadata = { title: "Contracts" };

export default async function ContractsPage() {
  const session = await auth();
  if (!session?.user) redirect("/signin");
  return (
    <>
      <PageHeader
        title="Contracts"
        subtitle="Every signed contract with a supplier or a client, with its payment and cancellation terms."
        action={
          <Link href="/finances/contracts/new" className="bg-brand-400 hover:bg-brand-500 rounded-full px-5 py-2.5 text-[13px] font-medium text-white">
            + New contract
          </Link>
        }
      />
      <ContractsList />
    </>
  );
}
