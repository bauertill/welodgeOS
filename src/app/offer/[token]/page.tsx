import { PrintButton } from "~/app/_components/print-button";
import { formatDate, formatMoney } from "~/lib/format";
import { percent } from "~/lib/finance";
import { api } from "~/trpc/server";

/**
 * An offer opened by the client from its link — no sign-in (doc §4.11, the
 * owner 2026-11-27). The rooms we offer them at our rates, how they pay, the
 * cancellation terms and how long it holds; it prints or saves as a PDF.
 * Shared before the contracting: the agreement follows once they agree.
 */
export const metadata = { title: "Offer — We Lodge", robots: { index: false, follow: false } };

export default async function SharedOfferPage({ params }: { params: Promise<{ token: string }> }) {
  const { token } = await params;
  const offer = await api.offer.shared({ token }).catch(() => null);
  if (!offer) {
    return (
      <div className="mx-auto mt-16 max-w-xl rounded-2xl bg-white p-8 text-center">
        <h1 className="text-ink-900 text-lg font-medium">This offer is not shared any more</h1>
        <p className="text-ink-500 mt-2 text-sm font-light">Please ask your contact at We Lodge for the latest one.</p>
      </div>
    );
  }
  const money = (cents: number) => formatMoney(cents, offer.currency);
  const th = "px-3 py-2.5 text-[11px] font-medium tracking-wide text-white uppercase whitespace-nowrap";
  const td = "px-3 py-2.5 align-top text-[13px]";

  return (
    <div className="mx-auto w-full max-w-5xl space-y-4 px-4 pt-6 pb-20 sm:px-8 sm:pt-10 print:max-w-none print:p-0">
      <div className="flex justify-end print:hidden">
        <PrintButton label="Save as PDF or print" />
      </div>
      <article className="landscape-page rounded-2xl bg-white px-5 py-7 shadow-[0_1px_3px_rgba(0,0,0,0.06)] sm:px-8 sm:py-9 print:rounded-none print:px-0 print:py-0 print:shadow-none">
        <header className="border-ink-200/70 flex flex-wrap items-start justify-between gap-6 border-b pb-6">
          <div>
            <p className="text-brand-700 text-[11px] font-medium tracking-[0.18em] uppercase">Offer</p>
            <h1 className="text-ink-900 mt-1 text-2xl font-semibold">{offer.event?.name ?? "Accommodation"}</h1>
            <p className="text-ink-500 mt-1 text-sm font-light">
              {[`Prepared for ${offer.clientName}`, `on ${formatDate(offer.madeOn)}`, offer.preparedBy ? `by ${offer.preparedBy}` : null].filter(Boolean).join(" ")}
            </p>
          </div>
          {/* eslint-disable-next-line @next/next/no-img-element -- an SVG needs no optimisation */}
          <img src="/welodge-logo.svg" alt="We Lodge" width={784} height={146} className="mt-1 h-7 w-auto shrink-0" />
        </header>

        <section className="mt-6">
          <h2 className="text-ink-900 mb-2 text-[15px] font-semibold">Rooms and rates</h2>
          <div className="overflow-x-auto rounded-xl print:overflow-visible">
            <table className="w-full min-w-[720px] text-left print:min-w-0">
              <thead className="bg-brand-500">
                <tr>
                  <th className={th}>Property</th>
                  <th className={th}>Room type</th>
                  <th className={`${th} text-right`}>Rooms</th>
                  <th className={th}>Check-in</th>
                  <th className={th}>Check-out</th>
                  <th className={`${th} text-right`}>Nights</th>
                  <th className={`${th} text-right`}>Per room per night</th>
                  <th className={`${th} text-right`}>Subtotal</th>
                </tr>
              </thead>
              <tbody className="divide-ink-200/70 divide-y">
                {offer.lines.map((line) => (
                  <tr key={line.id}>
                    <td className={`${td} text-ink-900 font-medium`}>
                      {line.property}
                      {line.city && <span className="text-ink-500 block text-xs font-light">{line.city}</span>}
                    </td>
                    <td className={`${td} text-ink-700`}>{line.roomType}</td>
                    <td className={`${td} text-right`}>{line.rooms}</td>
                    <td className={`${td} whitespace-nowrap`}>{formatDate(line.checkIn)}</td>
                    <td className={`${td} whitespace-nowrap`}>{formatDate(line.checkOut)}</td>
                    <td className={`${td} text-right`}>
                      {line.nights}
                      {line.rooms > 1 && <span className="text-ink-500 block text-xs font-light">{line.roomNights} room-nights</span>}
                    </td>
                    <td className={`${td} text-right whitespace-nowrap`}>{money(line.rateCents)}</td>
                    <td className={`${td} text-ink-900 text-right font-medium whitespace-nowrap`}>{money(line.totalCents)}</td>
                  </tr>
                ))}
              </tbody>
              <tfoot>
                <tr className="bg-brand-50">
                  <td className={`${td} text-ink-900 font-semibold`} colSpan={2}>
                    Total
                  </td>
                  <td className={`${td} text-right font-semibold`}>{offer.lines.reduce((sum, line) => sum + line.rooms, 0)}</td>
                  <td className={td} colSpan={2} />
                  <td className={`${td} text-right`}>
                    <span className="text-ink-500 text-xs font-light whitespace-nowrap">{offer.roomNights} room-nights</span>
                  </td>
                  <td className={td} />
                  <td className={`${td} text-ink-900 text-right text-[15px] font-semibold whitespace-nowrap`}>{money(offer.totalCents)}</td>
                </tr>
              </tfoot>
            </table>
          </div>
        </section>

        <div className="mt-6 grid gap-6 sm:grid-cols-2 print:grid-cols-2">
          {offer.payments.length > 0 && (
            <section className="break-inside-avoid">
              <h2 className="text-ink-900 mb-2 text-[15px] font-semibold">Payments</h2>
              <table className="w-full text-left">
                <tbody className="divide-ink-200/70 divide-y">
                  {offer.payments.map((payment, index) => (
                    <tr key={index}>
                      <td className={`${td} text-ink-700 pl-0`}>{payment.onSignature ? "On signature" : `By ${formatDate(payment.dueOn!)}`}</td>
                      <td className={`${td} text-right`}>{percent(payment.percentBasisPoints)}</td>
                      <td className={`${td} text-ink-900 pr-0 text-right font-medium whitespace-nowrap`}>{money(payment.amountCents)}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </section>
          )}
          {offer.cancellations.length > 0 && (
            <section className="break-inside-avoid">
              <h2 className="text-ink-900 mb-2 text-[15px] font-semibold">Cancellation</h2>
              <ul className="text-ink-700 space-y-1 text-[13px] font-light">
                {offer.cancellations.map((line, index) => (
                  <li key={index}>{line.charAt(0).toUpperCase() + line.slice(1)}</li>
                ))}
              </ul>
            </section>
          )}
          {offer.inclusions.length > 0 && (
            <section className="break-inside-avoid">
              <h2 className="text-ink-900 mb-2 text-[15px] font-semibold">The rates include</h2>
              <ul className="text-ink-700 list-inside list-disc space-y-0.5 text-[13px] font-light">
                {offer.inclusions.map((line, index) => (
                  <li key={index}>{line}</li>
                ))}
              </ul>
            </section>
          )}
          {offer.conditions.length > 0 && (
            <section className="break-inside-avoid">
              <h2 className="text-ink-900 mb-2 text-[15px] font-semibold">Special conditions</h2>
              <ul className="text-ink-700 list-inside list-disc space-y-0.5 text-[13px] font-light">
                {offer.conditions.map((line, index) => (
                  <li key={index}>{line}</li>
                ))}
              </ul>
            </section>
          )}
        </div>

        <section className="bg-brand-50/70 mt-6 rounded-xl px-5 py-4 break-inside-avoid">
          <p className="text-ink-900 text-[14px] font-medium">
            {offer.status === "OPEN" ? `This offer holds until ${formatDate(offer.validUntil)}.` : "This offer has been accepted."}
          </p>
          <p className="text-ink-700 mt-1 text-[13px] font-light">
            {offer.status === "OPEN"
              ? "Once you are happy with it, tell your contact at We Lodge — we then send the agreement to sign, with these rooms, rates and terms."
              : "The signed agreement sets out the rooms, rates and terms."}
          </p>
          <p className="text-ink-500 mt-2 text-[11px] font-light">Rates per room per night in {offer.currency}. Subject to the agreement. We Lodge · welodge.net</p>
        </section>
      </article>
    </div>
  );
}
