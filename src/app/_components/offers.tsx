"use client";

import Link from "next/link";
import { useRouter } from "next/navigation";
import { useState } from "react";

import { Button, Field, FormError, friendlyError, Input, Select, Textarea } from "~/app/_components/form";
import { Popup } from "~/app/_components/popup";
import { checkTerms, TermsEditor, toPercent, type CancellationDraft, type PaymentDraft } from "~/app/_components/terms-editor";
import { dayKey, nightsBetween, parseDay, today } from "~/lib/dates";
import { contractHref, percent } from "~/lib/finance";
import { canTrust } from "~/lib/offers";
import { formatDate, formatMoney, formatRange } from "~/lib/format";
import { api, type RouterOutputs } from "~/trpc/react";

const CURRENCIES = ["USD", "EUR", "CHF", "GBP"];
type LineDraft = { categoryId: string; rooms: string; checkIn: string; checkOut: string; rate: string };
type Offer = RouterOutputs["offer"]["forRequest"][number];

const toCents = (text: string) => {
  const value = Number(text.trim().replace(/[\s'’,]/g, ""));
  return text.trim() && Number.isFinite(value) && value >= 0 ? Math.round(value * 100) : null;
};
const nightsOf = (line: { checkIn: string; checkOut: string }) =>
  line.checkIn && line.checkOut && line.checkOut > line.checkIn ? nightsBetween(parseDay(line.checkIn), parseDay(line.checkOut)) : 0;

/**
 * Make an offer to the client (doc §4.11, 2026-10-14), in a popup: filled
 * from their rate card answer — the rooms, dates and our rates — with how long
 * it holds and the terms of the last offer on this event. Making it blocks
 * the rooms until it runs out.
 */
export function OfferPopup({ salesRequestId, responseId, onClose }: { salesRequestId: string; responseId: string | null; onClose: () => void }) {
  const context = api.offer.formContext.useQuery({ salesRequestId, responseId }, { refetchOnWindowFocus: false });
  return (
    <Popup size="medium" title="Make an offer" subtitle="The rooms are blocked for the client until the offer runs out — nobody else is offered them." onClose={onClose}>
      {context.data ? (
        <OfferForm salesRequestId={salesRequestId} context={context.data} onDone={onClose} />
      ) : (
        <p className="text-ink-500 text-sm font-light">{context.error ? friendlyError(context.error) : "Loading…"}</p>
      )}
    </Popup>
  );
}

function OfferForm({ salesRequestId, context, onDone }: { salesRequestId: string; context: RouterOutputs["offer"]["formContext"]; onDone: () => void }) {
  const utils = api.useUtils();
  const router = useRouter();
  const [lines, setLines] = useState<LineDraft[]>(
    context.lines.length
      ? context.lines.map((line) => ({ categoryId: line.categoryId, rooms: String(line.rooms), checkIn: line.checkIn, checkOut: line.checkOut, rate: String(line.rateCents / 100) }))
      : [{ categoryId: "", rooms: "1", checkIn: dayKey(context.event.startDate), checkOut: dayKey(context.event.endDate), rate: "" }],
  );
  const [currency, setCurrency] = useState(context.currency);
  const [validUntil, setValidUntil] = useState(context.validUntil);
  const [inclusions, setInclusions] = useState(context.termsFrom?.inclusions ?? "");
  const [conditions, setConditions] = useState(context.termsFrom?.conditions ?? "");
  const [payments, setPayments] = useState<PaymentDraft[]>(
    context.termsFrom?.payments.length
      ? context.termsFrom.payments.map((payment) => ({ onSignature: payment.onSignature, dueOn: payment.dueOn ? dayKey(payment.dueOn) : "", percent: toPercent(payment.percentBasisPoints) }))
      : [{ onSignature: true, dueOn: "", percent: "" }],
  );
  const [cancellations, setCancellations] = useState<CancellationDraft[]>(
    context.termsFrom?.cancellations.length
      ? context.termsFrom.cancellations.map((cut) => ({
          kind: cut.feeBasisPoints !== null ? "FEE" : cut.kind === "ATTRITION" || cut.kind === "RELEASE" ? cut.kind : "OTHER",
          cutoffOn: dayKey(cut.cutoffOn),
          percent: toPercent(cut.feeBasisPoints ?? cut.percentBasisPoints),
          remarks: cut.remarks ?? "",
        }))
      : [{ kind: "FEE", cutoffOn: "", percent: "", remarks: "" }],
  );
  const [problem, setProblem] = useState<string | null>(null);
  const create = api.offer.create.useMutation({
    onSuccess: () => {
      void utils.offer.invalidate();
      void utils.sales.invalidate();
      void utils.inventory.invalidate();
      router.refresh();
      onDone();
    },
  });

  const setLine = (index: number, change: Partial<LineDraft>) => setLines((current) => current.map((line, i) => (i === index ? { ...line, ...change } : line)));
  const total = lines.reduce((sum, line) => sum + (Number(line.rooms) || 0) * nightsOf(line) * (toCents(line.rate) ?? 0), 0);
  const byProperty = context.categories.reduce<Record<string, { id: string; name: string }[]>>((groups, category) => {
    (groups[category.property] ??= []).push(category);
    return groups;
  }, {});

  const submit = () => {
    setProblem(null);
    const linesOut = [];
    for (const [i, line] of lines.entries()) {
      if (!line.categoryId) return setProblem(`Line ${i + 1}: choose the room type.`);
      const rooms = Number(line.rooms);
      if (!Number.isInteger(rooms) || rooms < 1) return setProblem(`Line ${i + 1}: the number of rooms should be a whole number, like 10.`);
      if (!nightsOf(line)) return setProblem(`Line ${i + 1}: the departure must be after the arrival.`);
      const rateCents = toCents(line.rate);
      if (rateCents === null) return setProblem(`Line ${i + 1}: give the rate per night, like 500.`);
      linesOut.push({ categoryId: line.categoryId, rooms, checkIn: line.checkIn, checkOut: line.checkOut, rateCents });
    }
    const terms = checkTerms(payments, cancellations, "CLIENT_CANCELLATION");
    if (typeof terms === "string") return setProblem(terms);
    create.mutate({ salesRequestId, responseId: context.responseId, currency, validUntil, inclusions, conditions, lines: linesOut, ...terms });
  };

  return (
    <div className="space-y-5">
      {context.contracting.tradeName && context.contracting.signatory ? (
        <p className="rounded-xl bg-[#e3f8ee] px-5 py-3 text-[13px] text-[#0a7a47]">
          ✓ Contracting details are in — {context.contracting.tradeName}, signed by {context.contracting.signatory}. The agreement can be drawn up.
        </p>
      ) : (
        <p className="rounded-xl border border-[#f0d9a8] bg-[#fdf6e7] px-5 py-3 text-[13px] text-[#7a5410]">
          <span className="font-semibold">{context.contracting.tradeName ? "No signatory yet." : "No contracting details yet."}</span> The agreement needs the
          client&rsquo;s company and who signs. Their rate card asks them for these; you can also send them the contracting link from the request.
        </p>
      )}
      <div className="rounded-xl bg-white px-5 py-4">
        <h3 className="text-ink-900 mb-1 text-[15px] font-semibold">Rooms for {context.clientName}</h3>
        <p className="text-ink-500 mb-3 text-xs font-light">
          {context.responseId ? "From their rate card answer — change anything." : "They have not answered a rate card — add the rooms you are offering."}
        </p>
        <div className="space-y-3">
          {lines.map((line, index) => (
            <div key={index} className={index > 0 ? "border-ink-200/60 border-t pt-3" : ""}>
              <div className="grid gap-2 sm:grid-cols-[1fr_4.5rem]">
                <Select value={line.categoryId} onChange={(e) => setLine(index, { categoryId: e.target.value })} aria-label={`Line ${index + 1} room type`}>
                  <option value="">Choose the room type…</option>
                  {Object.entries(byProperty).map(([property, categories]) => (
                    <optgroup key={property} label={property}>
                      {categories.map((category) => (
                        <option key={category.id} value={category.id}>
                          {category.name} — {property}
                        </option>
                      ))}
                    </optgroup>
                  ))}
                </Select>
                <Input value={line.rooms} onChange={(e) => setLine(index, { rooms: e.target.value })} inputMode="numeric" aria-label={`Line ${index + 1} rooms`} placeholder="Rooms" />
              </div>
              <div className="mt-2 flex flex-wrap items-center gap-2">
                <Input type="date" value={line.checkIn} onChange={(e) => setLine(index, { checkIn: e.target.value })} aria-label={`Line ${index + 1} arrival`} className="w-40 px-2" />
                <span className="text-ink-400">→</span>
                <Input type="date" value={line.checkOut} onChange={(e) => setLine(index, { checkOut: e.target.value })} aria-label={`Line ${index + 1} departure`} className="w-40 px-2" />
                <span className="flex items-center gap-1">
                  <Input value={line.rate} onChange={(e) => setLine(index, { rate: e.target.value })} inputMode="decimal" aria-label={`Line ${index + 1} rate per night`} placeholder="500" className="w-24 px-2" />
                  <span className="text-ink-500 text-[12px]">{currency} / night</span>
                </span>
                <span className="text-ink-500 text-xs font-light">
                  {nightsOf(line) > 0 && toCents(line.rate) !== null && Number(line.rooms) > 0
                    ? `= ${formatMoney(Number(line.rooms) * nightsOf(line) * toCents(line.rate)!, currency)}`
                    : ""}
                </span>
                {lines.length > 1 && (
                  <button type="button" onClick={() => setLines((current) => current.filter((_, i) => i !== index))} className="text-ink-400 ml-auto text-lg leading-none hover:text-[#c03654]" aria-label={`Remove line ${index + 1}`}>
                    ×
                  </button>
                )}
              </div>
            </div>
          ))}
        </div>
        <div className="mt-3 flex flex-wrap items-baseline justify-between gap-3">
          <button
            type="button"
            onClick={() => setLines((current) => [...current, { ...current.at(-1)!, categoryId: "", rate: "" }])}
            className="text-brand-700 text-xs font-medium hover:underline"
          >
            + Add a line
          </button>
          <span className="text-ink-700 text-[13px]">
            Total <strong className="font-semibold">{formatMoney(total, currency)}</strong>
          </span>
        </div>
      </div>

      <div className="grid gap-3 rounded-xl bg-white px-5 py-4 sm:grid-cols-[11rem_7rem_1fr]">
        <Field label="The offer holds until">
          <Input type="date" value={validUntil} onChange={(e) => setValidUntil(e.target.value)} />
        </Field>
        <Field label="Currency">
          <Select value={currency} onChange={(e) => setCurrency(e.target.value)}>
            {[...new Set([currency, ...CURRENCIES])].map((code) => (
              <option key={code}>{code}</option>
            ))}
          </Select>
        </Field>
        <p className="text-ink-500 self-end pb-2 text-xs font-light">Seven days from today to start. The rooms stay blocked until then; past it, the offer is flagged for you to extend or withdraw.</p>
      </div>

      <div className="space-y-4 rounded-xl bg-white px-5 py-4">
        {context.termsFrom && <p className="text-ink-500 text-xs font-light">Terms from the last offer on {context.event.name} — change them for this client if needed.</p>}
        <TermsEditor payments={payments} setPayments={setPayments} cancellations={cancellations} setCancellations={setCancellations} />
        <div className="grid gap-3 sm:grid-cols-2">
          <Field label="The rate includes — one per line">
            <Textarea rows={3} value={inclusions} onChange={(e) => setInclusions(e.target.value)} placeholder={"Daily housekeeping\nComplimentary Wi-Fi\nTaxes at current levels"} />
          </Field>
          <Field label="Special conditions — one per line, optional">
            <Textarea rows={3} value={conditions} onChange={(e) => setConditions(e.target.value)} placeholder="Breakfast available at a discounted rate" />
          </Field>
        </div>
      </div>

      <div className="space-y-2">
        <FormError message={problem ?? (create.error ? friendlyError(create.error) : null)} />
        <Button type="button" onClick={submit} disabled={create.isPending}>
          {create.isPending ? "Blocking the rooms…" : "Make the offer and block the rooms"}
        </Button>
      </div>
    </div>
  );
}

const offerState = (offer: Offer) =>
  offer.status === "WITHDRAWN"
    ? { label: "Withdrawn — rooms released", style: "bg-ink-100 text-ink-500" }
    : offer.status === "SIGNED"
      ? { label: "Signed", style: "bg-[#e3f8ee] text-[#0a7a47]" }
      : offer.status === "TRUSTED"
        ? { label: "Trusted — will sign", style: "bg-[#e3f8ee] text-[#0a7a47]" }
        : offer.runOut
          ? { label: `Ran out on ${formatDate(offer.validUntil)} — extend or withdraw`, style: "bg-[#fde8ec] text-[#c03654]" }
          : { label: `Open — rooms held until ${formatDate(offer.validUntil)}`, style: "bg-brand-50 text-brand-800" };

/** The request's offers (doc §4.11): what was offered, until when, and extending or withdrawing one. */
export function RequestOffers({ salesRequestId }: { salesRequestId: string }) {
  const offers = api.offer.forRequest.useQuery({ salesRequestId });
  const [making, setMaking] = useState(false);
  if (!offers.data?.length) return null;
  const live = offers.data.some((offer) => offer.status !== "WITHDRAWN");
  return (
    <section
      className={`rounded-2xl bg-white px-6 py-5 ${live ? "border-brand-300 border-2 shadow-[0_2px_10px_rgba(115,72,214,0.10)]" : "shadow-[0_1px_3px_rgba(0,0,0,0.06)]"}`}
    >
      <div className="mb-3 flex items-baseline justify-between gap-3">
        <h2 className="text-ink-900 text-lg font-semibold">{offers.data.length === 1 ? "The contract" : "Contracts"}</h2>
        <button type="button" onClick={() => setMaking(true)} className="text-brand-700 text-[13px] font-medium hover:underline">
          + Make another offer
        </button>
      </div>
      <ul className="space-y-4">
        {offers.data.map((offer) => (
          <OfferItem key={offer.id} offer={offer} />
        ))}
      </ul>
      {making && <OfferPopup salesRequestId={salesRequestId} responseId={null} onClose={() => setMaking(false)} />}
    </section>
  );
}

function OfferItem({ offer }: { offer: Offer }) {
  const utils = api.useUtils();
  const router = useRouter();
  const [extending, setExtending] = useState<string | null>(null);
  const [withdrawing, setWithdrawing] = useState(false);
  /** Registering the signed agreement: when, and the signed copy. */
  const [signing, setSigning] = useState<{ signedOn: string; documentUrl: string } | null>(null);
  const [trusting, setTrusting] = useState(false);
  const me = api.user.me.useQuery(undefined, { staleTime: 60_000 });
  const done = () => {
    void utils.offer.invalidate();
    void utils.sales.invalidate();
    void utils.inventory.invalidate();
    router.refresh();
  };
  const extend = api.offer.extend.useMutation({ onSuccess: () => (setExtending(null), done()) });
  const withdraw = api.offer.withdraw.useMutation({ onSuccess: () => (setWithdrawing(false), done()) });
  const sign = api.offer.sign.useMutation({ onSuccess: () => (setSigning(null), done(), void utils.task.invalidate()) });
  const trust = api.offer.trust.useMutation({ onSuccess: () => (setTrusting(false), done(), void utils.task.invalidate()) });
  const signedAfterTrust = api.offer.signedAfterTrust.useMutation({ onSuccess: () => (setSigning(null), done()) });
  const state = offerState(offer);
  const rooms = offer.lines.reduce((sum, line) => sum + line.rooms, 0);

  return (
    <li className={`border-ink-200/70 rounded-xl border px-4 py-3 ${offer.status === "WITHDRAWN" ? "opacity-70" : ""}`}>
      <div className="flex flex-wrap items-center justify-between gap-2">
        <p className="text-ink-900 text-[14px] font-medium">
          {rooms} {rooms === 1 ? "room" : "rooms"} · {formatMoney(offer.totalCents, offer.currency)}
          <span className="text-ink-500 ml-2 text-xs font-light">
            made {formatDate(offer.createdAt)}
            {offer.createdBy?.name ? ` by ${offer.createdBy.name}` : ""}
          </span>
        </p>
        <span className="flex flex-wrap items-center gap-2">
          {offer.agreementSentOn && <span className="rounded-full bg-[#e3f8ee] px-2.5 py-0.5 text-[11px] font-medium text-[#0a7a47]">Agreement sent {formatDate(offer.agreementSentOn)}</span>}
          <span className={`rounded-full px-2.5 py-0.5 text-[11px] font-medium ${state.style}`}>{state.label}</span>
        </span>
      </div>
      <ul className="mt-2 space-y-0.5 text-[13px]">
        {offer.lines.map((line) => (
          <li key={line.id} className="text-ink-700 font-light">
            <span className="text-ink-900 font-medium">
              {line.rooms} × {line.category.name}
            </span>{" "}
            at {line.category.property.name} · {formatRange(line.checkIn, line.checkOut)} · {formatMoney(line.rateCents, offer.currency)} a night
          </li>
        ))}
      </ul>
      {(offer.payments.length > 0 || offer.cancellations.length > 0) && (
        <p className="text-ink-500 mt-2 text-xs font-light">
          {offer.payments.map((payment) => `${percent(payment.percentBasisPoints)} ${payment.onSignature ? "on signature" : `by ${formatDate(payment.dueOn!)}`}`).join(" · ")}
          {offer.cancellations.length > 0 && (
            <>
              {offer.payments.length > 0 && <br />}
              Cancellation:{" "}
              {offer.cancellations
                .map((cut) =>
                  cut.feeBasisPoints !== null
                    ? `${percent(cut.feeBasisPoints)} charged from ${formatDate(cut.cutoffOn)}`
                    : `${cut.kind === "ATTRITION" ? "attrition" : cut.kind === "RELEASE" ? "release" : "other"}${cut.percentBasisPoints !== null ? ` ${percent(cut.percentBasisPoints)}` : ""} until ${formatDate(cut.cutoffOn)}`,
                )
                .join(" · ")}
            </>
          )}
        </p>
      )}
      {offer.status === "OPEN" && (
        <div className="mt-3 flex flex-wrap items-center gap-3 text-[13px]">
          {extending !== null ? (
            <span className="flex flex-wrap items-center gap-2">
              Hold until
              <Input type="date" value={extending} onChange={(e) => setExtending(e.target.value)} aria-label="Hold until" className="w-40 px-2" />
              <Button type="button" onClick={() => extend.mutate({ id: offer.id, validUntil: extending })} disabled={extend.isPending || !extending}>
                {extend.isPending ? "Extending…" : "Extend"}
              </Button>
              <button type="button" onClick={() => setExtending(null)} className="text-ink-500 hover:underline">
                Cancel
              </button>
            </span>
          ) : withdrawing ? (
            <span className="flex flex-wrap items-center gap-2">
              <span className="text-[#c03654]">Withdraw the offer and release its rooms for others?</span>
              <Button type="button" variant="danger" onClick={() => withdraw.mutate({ id: offer.id })} disabled={withdraw.isPending}>
                {withdraw.isPending ? "Releasing…" : "Yes, withdraw it"}
              </Button>
              <button type="button" onClick={() => setWithdrawing(false)} className="text-ink-500 hover:underline">
                Keep it
              </button>
            </span>
          ) : signing ? (
            <SignedForm
              value={signing}
              onChange={setSigning}
              pending={sign.isPending}
              label="Register — sell the rooms"
              onSave={() => sign.mutate({ id: offer.id, ...signing })}
              onCancel={() => setSigning(null)}
            />
          ) : trusting ? (
            <span className="flex flex-wrap items-center gap-2">
              <span className="text-ink-900">Sell the rooms and secure the hotels now, before the signed agreement is back?</span>
              <Button type="button" onClick={() => trust.mutate({ id: offer.id })} disabled={trust.isPending}>
                {trust.isPending ? "Selling…" : "Yes — trust guarantee"}
              </Button>
              <button type="button" onClick={() => setTrusting(false)} className="text-ink-500 hover:underline">
                Cancel
              </button>
            </span>
          ) : (
            <>
              <Link href={`/offers/${offer.id}/agreement`} className="bg-brand-400 hover:bg-brand-500 rounded-full px-4 py-1.5 font-medium text-white">
                {offer.agreementSentOn ? "The agreement" : "Draw up the agreement →"}
              </Link>
              <button
                type="button"
                onClick={() => setSigning({ signedOn: dayKey(today()), documentUrl: "" })}
                className="border-brand-300 text-brand-700 rounded-full border px-4 py-1.5 font-medium hover:bg-brand-50"
              >
                ✓ Client signed
              </button>
              <button
                type="button"
                onClick={() => setTrusting(true)}
                disabled={!canTrust(me.data?.email)}
                title={canTrust(me.data?.email) ? "Sell the rooms before the signed agreement is back" : "Only Volki can give the trust guarantee"}
                className="text-brand-700 font-medium hover:underline disabled:cursor-not-allowed disabled:text-ink-400 disabled:no-underline"
              >
                Trust guarantee
              </button>
              <button type="button" onClick={() => setExtending(dayKey(offer.validUntil))} className="text-brand-700 font-medium hover:underline">
                Extend the hold
              </button>
              <button type="button" onClick={() => setWithdrawing(true)} className="text-[#c03654] hover:underline">
                Withdraw
              </button>
            </>
          )}
        </div>
      )}
      {(offer.status === "SIGNED" || offer.status === "TRUSTED") && offer.contract && (
        <div className="border-ink-200/60 mt-3 space-y-2 border-t pt-3 text-[13px]">
          <p className="flex flex-wrap items-center gap-x-3 gap-y-1">
            <span className="text-ink-500 w-16 shrink-0 text-xs">Client</span>
            {offer.contract.signedOn ? (
              <span className="text-[#0a7a47]">✓ Signed {formatDate(offer.contract.signedOn)}</span>
            ) : (
              <span className="text-[#7a5410]">
                Trust guarantee{offer.closedBy?.name ? ` by ${offer.closedBy.name}` : ""}
                {offer.closedAt ? ` on ${formatDate(offer.closedAt)}` : ""} — waiting for the signed agreement
              </span>
            )}
            {offer.contract.documentUrl && (
              <a href={offer.contract.documentUrl} target="_blank" rel="noreferrer" className="text-brand-700 hover:underline">
                Signed copy ↗
              </a>
            )}
            <Link href={contractHref(offer.contract.eventId, offer.contract.id)} className="text-brand-700 hover:underline">
              Contract in Finances →
            </Link>
            {offer.status === "TRUSTED" && !signing && (
              <button type="button" onClick={() => setSigning({ signedOn: dayKey(today()), documentUrl: "" })} className="text-brand-700 font-medium hover:underline">
                Add the signed agreement
              </button>
            )}
          </p>
          {offer.status === "TRUSTED" && signing && (
            <SignedForm
              value={signing}
              onChange={setSigning}
              pending={signedAfterTrust.isPending}
              label="Save"
              onSave={() => signedAfterTrust.mutate({ id: offer.id, ...signing })}
              onCancel={() => setSigning(null)}
            />
          )}
          <HotelsBehind salesRequestId={offer.salesRequestId} clientSigned={Boolean(offer.contract.signedOn)} />
        </div>
      )}
      {(extend.error ?? withdraw.error ?? sign.error ?? trust.error ?? signedAfterTrust.error) && (
        <p className="mt-2 text-xs text-[#c03654]">{friendlyError(extend.error ?? withdraw.error ?? sign.error ?? trust.error ?? signedAfterTrust.error)}</p>
      )}
    </li>
  );
}

/** When the client signed, and where the signed copy is — a Google Drive link for now. */
function SignedForm({
  value,
  onChange,
  pending,
  label,
  onSave,
  onCancel,
}: {
  value: { signedOn: string; documentUrl: string };
  onChange: (value: { signedOn: string; documentUrl: string }) => void;
  pending: boolean;
  label: string;
  onSave: () => void;
  onCancel: () => void;
}) {
  return (
    <span className="flex w-full flex-wrap items-center gap-2">
      Signed on
      <Input type="date" value={value.signedOn} onChange={(e) => onChange({ ...value, signedOn: e.target.value })} aria-label="Signed on" className="w-40 px-2" />
      <Input
        value={value.documentUrl}
        onChange={(e) => onChange({ ...value, documentUrl: e.target.value })}
        placeholder="The signed agreement — Google Drive link"
        aria-label="Signed agreement link"
        className="min-w-56 flex-1 px-2"
      />
      <Button type="button" onClick={onSave} disabled={pending || !value.signedOn}>
        {pending ? "Saving…" : label}
      </Button>
      <button type="button" onClick={onCancel} className="text-ink-500 hover:underline">
        Cancel
      </button>
    </span>
  );
}

/** The hotels behind a signed offer: each one's contract, pending or signed (doc §4.11). */
function HotelsBehind({ salesRequestId, clientSigned }: { salesRequestId: string; clientSigned: boolean }) {
  const hotels = api.offer.hotels.useQuery({ salesRequestId });
  if (!hotels.data?.length) return null;
  const allSigned = hotels.data.every((hotel) => hotel.contract?.signedOn);
  return (
    <>
      {hotels.data.map((hotel) => (
        <p key={hotel.id} className="flex flex-wrap items-center gap-x-3 gap-y-1">
          <span className="text-ink-500 w-16 shrink-0 text-xs">Hotel</span>
          <span className="text-ink-900">{hotel.name}</span>
          {hotel.contract?.signedOn ? (
            <span className="text-[#0a7a47]">✓ Signed {formatDate(hotel.contract.signedOn)} — rooms bought</span>
          ) : (
            <span className="text-[#7a5410]">Contract pending{hotel.contract ? " — made, not signed yet" : ""}</span>
          )}
          {hotel.task && (
            <Link href={`/tasks/${hotel.task.id}`} className="text-brand-700 hover:underline">
              Acquire task{hotel.task.status === "DONE" ? " (done)" : hotel.task.assignees.length ? ` · ${hotel.task.assignees.map((person) => person.name).join(", ")}` : ""} →
            </Link>
          )}
          {hotel.contract && (
            <Link href={contractHref(hotel.contract.eventId, hotel.contract.id)} className="text-brand-700 hover:underline">
              Contract →
            </Link>
          )}
        </p>
      ))}
      {allSigned && clientSigned && <p className="rounded-lg bg-[#e3f8ee] px-3 py-2 text-[#0a7a47]">✓ All clear — the client and every hotel have signed.</p>}
    </>
  );
}

/**
 * The contract task, step by step (doc §4.11): the contracting details, then
 * the offer — made, its agreement sent, signed — all from the task.
 */
export function ContractPanel({ salesRequestId }: { salesRequestId: string }) {
  const status = api.offer.contractTask.useQuery({ salesRequestId });
  const offers = api.offer.forRequest.useQuery({ salesRequestId });
  const [making, setMaking] = useState(false);
  const box = "border-ink-200/60 rounded-xl border bg-white p-5";
  if (!status.data) return null;
  const detailsIn = Boolean(status.data.tradeName && status.data.signatory);
  return (
    <>
      <div className={box}>
        <h2 className="text-ink-900 mb-1 text-[15px] font-medium">1. Their contracting details</h2>
        {detailsIn ? (
          <p className="text-[13px] text-[#0a7a47]">
            ✓ In — {status.data.tradeName}, signed by {status.data.signatory}.
          </p>
        ) : (
          <p className="text-[13px] text-[#7a5410]">
            {status.data.tradeName ? "No signatory yet." : "Not in yet."} Their rate card asks them for these; you can also send the contracting link from{" "}
            <Link href={`/sales/${salesRequestId}`} className="underline">
              the sales request
            </Link>
            .
          </p>
        )}
      </div>
      {offers.data?.length ? (
        <RequestOffers salesRequestId={salesRequestId} />
      ) : (
        <div className={box}>
          <h2 className="text-ink-900 mb-1 text-[15px] font-medium">2. The offer</h2>
          <p className="text-ink-500 mb-3 text-[13px] font-light">
            Made from what they chose on the rate card. Making it blocks the rooms for them; then draw up the agreement, send it, and register it signed.
          </p>
          <Button type="button" onClick={() => setMaking(true)}>
            Make an offer →
          </Button>
        </div>
      )}
      {making && <OfferPopup salesRequestId={salesRequestId} responseId={status.data.responseId} onClose={() => setMaking(false)} />}
    </>
  );
}
