import { redirect } from "next/navigation";

import { AgreementReview } from "~/app/_components/agreement";
import { auth } from "~/server/auth";

/**
 * An offer's agreement, filled from the framework, to review, save as a PDF
 * and send by DocuSign (doc §4.11).
 */
export const metadata = { title: "Agreement" };

export default async function AgreementPage({ params }: { params: Promise<{ id: string }> }) {
  const session = await auth();
  if (!session?.user) redirect("/signin");
  const { id } = await params;
  return <AgreementReview offerId={id} />;
}
