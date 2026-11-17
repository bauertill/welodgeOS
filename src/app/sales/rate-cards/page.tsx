import { redirect } from "next/navigation";

import { RateCardList } from "~/app/_components/rate-card-list";
import { PageHeader } from "~/app/_components/ui";
import { auth } from "~/server/auth";

export const metadata = { title: "Rate cards" };

/** Sales › Rate cards (doc §4.11, the owner, 2026-11-17): every rate card, made and sent, in one place. */
export default async function RateCardsPage({ searchParams }: { searchParams: Promise<{ event?: string }> }) {
  const session = await auth();
  if (!session?.user) redirect("/signin");
  const { event } = await searchParams;

  return (
    <>
      <PageHeader title="Rate cards" subtitle="Every rate card — who it was sent to, for which event, whether the client has the link and what they answered. Make a new one here." />
      <RateCardList eventId={event} />
    </>
  );
}
