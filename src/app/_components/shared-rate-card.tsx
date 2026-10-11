"use client";

import { useState } from "react";

import { Button, Field, FormError, friendlyError, Input, Textarea } from "~/app/_components/form";
import { PrintButton } from "~/app/_components/print-button";
import { RateCardView } from "~/app/_components/rate-card-view";
import { dayKey, nightsBetween, parseDay } from "~/lib/dates";
import { formatMoney } from "~/lib/format";
import { api, type RouterOutputs } from "~/trpc/react";

type Card = RouterOutputs["rateCard"]["shared"];
type Pick = { rooms: string; checkIn: string; checkOut: string; note: string };

/**
 * A rate card on the client's link (doc §4.11), answerable: "I'm interested"
 * on a room opens how many, which nights and a note; "Our dates have changed"
 * takes the new dates; Send to We Lodge sends it all — and can be sent again.
 */
export function SharedRateCard({ token, card }: { token: string; card: Card }) {
  const first = card.asked.find((line) => line.checkIn && line.checkOut);
  const defaultIn = first?.checkIn ? dayKey(first.checkIn) : card.event ? dayKey(card.event.startDate) : "";
  const defaultOut = first?.checkOut ? dayKey(first.checkOut) : card.event ? dayKey(card.event.endDate) : "";
  const last = card.lastAnswer;

  const [picks, setPicks] = useState<Record<string, Pick>>(() =>
    Object.fromEntries(
      (last?.items ?? [])
        .filter((item) => item.lineId)
        .map((item) => [
          item.lineId!,
          {
            rooms: String(item.rooms),
            checkIn: item.checkIn ? dayKey(item.checkIn) : defaultIn,
            checkOut: item.checkOut ? dayKey(item.checkOut) : defaultOut,
            note: item.note ?? "",
          },
        ]),
    ),
  );
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
  const setPick = (lineId: string, change: Partial<Pick>) => setPicks((current) => ({ ...current, [lineId]: { ...current[lineId]!, ...change } }));
  const nights = (pick: Pick) => (pick.checkIn && pick.checkOut && pick.checkOut > pick.checkIn ? nightsBetween(parseDay(pick.checkIn), parseDay(pick.checkOut)) : null);

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
                  else next[line.id] = { rooms: first ? String(first.rooms) : "1", checkIn: defaultIn, checkOut: defaultOut, note: "" };
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
          const pick = picks[line.id];
          if (!pick) return null;
          const n = nights(pick);
          return (
            <div className="bg-brand-50/60 grid gap-3 rounded-lg px-3 py-3 sm:grid-cols-[6rem_9.5rem_9.5rem_1fr]">
              <Field label="Rooms">
                <Input inputMode="numeric" value={pick.rooms} onChange={(e) => setPick(line.id, { rooms: e.target.value })} />
              </Field>
              <Field label="Arrival">
                <Input type="date" value={pick.checkIn} onChange={(e) => setPick(line.id, { checkIn: e.target.value })} />
              </Field>
              <Field label="Departure">
                <Input type="date" value={pick.checkOut} onChange={(e) => setPick(line.id, { checkOut: e.target.value })} />
              </Field>
              <Field label="Note — optional">
                <Input value={pick.note} onChange={(e) => setPick(line.id, { note: e.target.value })} placeholder="For the coaches, close to each other" />
              </Field>
              {n !== null && Number(pick.rooms) > 0 && (
                <p className="text-ink-500 text-xs font-light sm:col-span-4">
                  {pick.rooms} {Number(pick.rooms) === 1 ? "room" : "rooms"} × {n} nights × {formatMoney(line.sellingCents, card.currency)} ={" "}
                  <span className="text-ink-900 font-medium">{formatMoney(line.sellingCents * Number(pick.rooms) * n, card.currency)}</span>
                </p>
              )}
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
            {chosen.map(([lineId, pick]) => {
              const found = lines.get(lineId);
              if (!found) return null;
              const n = nights(pick);
              return (
                <li key={lineId} className="text-ink-700 font-light">
                  <span className="text-ink-900 font-medium">
                    {pick.rooms} × {found.line.name}
                  </span>{" "}
                  at {found.property.name}
                  {n !== null ? ` · ${n} nights` : ""}
                </li>
              );
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
          <Button
            type="button"
            disabled={answer.isPending || (chosen.length === 0 && !datesChanged && !note.trim())}
            onClick={() =>
              answer.mutate({
                token,
                name,
                email,
                note,
                dateChange: datesChanged ? newDates : null,
                items: chosen.map(([lineId, pick]) => ({
                  lineId,
                  rooms: Math.max(1, Math.round(Number(pick.rooms) || 1)),
                  checkIn: pick.checkIn,
                  checkOut: pick.checkOut,
                  note: pick.note,
                })),
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
