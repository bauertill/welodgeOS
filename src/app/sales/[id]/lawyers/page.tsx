import { notFound, redirect } from "next/navigation";

import { PrintButton } from "~/app/_components/print-button";
import { PageHeader } from "~/app/_components/ui";
import { formatDate, formatMoney, formatRange } from "~/lib/format";
import { contractingFields } from "~/lib/sales";
import { auth } from "~/server/auth";
import { api } from "~/trpc/server";

export const metadata = { title: "Summary for the lawyers" };

const budgetBasis = { PER_ROOM_NIGHT: "per room per night", PER_PERSON_NIGHT: "per person per night", TOTAL: "in total" } as const;
const stateWords = { SOLD: "Sold", BLOCKED: "Blocked", REQUESTED: "Requested", CANCELLED: "Cancelled" } as const;

/**
 * Everything the lawyers need to draw up the client's contract, on one page
 * to print or save as a PDF and send (doc §4.11): who the client is and who
 * signs, the rooms and periods held for them, and our terms.
 */
export default async function LawyersSummaryPage({ params }: { params: Promise<{ id: string }> }) {
  const session = await auth();
  if (!session?.user) redirect("/signin");
  const { id } = await params;
  const request = await api.sales.byId({ id });
  if (!request) notFound();
  const rooms = await api.sales.rooms({ id });
  const held = (rooms?.rows ?? []).filter((row) => row.state === "SOLD" || row.state === "BLOCKED");

  const section = "border-ink-200/60 rounded-xl border bg-white p-5 print:rounded-none print:border-0 print:p-0 print:pt-4";
  const row = (label: string, value: string | null | undefined) => (
    <div key={label} className="flex gap-3 py-1">
      <dt className="text-ink-500 w-56 shrink-0">{label}</dt>
      <dd className="text-ink-900 min-w-0 whitespace-pre-line">{value?.trim() ? value : "—"}</dd>
    </div>
  );

  return (
    <div className="max-w-4xl">
      <div className="print:hidden">
        <PageHeader
          back={{ href: `/sales/${request.id}`, label: "The sales request" }}
          title="Summary for the lawyers"
          subtitle="Print it, or save it as a PDF, and send it to legal to draw up the contract."
          action={<PrintButton />}
        />
      </div>
      <div className="space-y-5 text-sm font-light">
        <div className={section}>
          <h1 className="text-ink-900 text-xl font-semibold">{request.client.name}</h1>
          <p className="text-ink-500 mt-1">
            {[request.event?.name, request.contact ? `Contact: ${request.contact.name}${request.contact.email ? `, ${request.contact.email}` : ""}` : null, `Prepared ${formatDate(new Date())}`]
              .filter(Boolean)
              .join(" · ")}
          </p>
        </div>

        <div className={section}>
          <h2 className="text-ink-900 mb-2 text-[15px] font-medium">The client and who signs</h2>
          <dl>{contractingFields.slice(0, 9).map((field) => row(field.label, request[field.key]))}</dl>
          {!request.contractingSubmittedAt && !request.tradeName && (
            <p className="mt-2 text-xs text-[#c03654] print:hidden">Not filled in yet — send the client their contracting link from the request.</p>
          )}
        </div>

        <div className={section}>
          <h2 className="text-ink-900 mb-2 text-[15px] font-medium">What they asked for</h2>
          <dl>
            {row("Rooms", request.roomCount ? String(request.roomCount) : null)}
            {row("Period", request.checkIn && request.checkOut ? formatRange(request.checkIn, request.checkOut) : null)}
            {row("Room types and occupancy", request.rooms)}
            {row(
              "Budget",
              request.budgetCents !== null && request.budgetCurrency
                ? `${formatMoney(request.budgetCents, request.budgetCurrency)} ${request.budgetBasis ? budgetBasis[request.budgetBasis] : ""}`
                : null,
            )}
          </dl>
        </div>

        <div className={section}>
          <h2 className="text-ink-900 mb-2 text-[15px] font-medium">The rooms held for them</h2>
          {held.length === 0 ? (
            <p className="text-ink-500">None blocked or sold yet.</p>
          ) : (
            <table className="w-full text-left">
              <thead>
                <tr className="text-ink-500 text-[11px] tracking-wider uppercase">
                  <th className="py-1.5 pr-3 font-medium">Property and room type</th>
                  <th className="py-1.5 pr-3 font-medium">Status</th>
                  <th className="py-1.5 pr-3 font-medium">Rooms</th>
                  <th className="py-1.5 pr-3 font-medium">Stay</th>
                  <th className="py-1.5 pr-3 font-medium">Per night</th>
                  <th className="py-1.5 font-medium">In all</th>
                </tr>
              </thead>
              <tbody>
                {held.map((line) => (
                  <tr key={`${line.categoryId}-${line.state}`} className="border-ink-200/60 border-t">
                    <td className="py-2 pr-3">
                      {line.propertyName} — {line.categoryName}
                    </td>
                    <td className="py-2 pr-3">{stateWords[line.state]}</td>
                    <td className="py-2 pr-3">
                      {line.rooms} ({line.nights} room-nights)
                    </td>
                    <td className="py-2 pr-3 whitespace-nowrap">{formatRange(line.from, new Date(line.to.getTime() + 86_400_000))}</td>
                    <td className="py-2 pr-3 whitespace-nowrap">{line.price ? formatMoney(line.price.cents, line.price.currency) : "Varies"}</td>
                    <td className="py-2 whitespace-nowrap">{line.value ? formatMoney(line.value.cents, line.value.currency) : "—"}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          )}
        </div>

        <div className={section}>
          <h2 className="text-ink-900 mb-2 text-[15px] font-medium">Our terms</h2>
          <dl>{contractingFields.slice(9).map((field) => row(field.label, request[field.key]))}</dl>
        </div>
      </div>
    </div>
  );
}
