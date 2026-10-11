"use client";

import { useState } from "react";

import { Button, Field, FormError, friendlyError, Input, Textarea } from "~/app/_components/form";
import { PrintButton } from "~/app/_components/print-button";
import { RateCardView } from "~/app/_components/rate-card-view";
import { dayKey, nightsBetween, parseDay } from "~/lib/dates";
import { formatMoney, formatRange } from "~/lib/format";
import { api, type RouterOutputs } from "~/trpc/react";

type Card = RouterOutputs["rateCard"]["shared"];
type Line = Card["properties"][number]["lines"][number];
type Period = { rooms: string; checkIn: string; checkOut: string; note: string };

/**
 * A rate card on the client's link (doc §4.11), answerable: "I'm interested"
 * on a room opens how many, which nights and a note — as many periods as
 * they need; "Our dates have changed"
 * takes the new dates; Send to We Lodge sends it all — and can be sent again.
 */
export function SharedRateCard({ token, card }: { token: string; card: Card }) {
  const first = card.asked.find((line) => line.checkIn && line.checkOut);
  const defaultIn = first?.checkIn ? dayKey(first.checkIn) : card.event ? dayKey(card.event.startDate) : "";
  const defaultOut = first?.checkOut ? dayKey(first.checkOut) : card.event ? dayKey(card.event.endDate) : "";
  const last = card.lastAnswer;

  const [picks, setPicks] = useState<Record<string, Period[]>>(() => {
    const start: Record<string, Period[]> = {};
    for (const item of last?.items ?? []) {
      if (!item.lineId) continue;
      (start[item.lineId] ??= []).push({
        rooms: String(item.rooms),
        checkIn: item.checkIn ? dayKey(item.checkIn) : defaultIn,
        checkOut: item.checkOut ? dayKey(item.checkOut) : defaultOut,
        note: item.note ?? "",
      });
    }
    return start;
  });
  const [name, setName] = useState(last?.name ?? "");
  const [email, setEmail] = useState(last?.email ?? "");
  const [note, setNote] = useState("");
  const [datesChanged, setDatesChanged] = useState(false);
  const [newDates, setNewDates] = useState({ checkIn: defaultIn, checkOut: defaultOut, note: "" });
  const [sent, setSent] = useState<Date | null>(null);
  const answer = api.rateCard.answer.useMutation({
    onSuccess: () => {
      setSent(new Date());
      setNote("");
      window.scrollTo({ top: 0, behavior: "smooth" });
    },
  });

  const lines = new Map(card.properties.flatMap((property) => property.lines.map((line) => [line.id, { line, property }] as const)));
  const chosen = Object.entries(picks);
  const newPeriod = (line: Line): Period => {
    const asked = first?.rooms ?? 1;
    return { rooms: String(line.available ? Math.min(asked, line.available) : asked), checkIn: defaultIn, checkOut: defaultOut, note: "" };
  };
  const setPeriod = (lineId: string, index: number, change: Partial<Period>) =>
    setPicks((current) => ({ ...current, [lineId]: current[lineId]!.map((period, i) => (i === index ? { ...period, ...change } : period)) }));
  const addPeriod = (lineId: string) => setPicks((current) => ({ ...current, [lineId]: [...current[lineId]!, newPeriod(lines.get(lineId)!.line)] }));
  const removePeriod = (lineId: string, index: number) =>
    setPicks((current) => {
      const left = current[lineId]!.filter((_, i) => i !== index);
      const next = { ...current };
      if (left.length) next[lineId] = left;
      else delete next[lineId];
      return next;
    });
  const nights = (pick: Period) => (pick.checkIn && pick.checkOut && pick.checkOut > pick.checkIn ? nightsBetween(parseDay(pick.checkIn), parseDay(pick.checkOut)) : null);
  /** What stands in the way of a period: more rooms than there are, or a stay under the minimum. */
  const problem = (line: Line, pick: Period) => {
    const n = nights(pick);
    if (line.available !== null && Number(pick.rooms) > line.available) return `${line.available} available at most`;
    if (line.minNights !== null && n !== null && n < line.minNights) return `The minimum stay is ${line.minNights} nights`;
    return null;
  };
  const blocked = Object.entries(picks).some(([lineId, periods]) => {
    const found = lines.get(lineId);
    return found ? periods.some((pick) => problem(found.line, pick)) : false;
  });

  return (
    <div className="space-y-4 pb-10">
      <div className="mx-auto flex max-w-3xl items-center justify-between gap-3 print:hidden">
        <p className="text-ink-500 text-sm font-light">Choose the rooms you are interested in, or tell us if your dates have changed.</p>
        <PrintButton />
      </div>

      {sent && (
        <p className="mx-auto max-w-3xl rounded-xl bg-[#e3f8ee] px-5 py-3 text-sm text-[#0a7a47] print:hidden">
          Thank you — your answer has been sent to We Lodge. We will come back to you shortly. You can change it below and send again.
        </p>
      )}
      {!sent && last && (
        <p className="bg-brand-50 text-brand-800 mx-auto max-w-3xl rounded-xl px-5 py-3 text-sm font-light print:hidden">
          You answered this rate card on {last.at.toLocaleDateString("en-GB", { day: "numeric", month: "long" })} — your choices are filled in below. Change anything and send again.
        </p>
      )}

      <RateCardView
        card={card}
        lineAction={(line) => {
          const on = Boolean(picks[line.id]);
          return (
            <button
              type="button"
              aria-pressed={on}
              onClick={() =>
                setPicks((current) => {
                  const next = { ...current };
                  if (on) delete next[line.id];
                  else next[line.id] = [newPeriod(line)];
                  return next;
                })
              }
              className={`rounded-full border px-3 py-1 text-xs font-medium whitespace-nowrap transition-colors ${
                on ? "border-brand-500 bg-brand-500 text-white" : "border-brand-300 text-brand-700 hover:bg-brand-50"
              }`}
            >
              {on ? "✓ Interested" : "I'm interested"}
            </button>
          );
        }}
        lineExtra={(line) => {
          const periods = picks[line.id];
          if (!periods) return null;
          return (
            <div className="bg-brand-50/60 space-y-3 rounded-lg px-3 py-3">
              {periods.map((pick, index) => {
                const n = nights(pick);
                return (
                  <div key={index} className={index > 0 ? "border-brand-200/70 border-t pt-3" : ""}>
                    <div className="grid gap-3 sm:grid-cols-[5.5rem_9.5rem_9.5rem_1fr]">
                      <Field label="Rooms">
                        <Input inputMode="numeric" value={pick.rooms} onChange={(e) => setPeriod(line.id, index, { rooms: e.target.value })} />
                      </Field>
                      <Field label="Arrival">
                        <Input type="date" value={pick.checkIn} onChange={(e) => setPeriod(line.id, index, { checkIn: e.target.value })} />
                      </Field>
                      <Field label="Departure">
                        <Input type="date" value={pick.checkOut} onChange={(e) => setPeriod(line.id, index, { checkOut: e.target.value })} />
                      </Field>
                      <Field label="Note — optional">
                        <Input value={pick.note} onChange={(e) => setPeriod(line.id, index, { note: e.target.value })} placeholder="For the coaches, close to each other" />
                      </Field>
                    </div>
                    <div className="mt-1.5 flex items-baseline justify-between gap-3 text-xs">
                      <p className="text-ink-500 font-light">
                        {problem(line, pick) ? (
                          <span className="font-normal text-[#c03654]">{problem(line, pick)}</span>
                        ) : n !== null && Number(pick.rooms) > 0 && (
                          <>
                            {pick.rooms} {Number(pick.rooms) === 1 ? "room" : "rooms"} × {n} nights × {formatMoney(line.sellingCents, card.currency)} ={" "}
                            <span className="text-ink-900 font-medium">{formatMoney(line.sellingCents * Number(pick.rooms) * n, card.currency)}</span>
                          </>
                        )}
                      </p>
                      {periods.length > 1 && (
                        <button type="button" onClick={() => removePeriod(line.id, index)} className="shrink-0 font-light text-[#c03654] hover:underline">
                          Remove this period
                        </button>
                      )}
                    </div>
                  </div>
                );
              })}
              <button type="button" onClick={() => addPeriod(line.id)} className="text-brand-700 text-xs font-medium hover:underline">
                + Add another period
              </button>
            </div>
          );
        }}
      />

      <section className="mx-auto max-w-3xl rounded-2xl bg-white px-8 py-7 shadow-[0_1px_3px_rgba(0,0,0,0.06)] print:hidden">
        <h2 className="text-ink-900 text-lg font-semibold">Your answer</h2>
        {chosen.length === 0 ? (
          <p className="text-ink-500 mt-1 text-sm font-light">No rooms chosen yet — press &ldquo;I&apos;m interested&rdquo; on the rooms you would like.</p>
        ) : (
          <ul className="mt-2 space-y-1 text-sm">
            {chosen.flatMap(([lineId, periods]) => {
              const found = lines.get(lineId);
              if (!found) return [];
              return periods.map((pick, index) => (
                <li key={`${lineId}-${index}`} className="text-ink-700 font-light">
                  <span className="text-ink-900 font-medium">
                    {pick.rooms} × {found.line.name}
                  </span>{" "}
                  at {found.property.name}
                  {pick.checkIn && pick.checkOut && pick.checkOut > pick.checkIn
                    ? ` · ${formatRange(parseDay(pick.checkIn), parseDay(pick.checkOut))} · ${nights(pick)} nights`
                    : ""}
                </li>
              ));
            })}
          </ul>
        )}

        <label className="mt-5 flex items-center gap-2 text-sm">
          <input type="checkbox" checked={datesChanged} onChange={(e) => setDatesChanged(e.target.checked)} className="accent-brand-500 h-4 w-4" />
          <span className="text-ink-900 font-medium">Our dates have changed</span>
        </label>
        {datesChanged && (
          <div className="mt-3 grid gap-3 sm:grid-cols-[9.5rem_9.5rem_1fr]">
            <Field label="New arrival">
              <Input type="date" value={newDates.checkIn} onChange={(e) => setNewDates({ ...newDates, checkIn: e.target.value })} />
            </Field>
            <Field label="New departure">
              <Input type="date" value={newDates.checkOut} onChange={(e) => setNewDates({ ...newDates, checkOut: e.target.value })} />
            </Field>
            <Field label="What changed — optional">
              <Input value={newDates.note} onChange={(e) => setNewDates({ ...newDates, note: e.target.value })} placeholder="The team now arrives two days earlier" />
            </Field>
          </div>
        )}

        <div className="mt-5 grid gap-3 sm:grid-cols-2">
          <Field label="Your name">
            <Input value={name} onChange={(e) => setName(e.target.value)} />
          </Field>
          <Field label="Your email">
            <Input type="email" value={email} onChange={(e) => setEmail(e.target.value)} />
          </Field>
          <Field label="A note for We Lodge — optional" className="sm:col-span-2">
            <Textarea rows={2} value={note} onChange={(e) => setNote(e.target.value)} />
          </Field>
        </div>

        <div className="mt-4 space-y-2">
          <FormError message={answer.error ? friendlyError(answer.error) : null} />
          {blocked && <p className="text-xs text-[#c03654]">Please check the rooms marked in red above — the number of rooms or the length of stay.</p>}
          <Button
            type="button"
            disabled={answer.isPending || blocked || (chosen.length === 0 && !datesChanged && !note.trim())}
            onClick={() =>
              answer.mutate({
                token,
                name,
                email,
                note,
                dateChange: datesChanged ? newDates : null,
                items: chosen.flatMap(([lineId, periods]) =>
                  periods.map((pick) => ({
                    lineId,
                    rooms: Math.max(1, Math.round(Number(pick.rooms) || 1)),
                    checkIn: pick.checkIn,
                    checkOut: pick.checkOut,
                    note: pick.note,
                  })),
                ),
              })
            }
          >
            {answer.isPending ? "Sending…" : sent || last ? "Send again" : "Send to We Lodge"}
          </Button>
        </div>
      </section>
    </div>
  );
}
