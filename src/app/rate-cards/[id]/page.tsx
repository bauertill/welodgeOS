import { notFound, redirect } from "next/navigation";

import { PrintButton } from "~/app/_components/print-button";
import { RateCardView } from "~/app/_components/rate-card-view";
import { clientCopy } from "~/server/api/routers/rate-card";
import { auth } from "~/server/auth";
import { api } from "~/trpc/server";

/**
 * A rate card as the client sees it, for the team to print or save as a PDF
 * (doc §4.11) — the saved card, without our buying rates.
 */
export const metadata = { title: "Rate card" };

export default async function PrintRateCardPage({ params }: { params: Promise<{ id: string }> }) {
  const session = await auth();
  if (!session?.user) redirect("/signin");
  const { id } = await params;
  const card = await api.rateCard.byId({ id }).catch(() => null);
  if (!card) notFound();
  return (
    <div className="space-y-4">
      <div className="mx-auto flex max-w-3xl items-center justify-between gap-3 print:hidden">
        <p className="text-ink-500 text-sm font-light">What the client sees — the saved card, without our buying rates.</p>
        <PrintButton />
      </div>
      <RateCardView card={clientCopy(card)} />
    </div>
  );
}
