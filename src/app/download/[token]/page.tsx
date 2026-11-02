import { DownloadForm } from "~/app/_components/fact-sheets";

/**
 * Opened by a newsletter reader from a download button — no sign-in (doc
 * §4.12). It shows the fact sheet's title, asks for an email, and hands over
 * the PDF; nothing else of ours.
 */
export const metadata = { title: "Download", robots: { index: false, follow: false } };

export default async function DownloadPage({ params }: { params: Promise<{ token: string }> }) {
  const { token } = await params;
  return (
    <div className="mx-auto max-w-lg">
      {/* eslint-disable-next-line @next/next/no-img-element -- an SVG needs no optimisation */}
      <img src="/welodge-logo.svg" alt="We Lodge" width={784} height={146} className="mx-auto mb-8 h-7 w-auto" />
      <DownloadForm token={token} />
    </div>
  );
}
