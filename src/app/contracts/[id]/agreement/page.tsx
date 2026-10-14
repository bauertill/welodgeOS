import { redirect } from "next/navigation";

import { HotelAgreementReview } from "~/app/_components/agreement";
import { auth } from "~/server/auth";

/** Our agreement with a hotel, filled from its quote and contract, to review and send (doc §4.11). */
export const metadata = { title: "Hotel agreement" };

export default async function HotelAgreementPage({ params }: { params: Promise<{ id: string }> }) {
  const session = await auth();
  if (!session?.user) redirect("/signin");
  const { id } = await params;
  return <HotelAgreementReview contractId={id} />;
}
