import Link from "next/link";
import { redirect } from "next/navigation";

import { SalesRequestList } from "~/app/_components/sales-requests";
import { PageHeader } from "~/app/_components/ui";
import { auth } from "~/server/auth";

export const metadata = { title: "Sales requests" };

export default async function SalesRequestsPage() {
  const session = await auth();
  if (!session?.user) redirect("/signin");

  return (
    <>
      <PageHeader
        title="Sales requests"
        subtitle="Every client's interest, from the first enquiry until it is signed, released, lost or never answered — and who to follow up with."
        action={
          <Link
            href="/sales/new"
            className="bg-brand-400 hover:bg-brand-500 rounded-full px-5 py-2.5 text-[13px] font-medium text-white"
          >
            + New sales request
          </Link>
        }
      />
      <SalesRequestList />
    </>
  );
}
