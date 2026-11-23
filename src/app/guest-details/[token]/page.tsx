import { GuestDetailsForm } from "~/app/_components/guest-details-form";

/**
 * Opened by a property from its private link — no sign-in (doc §6.8). The
 * link's code is the only key; the page shows its guest information form and
 * nothing else of ours.
 */
export const metadata = { title: "Guest information — We Lodge", robots: { index: false, follow: false } };

export default async function GuestDetailsPage({ params }: { params: Promise<{ token: string }> }) {
  const { token } = await params;
  return (
    <div className="mx-auto max-w-3xl px-4 py-8">
      {/* eslint-disable-next-line @next/next/no-img-element -- an SVG needs no optimisation */}
      <img src="/welodge-logo.svg" alt="We Lodge" width={784} height={146} className="mx-auto mb-8 h-7 w-auto" />
      <GuestDetailsForm token={token} />
    </div>
  );
}
