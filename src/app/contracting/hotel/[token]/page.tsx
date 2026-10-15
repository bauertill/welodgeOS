import { redirect } from "next/navigation";

/** Links sent before the form covered all of a hotel's details (doc §3.9) still open it. */
export default async function OldHotelContractingPage({ params }: { params: Promise<{ token: string }> }) {
  const { token } = await params;
  redirect(`/property-details/${token}`);
}
