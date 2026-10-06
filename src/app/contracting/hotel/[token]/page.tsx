import { HotelContractingForm } from "~/app/_components/hotel-contracting-form";

/**
 * Opened by a hotel from its private link — no sign-in (doc §3.9). The link's
 * code is the only key; the page shows the hotel's contracting form and
 * nothing else of ours.
 */
export const metadata = { title: "Contracting details", robots: { index: false, follow: false } };

export default async function HotelContractingPage({ params }: { params: Promise<{ token: string }> }) {
  const { token } = await params;
  return (
    <div className="mx-auto max-w-3xl">
      {/* eslint-disable-next-line @next/next/no-img-element -- an SVG needs no optimisation */}
      <img src="/welodge-logo.svg" alt="We Lodge" width={784} height={146} className="mx-auto mb-8 h-7 w-auto" />
      <HotelContractingForm token={token} />
    </div>
  );
}
