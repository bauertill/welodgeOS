import { PrintButton } from "~/app/_components/print-button";
import { RateCardView } from "~/app/_components/rate-card-view";
import { api } from "~/trpc/server";

/**
 * A rate card opened by the client from its link — no sign-in (doc §4.11).
 * The link's code is the only key; the page shows the card, never our
 * buying rates.
 */
export const metadata = { title: "Rate card — We Lodge", robots: { index: false, follow: false } };

export default async function SharedRateCardPage({ params }: { params: Promise<{ token: string }> }) {
  const { token } = await params;
  const card = await api.rateCard.shared({ token }).catch(() => null);
  if (!card) {
    return (
      <div className="mx-auto max-w-xl rounded-2xl bg-white p-8 text-center">
        <h1 className="text-ink-900 text-lg font-medium">This rate card is not shared any more</h1>
        <p className="text-ink-500 mt-2 text-sm font-light">Please ask your contact at We Lodge for the latest one.</p>
      </div>
    );
  }
  return (
    <div className="space-y-4">
      <div className="mx-auto flex max-w-3xl justify-end print:hidden">
        <PrintButton />
      </div>
      <RateCardView card={card} />
    </div>
  );
}
