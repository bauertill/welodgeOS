"use client";

import { useState } from "react";

import { ContractingFields } from "~/app/_components/contracting-form";
import { Button, Field, FormError, friendlyError, Input, Textarea } from "~/app/_components/form";
import { Popup } from "~/app/_components/popup";
import { PrintButton } from "~/app/_components/print-button";
import { RateCardMap } from "~/app/_components/rate-card-map";
import { RateCardView } from "~/app/_components/rate-card-view";
import { env } from "~/env";
import { dayKey, nightsBetween, parseDay } from "~/lib/dates";
import { formatMoney, formatMomentInWords } from "~/lib/format";
import { api, type RouterOutputs } from "~/trpc/react";

type Card = RouterOutputs["rateCard"]["shared"];
type Line = Card["properties"][number]["lines"][number];
/** One period the client asks for: a room at a property, how many, which nights. */
type Row = { key: number; lineId: string; rooms: string; checkIn: string; checkOut: string };

/**
 * A rate card on the client's link (doc §4.11, reworked 2026-11-17). Full
 * width with the map beside it. On each room, **I like it!** — nothing more is
 * asked; it highlights the room for us. At the end, unless the card is to look
 * at only, **Request a proposal**: the rooms they want, each with dates and how
 * many, as many periods as they need, a note, and Send. A request, not a
 * booking: we come back with a proposal, its payment and cancellation terms
 * set by the sales manager.
 */
export function SharedRateCard({ token, card }: { token: string; card: Card }) {
  const first = card.asked.find((line) => line.checkIn && line.checkOut);
  const defaultIn = first?.checkIn ? dayKey(first.checkIn) : card.event ? dayKey(card.event.startDate) : "";
  const defaultOut = first?.checkOut ? dayKey(first.checkOut) : card.event ? dayKey(card.event.endDate) : "";
  const last = card.lastAnswer;
  const canAnswer = card.canAnswer;
  const hasMap = Boolean(env.NEXT_PUBLIC_GOOGLE_MAPS_API_KEY) && card.properties.some((property) => property.latitude !== null && property.longitude !== null);

  const lines = new Map(card.properties.flatMap((property) => property.lines.map((line) => [line.id, { line, property }] as const)));

  // "I like it!" — kept on our side straight away, no name asked (2026-11-17).
  const [likes, setLikes] = useState<Record<string, boolean>>(() =>
    Object.fromEntries(card.properties.flatMap((property) => property.lines.map((line) => [line.id, Boolean(line.liked)]))),
  );
  const like = api.rateCard.like.useMutation();
  const toggleLike = (lineId: string) => {
    const next = !likes[lineId];
    setLikes((current) => ({ ...current, [lineId]: next }));
    like.mutate({ token, lineId, liked: next }, { onError: () => setLikes((current) => ({ ...current, [lineId]: !next })) });
  };

  // The proposal they ask for: their last request filled in, else the rooms they liked, else one empty period.
  const [nextKey, setNextKey] = useState(1000);
  const newRow = (lineId: string, key: number): Row => {
    const found = lines.get(lineId)?.line;
    const asked = first?.rooms ?? 1;
    return { key, lineId, rooms: lineId ? String(found?.available ? Math.min(asked, found.available) : asked) : "", checkIn: defaultIn, checkOut: defaultOut };
  };
  const [rows, setRows] = useState<Row[]>(() => {
    const fromLast = (last?.items ?? [])
      .filter((item) => item.lineId && lines.has(item.lineId))
      .map((item, index) => ({
        key: index,
        lineId: item.lineId!,
        rooms: String(item.rooms),
        checkIn: item.checkIn ? dayKey(item.checkIn) : defaultIn,
        checkOut: item.checkOut ? dayKey(item.checkOut) : defaultOut,
      }));
    if (fromLast.length) return fromLast;
    const liked = card.properties.flatMap((property) => property.lines.filter((line) => line.liked)).map((line, index) => newRow(line.id, index));
    return liked.length ? liked : [newRow("", 0)];
  });
  const setRow = (key: number, change: Partial<Row>) => setRows((current) => current.map((row) => (row.key === key ? { ...row, ...change } : row)));
  const addRow = () => {
    // A new period starts from the room of the last one: the same room at other dates is the usual case.
    setRows((current) => [...current, { ...newRow(current.at(-1)?.lineId ?? "", nextKey) }]);
    setNextKey((key) => key + 1);
  };
  const removeRow = (key: number) => setRows((current) => (current.length > 1 ? current.filter((row) => row.key !== key) : [newRow("", nextKey)]));

  const [note, setNote] = useState("");
  const [name, setName] = useState(last?.name ?? "");
  const [email, setEmail] = useState(last?.email ?? "");
  const [company, setCompany] = useState("");
  const [sent, setSent] = useState(false);
  /** The contracting popup: straight after sending, or from the reminder. */
  const [contractingOpen, setContractingOpen] = useState(false);
  const [justSent, setJustSent] = useState(false);
  const [detailsSent, setDetailsSent] = useState(false);

  // On a general card, this browser's own answer — what its contracting details and a resend go onto (doc §4.11).
  const answerKey = `rate-card-answer:${token}`;
  const [responseId, setResponseId] = useState<string | null>(() => {
    if (!card.general || typeof window === "undefined") return null;
    try {
      return window.localStorage.getItem(answerKey);
    } catch {
      return null;
    }
  });
  // A card sent to a known client never asks which company (2026-11-17).
  const askCompany = Boolean(card.general) && !card.forClient && !responseId;
  const contracting = api.rateCard.contracting.useQuery({ token, responseId }, { retry: false, refetchOnWindowFocus: false, enabled: canAnswer });
  const sendDetails = api.rateCard.submitContracting.useMutation({
    onSuccess: () => {
      setDetailsSent(true);
      setContractingOpen(false);
      void contracting.refetch();
    },
  });
  const answer = api.rateCard.answer.useMutation({
    onSuccess: (result) => {
      setSent(true);
      if (card.general) {
        setResponseId(result.id);
        try {
          window.localStorage.setItem(answerKey, result.id);
        } catch {
          // A private window: they can still send their details now.
        }
      }
      setNote("");
      // The request is in: now the details the agreement needs (doc §4.11, 2026-10-14) — asked, not required.
      setJustSent(true);
      setContractingOpen(true);
    },
  });

  const nights = (row: Row) => (row.checkIn && row.checkOut && row.checkOut > row.checkIn ? nightsBetween(parseDay(row.checkIn), parseDay(row.checkOut)) : null);
  /** What stands in the way of a period: more rooms than there are, or a stay under the minimum. */
  const problem = (row: Row) => {
    const line = lines.get(row.lineId)?.line;
    if (!line) return null;
    const n = nights(row);
    if (row.checkIn && row.checkOut && row.checkOut <= row.checkIn) return "The departure has to be after the arrival";
    if (line.available !== null && Number(row.rooms) > line.available) return `${line.available} available at most`;
    if (line.minNights !== null && n !== null && n < line.minNights) return `The minimum stay is ${line.minNights} nights`;
    return null;
  };
  const chosen = rows.filter((row) => row.lineId && Number(row.rooms) > 0);
  const total = chosen.reduce((sum, row) => sum + (lines.get(row.lineId)?.line.sellingCents ?? 0) * Number(row.rooms) * (nights(row) ?? 0), 0);
  const tbcChosen = chosen.some((row) => lines.get(row.lineId)?.line.sellingCents === null);
  const blocked = rows.some((row) => problem(row));

  const send = () =>
    answer.mutate({
      token,
      name,
      email,
      company,
      previousResponseId: responseId,
      note,
      dateChange: null,
      items: chosen.map((row) => ({ lineId: row.lineId, rooms: Math.max(1, Math.round(Number(row.rooms) || 1)), checkIn: row.checkIn, checkOut: row.checkOut, note: "" })),
    });

  const roomLabel = (line: Line) => `${line.name} — ${line.sellingCents !== null ? `${formatMoney(line.sellingCents, card.currency)} a night` : "rate to be confirmed"}`;

  const requestProposal = canAnswer ? (
    <section id="request-proposal" className="border-brand-200 bg-brand-50/40 mt-8 scroll-mt-6 rounded-xl border px-5 py-5">
      <h2 className="text-ink-900 text-lg font-semibold">Request a proposal</h2>
      <p className="text-ink-500 mt-0.5 text-sm font-light">
        Choose the rooms you would like, with your dates and how many — add as many periods as you need — and send it to us. We come back to you with a proposal.
      </p>

      {sent && (
        <p className="mt-3 rounded-lg bg-[#e3f8ee] px-4 py-2.5 text-sm text-[#0a7a47]">
          Thank you — your request has been sent to We Lodge. A We Lodge agent will come back to you with a proposal. You can change it and send again.
        </p>
      )}
      {!sent && last && (
        <p className="text-brand-800 mt-3 rounded-lg bg-white px-4 py-2.5 text-sm font-light">
          You sent a request on {last.at.toLocaleDateString("en-GB", { day: "numeric", month: "long" })} — it is filled in below. Change anything and send again.
        </p>
      )}

      <ul className="mt-4 space-y-3">
        {rows.map((row) => {
          const n = nights(row);
          const found = lines.get(row.lineId);
          const issue = problem(row);
          return (
            <li key={row.key} className="rounded-lg bg-white px-4 py-3">
              <div className="grid gap-3 sm:grid-cols-[minmax(0,1fr)_5rem_9.5rem_9.5rem_auto] sm:items-end">
                <Field label="Property and room">
                  <select
                    value={row.lineId}
                    onChange={(e) => setRow(row.key, { lineId: e.target.value })}
                    className="border-ink-200 focus:border-brand-400 w-full rounded-lg border bg-white px-3 py-2 text-sm font-light outline-none"
                  >
                    <option value="">Choose…</option>
                    {card.properties.map((property, index) => (
                      <optgroup key={property.id} label={`${index + 1}. ${property.name}`}>
                        {property.lines.map((line) => (
                          <option key={line.id} value={line.id}>
                            {likes[line.id] ? "♥ " : ""}
                            {roomLabel(line)}
                          </option>
                        ))}
                      </optgroup>
                    ))}
                  </select>
                </Field>
                <Field label="Rooms">
                  <Input inputMode="numeric" value={row.rooms} onChange={(e) => setRow(row.key, { rooms: e.target.value })} />
                </Field>
                <Field label="Arrival">
                  <Input type="date" value={row.checkIn} onChange={(e) => setRow(row.key, { checkIn: e.target.value })} />
                </Field>
                <Field label="Departure">
                  <Input type="date" value={row.checkOut} onChange={(e) => setRow(row.key, { checkOut: e.target.value })} />
                </Field>
                <button type="button" onClick={() => removeRow(row.key)} aria-label="Remove this period" title="Remove this period" className="text-ink-400 pb-2 text-lg leading-none hover:text-[#c03654]">
                  ×
                </button>
              </div>
              <p className="text-ink-500 mt-1.5 text-xs font-light">
                {issue ? (
                  <span className="font-normal text-[#c03654]">{issue}</span>
                ) : found && n !== null && Number(row.rooms) > 0 ? (
                  found.line.sellingCents === null ? (
                    <>
                      {row.rooms} {Number(row.rooms) === 1 ? "room" : "rooms"} × {n} nights — the rate is to be confirmed by We Lodge
                    </>
                  ) : (
                    <>
                      {row.rooms} {Number(row.rooms) === 1 ? "room" : "rooms"} × {n} nights × {formatMoney(found.line.sellingCents, card.currency)} ={" "}
                      <span className="text-ink-900 font-medium">{formatMoney(found.line.sellingCents * Number(row.rooms) * n, card.currency)}</span>
                    </>
                  )
                ) : null}
              </p>
            </li>
          );
        })}
      </ul>
      <button type="button" onClick={addRow} className="text-brand-700 mt-3 text-sm font-medium hover:underline">
        + Add another period
      </button>
      {total > 0 && (
        <p className="text-ink-900 border-ink-200/70 mt-3 border-t pt-3 text-sm">
          Total <span className="font-semibold">{formatMoney(total, card.currency)}</span>
          <span className="text-ink-500 font-light">
            {" "}
            — subject to availability until confirmed{tbcChosen ? "; rooms with a rate to be confirmed are not included" : ""}
          </span>
        </p>
      )}

      <div className="mt-4 grid gap-3 sm:grid-cols-2">
        <Field label="Your message to We Lodge — optional" className="sm:col-span-2">
          <Textarea rows={3} value={note} onChange={(e) => setNote(e.target.value)} placeholder="Anything we should know — other dates, who the rooms are for, questions." />
        </Field>
        {askCompany && (
          <Field label="Your company" className="sm:col-span-2">
            <Input value={company} onChange={(e) => setCompany(e.target.value)} placeholder="The organisation you are booking for" />
          </Field>
        )}
        <Field label="Your name">
          <Input value={name} onChange={(e) => setName(e.target.value)} />
        </Field>
        <Field label="Your email">
          <Input type="email" value={email} onChange={(e) => setEmail(e.target.value)} />
        </Field>
      </div>
      <div className="mt-4 space-y-2">
        <FormError message={answer.error ? friendlyError(answer.error) : null} />
        {blocked && <p className="text-xs text-[#c03654]">Please check the periods marked in red — the number of rooms or the dates.</p>}
        <div className="flex flex-wrap items-center gap-x-4 gap-y-2">
          <Button type="button" disabled={answer.isPending || blocked || (chosen.length === 0 && !note.trim()) || (askCompany && !company.trim())} onClick={send}>
            {answer.isPending ? "Sending…" : sent || last ? "Send again to We Lodge →" : "Send to We Lodge →"}
          </Button>
          <span className="text-ink-500 text-xs font-light">This is a request, not a booking — we come back to you with a proposal and its terms.</span>
        </div>
      </div>
    </section>
  ) : null;

  return (
    <div className="mx-auto max-w-[1600px] space-y-4 pb-10">
      <div className="flex items-center justify-end gap-4 print:hidden">
        {canAnswer && (
          <a href="#request-proposal" className="text-brand-700 text-sm font-medium hover:underline">
            Request a proposal ↓
          </a>
        )}
        <PrintButton />
      </div>

      {detailsSent && <p className="rounded-xl bg-[#e3f8ee] px-5 py-3 text-sm text-[#0a7a47] print:hidden">Thank you — your company details have been sent.</p>}
      {canAnswer && sent && contracting.data && !contracting.data.general && !contracting.data.submittedAt && !contractingOpen && (
        <div className="flex flex-wrap items-center justify-between gap-3 rounded-xl border border-[#f0d9a8] bg-[#fdf6e7] px-5 py-3 print:hidden">
          <p className="text-sm text-[#7a5410]">
            <span className="font-semibold">Complete your contracting details</span> — your company and who signs — so we can prepare your agreement.
          </p>
          <Button type="button" onClick={() => setContractingOpen(true)}>
            Add company details
          </Button>
        </div>
      )}

      <div className={`grid items-start gap-5 ${hasMap ? "lg:grid-cols-[minmax(0,3fr)_minmax(0,2fr)]" : ""}`}>
        <div className="min-w-0">
          <RateCardView
            card={card}
            wide={hasMap}
            lineAction={(line) => {
              const on = Boolean(likes[line.id]);
              return (
                <button
                  type="button"
                  aria-pressed={on}
                  onClick={() => toggleLike(line.id)}
                  title={on ? "Press again to take it back" : "Let us know you like this room"}
                  className={`rounded-full border px-3 py-1 text-xs font-medium whitespace-nowrap transition-colors ${
                    on ? "border-[#e0234e] bg-[#e0234e] text-white" : "border-brand-300 text-brand-700 hover:bg-brand-50"
                  }`}
                >
                  {on ? "♥ I like it!" : "♡ I like it!"}
                </button>
              );
            }}
            after={requestProposal}
          />
        </div>
        {/* The map beside the card on a wide screen, staying in view while the card scrolls (2026-11-17). */}
        {hasMap && (
          <aside className="min-w-0 lg:sticky lg:top-6 lg:max-h-[calc(100vh-3rem)] lg:overflow-y-auto">
            <RateCardMap
              token={token}
              side
              properties={card.properties.map((property) => ({ id: property.id, rateCardPropertyId: property.id, name: property.name, latitude: property.latitude, longitude: property.longitude }))}
              venues={card.venues}
            />
          </aside>
        )}
      </div>

      {contractingOpen && (
        <Popup
          size="medium"
          title={justSent ? "One more thing — your company details" : "Your company details"}
          subtitle="We need these to prepare your agreement. They come straight to your contact at We Lodge."
          onClose={() => setContractingOpen(false)}
        >
          <div className="space-y-4">
            {justSent && <p className="rounded-xl bg-[#e3f8ee] px-5 py-3 text-sm text-[#0a7a47]">✓ Your request has been sent to We Lodge.</p>}
            {contracting.data?.submittedAt && (
              <p className="bg-brand-50 text-brand-800 rounded-xl px-5 py-3 text-sm font-light">
                You sent these {formatMomentInWords(contracting.data.submittedAt)} — check they are still right.
              </p>
            )}
            {contracting.data?.values ? (
              <ContractingFields
                values={contracting.data.values}
                pending={sendDetails.isPending}
                error={sendDetails.error ? friendlyError(sendDetails.error) : null}
                onSubmit={(values) => sendDetails.mutate({ token, responseId, values })}
                submitLabel="Send my details"
                after={
                  <button type="button" onClick={() => setContractingOpen(false)} className="text-ink-500 text-sm hover:underline">
                    I&apos;ll do this later
                  </button>
                }
              />
            ) : (
              <p className="text-ink-500 text-sm font-light">{contracting.error ? friendlyError(contracting.error) : "Loading…"}</p>
            )}
          </div>
        </Popup>
      )}
    </div>
  );
}
