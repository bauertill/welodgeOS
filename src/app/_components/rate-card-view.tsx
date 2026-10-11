import { Fragment } from "react";

import { nightsBetween } from "~/lib/dates";
import { formatMoney, formatRange } from "~/lib/format";
import { propertyTypeLabels } from "~/lib/scouting";

/**
 * A rate card as the client sees it (doc §4.11) — the preview in the editor,
 * the page behind the client's link and the printout are this one design:
 * our logo, what was asked for, then each property with a word on it, how
 * far it is from the venue and its rooms at our selling rate. Never a buying
 * rate: the data it is given has none.
 */
export type ClientRateCard = {
  name: string;
  currency: string;
  intro: string | null;
  clientName: string;
  event: { name: string; startDate: Date; endDate: Date } | null;
  asked: { rooms: number; roomType: string | null; checkIn: Date | null; checkOut: Date | null }[];
  properties: {
    id: string;
    name: string;
    type: keyof typeof propertyTypeLabels;
    stars: number | null;
    where: string | null;
    nearest: { name: string; km: number } | null;
    description: string | null;
    lines: { id: string; name: string; sleeps: number | null; sellingCents: number; available: number | null; minNights: number | null }[];
  }[];
};

const distance = (km: number) => (km < 1 ? `${Math.round(km * 1000)} m` : `${km.toFixed(1)} km`);

type Line = ClientRateCard["properties"][number]["lines"][number];
type Property = ClientRateCard["properties"][number];

export function RateCardView({
  card,
  lineAction,
  lineExtra,
}: {
  card: ClientRateCard;
  /** On the client's link: a button per room — "I'm interested" (doc §4.11). Not printed. */
  lineAction?: (line: Line, property: Property) => React.ReactNode;
  /** Beneath a room, once chosen: how many, which nights, a note. */
  lineExtra?: (line: Line, property: Property) => React.ReactNode;
}) {
  return (
    <article className="rate-card mx-auto max-w-3xl rounded-2xl bg-white px-8 py-9 shadow-[0_1px_3px_rgba(0,0,0,0.06)] print:max-w-none print:rounded-none print:px-0 print:py-0 print:shadow-none">
      <header className="border-ink-200/70 flex items-start justify-between gap-6 border-b pb-6">
        <div>
          <p className="text-brand-700 text-[11px] font-medium tracking-[0.18em] uppercase">Rate card</p>
          <h1 className="text-ink-900 mt-1 text-2xl font-semibold">{card.event?.name ?? card.name}</h1>
          <p className="text-ink-500 mt-1 text-sm font-light">
            Prepared for {card.clientName}
            {card.event ? ` · ${formatRange(card.event.startDate, card.event.endDate)}` : ""}
          </p>
        </div>
        {/* eslint-disable-next-line @next/next/no-img-element -- an SVG needs no optimisation */}
        <img src="/welodge-logo.svg" alt="We Lodge" width={784} height={146} className="mt-1 h-7 w-auto shrink-0" />
      </header>

      {card.asked.length > 0 && (
        <section className="bg-brand-50/60 mt-6 rounded-xl px-5 py-4">
          <p className="text-brand-800 text-[11px] font-medium tracking-wider uppercase">Your request</p>
          <ul className="mt-1.5 space-y-0.5">
            {card.asked.map((line, index) => (
              <li key={index} className="text-ink-900 text-[15px]">
                <span className="font-semibold">
                  {line.rooms} × {line.roomType ?? "units"}
                </span>
                {line.checkIn && line.checkOut && (
                  <span className="text-ink-500 font-light">
                    {" "}
                    · {formatRange(line.checkIn, line.checkOut)} · {nightsBetween(line.checkIn, line.checkOut)} nights
                  </span>
                )}
              </li>
            ))}
          </ul>
        </section>
      )}

      {card.intro && <p className="text-ink-700 mt-6 text-[15px] leading-relaxed font-light whitespace-pre-line">{card.intro}</p>}

      <div className="mt-6 space-y-5">
        {card.properties.map((property) => (
          <section key={property.id} className="border-ink-200/70 break-inside-avoid rounded-xl border px-5 py-5">
            <div className="flex flex-wrap items-baseline justify-between gap-x-4 gap-y-1">
              <h2 className="text-ink-900 text-lg font-semibold">
                {property.name}
                {property.stars ? <span className="text-brand-700 ml-2 text-sm font-medium">{"★".repeat(property.stars)}</span> : null}
              </h2>
              {property.nearest && (
                <span className="bg-ink-50 text-ink-700 rounded-full px-3 py-1 text-xs whitespace-nowrap">
                  {distance(property.nearest.km)} from {property.nearest.name}
                </span>
              )}
            </div>
            <p className="text-ink-500 text-xs font-light">{[propertyTypeLabels[property.type], property.where].filter(Boolean).join(" · ")}</p>
            {property.description && <p className="text-ink-700 mt-3 text-sm leading-relaxed font-light">{property.description}</p>}
            <table className="mt-4 w-full text-left text-sm">
              <thead>
                <tr className="text-ink-500 border-ink-200/70 border-b text-[11px] tracking-wider uppercase">
                  <th className="pb-2 font-medium">Room type</th>
                  <th className="pb-2 font-medium">Sleeps</th>
                  <th className="pb-2 font-medium">Available</th>
                  <th className="pb-2 font-medium">Min. stay</th>
                  <th className="pb-2 text-right font-medium">Per night</th>
                  {lineAction && <th className="pb-2 print:hidden" />}
                </tr>
              </thead>
              <tbody>
                {property.lines.map((line) => {
                  const extra = lineExtra?.(line, property);
                  return (
                    <Fragment key={line.id}>
                      <tr className={`border-ink-200/40 ${extra ? "" : "border-b last:border-0"}`}>
                        <td className="text-ink-900 py-2.5">{line.name}</td>
                        <td className="text-ink-500 py-2.5 font-light">{line.sleeps ?? "—"}</td>
                        <td className="text-ink-500 py-2.5 font-light">{line.available ?? "—"}</td>
                        <td className="text-ink-500 py-2.5 font-light">{line.minNights ? `${line.minNights} ${line.minNights === 1 ? "night" : "nights"}` : "—"}</td>
                        <td className="text-ink-900 py-2.5 text-right font-medium whitespace-nowrap">{formatMoney(line.sellingCents, card.currency)}</td>
                        {lineAction && <td className="py-2.5 pl-3 text-right print:hidden">{lineAction(line, property)}</td>}
                      </tr>
                      {extra && (
                        <tr className="border-ink-200/40 border-b last:border-0 print:hidden">
                          <td colSpan={lineAction ? 6 : 5} className="pb-3">
                            {extra}
                          </td>
                        </tr>
                      )}
                    </Fragment>
                  );
                })}
              </tbody>
            </table>
          </section>
        ))}
      </div>

      <footer className="text-ink-500 border-ink-200/70 mt-8 border-t pt-4 text-xs font-light">
        Rates are per room per night, in {card.currency}, and subject to availability until confirmed. We Lodge · welodge.net
      </footer>
    </article>
  );
}
