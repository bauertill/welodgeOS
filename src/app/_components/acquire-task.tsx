"use client";

import Link from "next/link";
import { useRouter } from "next/navigation";
import { useState } from "react";

import { Button, FormError, friendlyError, Input, Select } from "~/app/_components/form";
import { dayKey, nightsBetween, today } from "~/lib/dates";
import { contractHref } from "~/lib/finance";
import { formatDate, formatMoney, formatRange } from "~/lib/format";
import { api } from "~/trpc/react";

const box = "border-ink-200/60 rounded-xl border bg-white p-5";

/**
 * The acquire task, step by step (doc §4.11, 2026-10-14): what the client
 * bought at this hotel; the hotel's quote and whose agreement the contract is
 * on; the contract made from the quote; and, once the hotel signs, the rooms
 * bought and the task done.
 */
export function AcquirePanel({ taskId, propertyId, propertyName }: { taskId: string; propertyId: string; propertyName: string }) {
  const utils = api.useUtils();
  const router = useRouter();
  const data = api.acquire.forTask.useQuery({ taskId });
  const [signing, setSigning] = useState<{ contractId: string; signedOn: string; documentUrl: string } | null>(null);
  const refresh = () => {
    void utils.acquire.invalidate();
    void utils.task.invalidate();
    void utils.offer.invalidate();
    void utils.inventory.invalidate();
    router.refresh();
  };
  const agreementOn = api.quotation.setAgreementOn.useMutation({ onSuccess: refresh });
  const makeContract = api.quotation.makeContract.useMutation({ onSuccess: refresh });
  const hotelSigned = api.acquire.hotelSigned.useMutation({ onSuccess: () => (setSigning(null), refresh()) });

  if (!data.data) return <div className={box}>{data.error ? friendlyError(data.error) : "Loading…"}</div>;
  const { request, sold, clientContract, trusted, quotes, contracts, nights, inUS } = data.data;
  const signedContract = contracts.find((contract) => contract.signedOn);
  const total = sold.reduce((sum, line) => sum + line.rooms * nightsBetween(line.checkIn, line.checkOut) * line.rateCents, 0);
  const error = agreementOn.error ?? makeContract.error ?? hotelSigned.error;

  return (
    <>
      <div className={box}>
        <div className="mb-2 flex flex-wrap items-baseline justify-between gap-3">
          <h2 className="text-ink-900 text-[15px] font-medium">
            Sold to {request.client.name} at {propertyName}
          </h2>
          <Link href={`/sales/${request.id}`} className="text-brand-700 text-[13px] font-light hover:underline">
            The sales request →
          </Link>
        </div>
        <ul className="space-y-0.5 text-[13px]">
          {sold.map((line) => (
            <li key={line.id} className="text-ink-700 font-light">
              <span className="text-ink-900 font-medium">
                {line.rooms} × {line.category.name}
              </span>{" "}
              · {formatRange(line.checkIn, line.checkOut)} · sold at {formatMoney(line.rateCents, line.currency)} a night
            </li>
          ))}
        </ul>
        {sold.length > 0 && <p className="text-ink-500 mt-1 text-xs font-light">{formatMoney(total, sold[0]!.currency)} in all.</p>}
        <p className="mt-2 text-[13px]">
          {clientContract?.signedOn ? (
            <span className="text-[#0a7a47]">✓ The client signed {formatDate(clientContract.signedOn)}.</span>
          ) : trusted ? (
            <span className="text-[#7a5410]">Trust guarantee — the client&rsquo;s signed agreement is not back yet.</span>
          ) : null}{" "}
          <span className="text-ink-500 font-light">
            On the inventory: {nights.BOUGHT ?? 0} room-nights bought, {(nights.IN_PROGRESS ?? 0) + (nights.OPTION ?? 0)} in progress with the hotel
            {nights.NONE ? `, ${nights.NONE} with nothing secured` : ""}.
          </span>
        </p>
      </div>

      <div className={box}>
        <h2 className="text-ink-900 mb-1 text-[15px] font-medium">1. Their quote, and whose agreement</h2>
        <p className="text-ink-500 mb-3 text-[13px] font-light">The hotel&rsquo;s contract is made from its quote, with its payment and cancellation terms.</p>
        {quotes.length === 0 ? (
          <p className="text-[13px] text-[#7a5410]">
            No quote from {propertyName} yet. Register it on the hotel&rsquo;s{" "}
            <Link href={`/properties/${propertyId}`} className="underline">
              Quotations tab
            </Link>{" "}
            or its contact task first.
          </p>
        ) : (
          <ul className="space-y-3">
            {quotes.map((quote) => (
              <li key={quote.id} className="border-ink-200/70 flex flex-wrap items-center gap-x-4 gap-y-2 rounded-lg border px-3 py-2.5 text-[13px]">
                <span className="text-ink-900 font-medium">{quote.name}</span>
                {quote.receivedOn && <span className="text-ink-500 text-xs font-light">received {formatDate(quote.receivedOn)}</span>}
                <span className="flex items-center gap-2">
                  <span className="text-ink-500 text-xs">Contract on</span>
                  <Select
                    value={quote.agreementOn ?? ""}
                    onChange={(e) => agreementOn.mutate({ id: quote.id, agreementOn: (e.target.value || null) as "HOTEL" | "WE_LODGE" | null })}
                    aria-label={`${quote.name}: whose agreement`}
                    className="w-48"
                  >
                    <option value="">Not known yet</option>
                    <option value="HOTEL">Their agreement</option>
                    <option value="WE_LODGE">Our agreement</option>
                  </Select>
                </span>
                {quote.contractId ? (
                  <span className="text-[#0a7a47]">✓ Contract made</span>
                ) : (
                  <Button type="button" onClick={() => makeContract.mutate({ id: quote.id })} disabled={makeContract.isPending}>
                    Make the hotel&rsquo;s contract from this quote
                  </Button>
                )}
              </li>
            ))}
          </ul>
        )}
        {quotes.some((quote) => quote.agreementOn === "WE_LODGE") && !inUS && (
          <p className="text-ink-500 mt-2 text-xs font-light">Our hotel agreement is only in the system for US events so far — use the Word version for now.</p>
        )}
      </div>

      <div className={box}>
        <h2 className="text-ink-900 mb-1 text-[15px] font-medium">2. The hotel&rsquo;s contract</h2>
        <p className="text-ink-500 mb-3 text-[13px] font-light">Send it to the hotel. Once they have signed, register it here: the rooms are bought under it and this task is done.</p>
        {contracts.length === 0 ? (
          <p className="text-ink-500 text-[13px] font-light">None yet — make it from their quote above.</p>
        ) : (
          <ul className="space-y-2">
            {contracts.map((contract) => (
              <li key={contract.id} className="flex flex-wrap items-center gap-x-3 gap-y-2 text-[13px]">
                <Link href={contractHref(contract.eventId, contract.id)} className="text-ink-900 font-medium hover:underline">
                  {contract.name}
                </Link>
                {/* On our paper (doc §4.11): our agreement, filled from the quote and the contract. */}
                {inUS && quotes.some((quote) => quote.contractId === contract.id && quote.agreementOn === "WE_LODGE") && (
                  <Link href={`/contracts/${contract.id}/agreement`} className="text-brand-700 font-medium hover:underline">
                    {contract.agreementSentOn ? `Our agreement — sent ${formatDate(contract.agreementSentOn)}` : "Draw up our agreement →"}
                  </Link>
                )}
                {contract.signedOn ? (
                  <span className="text-[#0a7a47]">✓ Signed by the hotel {formatDate(contract.signedOn)}</span>
                ) : signing?.contractId === contract.id ? (
                  <span className="flex w-full flex-wrap items-center gap-2">
                    Signed on
                    <Input type="date" value={signing.signedOn} onChange={(e) => setSigning({ ...signing, signedOn: e.target.value })} aria-label="Hotel signed on" className="w-40 px-2" />
                    <Input
                      value={signing.documentUrl}
                      onChange={(e) => setSigning({ ...signing, documentUrl: e.target.value })}
                      placeholder="The signed contract — Google Drive link"
                      aria-label="Signed contract link"
                      className="min-w-56 flex-1 px-2"
                    />
                    <Button type="button" onClick={() => hotelSigned.mutate({ taskId, ...signing })} disabled={hotelSigned.isPending || !signing.signedOn}>
                      {hotelSigned.isPending ? "Buying the rooms…" : "Register — buy the rooms"}
                    </Button>
                    <button type="button" onClick={() => setSigning(null)} className="text-ink-500 hover:underline">
                      Cancel
                    </button>
                  </span>
                ) : (
                  !signedContract && (
                    <button
                      type="button"
                      onClick={() => setSigning({ contractId: contract.id, signedOn: dayKey(today()), documentUrl: contract.documentUrl ?? "" })}
                      className="border-brand-300 text-brand-700 hover:bg-brand-50 rounded-full border px-3.5 py-1 font-medium"
                    >
                      ✓ The hotel signed
                    </button>
                  )
                )}
              </li>
            ))}
          </ul>
        )}
        {signedContract && clientContract?.signedOn && (
          <p className="mt-3 rounded-lg bg-[#e3f8ee] px-3 py-2 text-[13px] text-[#0a7a47]">✓ All clear at {propertyName} — the client and the hotel have signed.</p>
        )}
      </div>
      <FormError message={error ? friendlyError(error) : null} />
    </>
  );
}

/** The brief written into acquire tasks made before 2026-11-12 — replaced by the live summary below, so it is not shown. */
export const isGeneratedAcquireBrief = (details: string | null) => Boolean(details && /has signed\. Secure these rooms from /.test(details));

/**
 * What this acquire task is and what is left to do, worked out from where it
 * stands now (the team, 2026-11-12: the fixed brief "did not match the
 * situation") — the rooms, the hotel and the client in one line, then the one
 * next step, or that it is done and anything still loose.
 */
export function AcquireWhatToDo({ taskId, propertyName, notes }: { taskId: string; propertyName: string; notes: string | null }) {
  const data = api.acquire.forTask.useQuery({ taskId });
  if (!data.data) return null;
  const { request, sold, quotes, contracts, nights, inUS, unbought } = data.data;
  const rooms = sold.reduce((sum, line) => sum + line.rooms, 0);
  const roomNights = sold.reduce((sum, line) => sum + line.rooms * nightsBetween(line.checkIn, line.checkOut), 0);
  const first = sold.reduce<Date | null>((min, line) => (!min || line.checkIn < min ? line.checkIn : min), null);
  const last = sold.reduce<Date | null>((max, line) => (!max || line.checkOut > max ? line.checkOut : max), null);
  const signed = contracts.find((contract) => contract.signedOn);
  const loose = (nights.IN_PROGRESS ?? 0) + (nights.OPTION ?? 0) + (nights.NONE ?? 0);

  const bought = nights.BOUGHT ?? 0;
  const toBuy = unbought.reduce((sum, run) => sum + run.roomNights, 0);
  const checkOut = (last: Date) => new Date(last.getTime() + 86_400_000);

  let step: { done: boolean; text: string };
  if (toBuy === 0 && !signed && bought > 0)
    step = { done: true, text: "Every room sold here is already bought from the hotel — nothing to acquire. This task can be marked done." };
  else if (signed) step = { done: true, text: `Done — ${propertyName} signed ${signed.name} on ${formatDate(signed.signedOn!)}; the rooms are bought.` };
  else if (quotes.length === 0) step = { done: false, text: `Next: get ${propertyName}'s quote and register it on the hotel's Quotations tab.` };
  else if (!quotes.some((quote) => quote.agreementOn)) step = { done: false, text: "Next: agree with the hotel whose agreement the contract is on — theirs or ours — and choose it under step 1." };
  else if (contracts.length === 0) step = { done: false, text: "Next: make the hotel's contract from their quote (step 1)." };
  else {
    const ours = inUS && quotes.some((quote) => quote.contractId && quote.agreementOn === "WE_LODGE");
    const sent = contracts.find((contract) => contract.agreementSentOn);
    step = {
      done: false,
      text: ours && !sent
        ? "Next: draw up our agreement for the hotel (step 2), send it, then mark it signed when it comes back."
        : `Next: get the contract signed by ${propertyName}${sent ? ` (our agreement sent ${formatDate(sent.agreementSentOn!)})` : ""}, then press "The hotel signed" under step 2.`,
    };
  }

  return (
    <div className="bg-ink-50/60 mb-4 space-y-2 rounded-lg px-3 py-2.5">
      <p className="text-ink-500 text-[11px] font-medium tracking-wider uppercase">What to do</p>
      {bought > 0 && toBuy > 0 ? (
        // Some of it we hold already: the task is only about the rest.
        <div className="text-ink-900 text-sm font-light">
          <p>
            {bought} of the {roomNights} room-nights sold to <span className="font-medium">{request.client.name}</span> at{" "}
            <span className="font-medium">{propertyName}</span> are already bought. Secure the {toBuy} still open:
          </p>
          <ul className="mt-1 space-y-0.5">
            {unbought.map((run) => (
              <li key={`${run.room}-${String(run.from)}`}>
                • {run.room} — {formatRange(run.from, checkOut(run.to))} ({run.roomNights} room-night{run.roomNights === 1 ? "" : "s"})
              </li>
            ))}
          </ul>
        </div>
      ) : bought > 0 && toBuy === 0 ? (
        <p className="text-ink-900 text-sm font-light">
          All {roomNights} room-nights sold to <span className="font-medium">{request.client.name}</span> at <span className="font-medium">{propertyName}</span> are
          bought.
        </p>
      ) : (
        <p className="text-ink-900 text-sm font-light">
          Secure {rooms} room{rooms === 1 ? "" : "s"} ({roomNights} room-nights) at <span className="font-medium">{propertyName}</span> for{" "}
          <span className="font-medium">{request.client.name}</span>
          {first && last ? `, ${formatRange(first, last)}` : ""}.
        </p>
      )}
      <p className={`text-sm ${step.done ? "text-[#0a7a47]" : "text-ink-900 font-medium"}`}>{step.done ? `✓ ${step.text}` : step.text}</p>
      {loose > 0 && signed && (
        <p className="text-sm text-[#7a5410]">
          Still loose on the inventory: {loose} room-night{loose === 1 ? "" : "s"}{" "}
          {nights.NONE && !(nights.IN_PROGRESS || nights.OPTION) ? "with nothing secured" : "not bought yet (in progress or on option with the hotel)"}
          {signed ? " — check whether the signed contract covers them." : "."}
        </p>
      )}
      {notes?.trim() && !isGeneratedAcquireBrief(notes) && (
        <div>
          <p className="text-ink-500 mt-1 text-[11px] font-medium tracking-wider uppercase">Notes</p>
          <p className="text-ink-900 text-sm font-light whitespace-pre-line">{notes}</p>
        </div>
      )}
    </div>
  );
}
