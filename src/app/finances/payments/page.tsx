import { redirect } from "next/navigation";

import { PaymentsBoard } from "~/app/_components/finance";
import { PageHeader } from "~/app/_components/ui";
import { auth } from "~/server/auth";

export const metadata = { title: "Payments" };

export default async function PaymentsPage() {
  const session = await auth();
  if (!session?.user) redirect("/signin");
  return (
    <>
      <PageHeader
        title="Payments"
        subtitle="What we owe suppliers and what clients owe us, from every contract's payment terms — soonest first."
      />
      <PaymentsBoard />
    </>
  );
}
