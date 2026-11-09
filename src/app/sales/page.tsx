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
        subtitle="Every client's interest, from the first enquiry until it is contracted, lost or declined — and who to follow up with."
        action={
          <div className="flex items-center gap-4">
            {/* Bringing monday.com's sales requests in (doc §4.11, 2026-11-09). */}
            <Link href="/sales/import" className="text-brand-700 text-[13px] font-light hover:underline">
              Import from monday.com
            </Link>
            <Link
              href="/sales/new"
              className="bg-brand-400 hover:bg-brand-500 rounded-full px-5 py-2.5 text-[13px] font-medium text-white"
            >
              + New sales request
            </Link>
          </div>
        }
      />
      <SalesRequestList />
    </>
  );
}
