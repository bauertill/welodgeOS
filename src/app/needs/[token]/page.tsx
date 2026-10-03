import { NeedsForm } from "~/app/_components/sales-details";

/**
 * Opened by a client from their private needs link — no sign-in (doc §4.11).
 * The link's code is the only key; the page shows the form and nothing else
 * of ours.
 */
export const metadata = { title: "Your accommodation", robots: { index: false, follow: false } };

export default async function NeedsPage({ params }: { params: Promise<{ token: string }> }) {
  const { token } = await params;
  return (
    <div className="mx-auto max-w-2xl">
      {/* eslint-disable-next-line @next/next/no-img-element -- an SVG needs no optimisation */}
      <img src="/welodge-logo.svg" alt="We Lodge" width={784} height={146} className="mx-auto mb-8 h-7 w-auto" />
      <NeedsForm token={token} />
    </div>
  );
}
