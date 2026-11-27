"use client";

import { useRouter } from "next/navigation";
import { useEffect, useMemo, useState } from "react";

import { Button, Input } from "~/app/_components/form";
import { formatMoney, formatRange } from "~/lib/format";
import { parseDay } from "~/lib/dates";
import { api } from "~/trpc/react";

/**
 * A hotel's contract and its nights on the stock sheet (doc §7.1, the owner
 * 2026-11-27: "the contract is loaded, yet the inventory still shows it's not
 * contracted"). Says how many nights are bought under the contract and which
 * of the hotel's booked nights are not bought yet, room by room; picks out the
 * rooms the contract names; a booked room the contract does not name can be
 * moved to one it names that is empty; then the rooms are bought under the
 * contract in one step, through the stock sheet's own rules and ledger.
 */
export function ContractStock({ contractId }: { contractId: string }) {
  const utils = api.useUtils();
  const router = useRouter();
  const stock = api.roomMove.contractStock.useQuery({ contractId });
  const data = stock.data;
  const withOpen = useMemo(() => (data?.rooms ?? []).filter((room) => room.open.length > 0), [data]);
  const anyNamed = (data?.rooms ?? []).some((room) => room.named);
  const [picked, setPicked] = useState<string[] | null>(null);
  const [from, setFrom] = useState("");
  const [to, setTo] = useState("");
  const [price, setPrice] = useState<string | null>(null);
  const refresh = () => {
    void utils.roomMove.invalidate();
    void utils.inventory.invalidate();
    void utils.finance.invalidate();
    router.refresh();
  };
  const buy = api.roomMove.buyForContract.useMutation({ onSuccess: refresh });
  const move = api.roomMove.move.useMutation({ onSuccess: refresh });

  // What to start from: the booked rooms the contract names (all booked rooms when it names none), over their dates.
  const defaultPicked = useMemo(() => withOpen.filter((room) => !anyNamed || room.named).map((room) => room.id), [withOpen, anyNamed]);
  const chosen = picked ?? defaultPicked;
  useEffect(() => {
    const runs = withOpen.filter((room) => chosen.includes(room.id)).flatMap((room) => room.open);
    if (!runs.length) return;
    setFrom(runs.map((run) => run.from).sort()[0]!);
    setTo(runs.map((run) => run.to).sort().at(-1)!);
    // eslint-disable-next-line react-hooks/exhaustive-deps -- only when the rooms picked change
  }, [chosen.join(","), withOpen]);

  if (!data) return null;
  const currency = data.currency;
  const priceText = price ?? (data.suggestedCents !== null ? (data.suggestedCents / 100).toFixed(2) : "");
  const unnamedBooked = anyNamed ? withOpen.filter((room) => !room.named) : [];
  const namedEmpty = data.rooms.filter((room) => room.named && room.open.length === 0 && room.boughtHere === 0);
  const done = data.openNights === 0;

  if (done && data.boughtHere === 0) return null;
  if (done) {
    return (
      <div className="rounded-xl bg-[#e3f8ee] px-4 py-3 text-[13px] text-[#0a7a47]">
        ✓ {data.boughtHere} room-nights bought under this contract on the stock sheet — every booked night of this hotel on the event.
      </div>
    );
  }

  return (
    <section className={`rounded-xl border-2 bg-white px-5 py-4 ${data.boughtHere ? "border-brand-200" : "border-[#f0c36d]"}`}>
      <h2 className="text-ink-900 text-[15px] font-semibold">On the stock sheet</h2>
      <p className="text-ink-700 mt-1 text-[13px] font-light">
        {data.boughtHere
          ? `${data.boughtHere} room-nights are bought under this contract; ${data.openNights} more of this hotel's booked nights on the event are not bought yet.`
          : `None of this hotel's nights on the event are bought under this contract yet — the stock sheet still shows ${data.openNights} booked nights as not bought.`}
        {anyNamed && " The rooms the contract names are picked out."}
      </p>

      {unnamedBooked.length > 0 && namedEmpty.length > 0 && (
        <div className="mt-3 rounded-lg bg-[#fdf6e7] px-3 py-2.5 text-[13px] text-[#7a5410]">
          <p>
            <span className="font-medium">The rooms don&rsquo;t match.</span> Booked but not named in the contract: {unnamedBooked.map((room) => room.name).join(", ")}. Named in the
            contract but empty: {namedEmpty.map((room) => room.name).join(", ")}. If the hotel changed the room, move the booking:
          </p>
          <ul className="mt-1.5 space-y-1.5">
            {unnamedBooked.map((room) => (
              <li key={room.id} className="flex flex-wrap items-center gap-2">
                <span className="text-ink-900 font-medium">{room.name}</span>
                <span className="text-ink-500 text-xs">→</span>
                {namedEmpty.map((target) => (
                  <button
                    key={target.id}
                    type="button"
                    disabled={move.isPending}
                    onClick={() =>
                      move.mutate({
                        eventId: data.eventId,
                        fromSlotId: room.id,
                        toSlotId: target.id,
                        checkIn: room.open.map((run) => run.from).sort()[0]!,
                        checkOut: room.open.map((run) => run.to).sort().at(-1)!,
                        reason: "The hotel's contract names another room",
                      })
                    }
                    className="border-brand-300 text-brand-700 hover:bg-brand-50 rounded-full border bg-white px-3 py-0.5 text-xs font-medium"
                  >
                    Move to {target.name}
                  </button>
                ))}
              </li>
            ))}
          </ul>
          {move.error && <p className="mt-1 text-xs text-[#c03654]">{move.error.message}</p>}
        </div>
      )}

      <ul className="mt-3 space-y-1.5">
        {withOpen.map((room) => (
          <li key={room.id}>
            <label className="flex cursor-pointer items-start gap-2 text-[13px]">
              <input
                type="checkbox"
                className="accent-brand-500 mt-0.5"
                checked={chosen.includes(room.id)}
                onChange={(e) => setPicked(e.target.checked ? [...chosen, room.id] : chosen.filter((id) => id !== room.id))}
              />
              <span>
                <span className="text-ink-900 font-medium">{room.name}</span>
                {room.named && <span className="bg-brand-50 text-brand-800 ml-2 rounded-full px-2 py-0.5 text-[11px]">named in the contract</span>}
                <span className="text-ink-500 block text-xs font-light">
                  {room.open
                    .map((run) => `${formatRange(parseDay(run.from), parseDay(run.to))} · ${run.nights} ${run.nights === 1 ? "night" : "nights"}${run.client ? ` · ${run.sold ? "sold to" : "for"} ${run.client}` : ""}`)
                    .join("; ")}
                  {room.boughtElsewhere > 0 && ` · ${room.boughtElsewhere} nights bought under another contract`}
                </span>
              </span>
            </label>
          </li>
        ))}
      </ul>

      <div className="mt-3 flex flex-wrap items-end gap-3">
        <label className="block">
          <span className="text-ink-500 mb-1 block text-[11px]">From (check-in)</span>
          <Input type="date" value={from} onChange={(e) => setFrom(e.target.value)} className="w-40 px-2" />
        </label>
        <label className="block">
          <span className="text-ink-500 mb-1 block text-[11px]">To (check-out)</span>
          <Input type="date" value={to} onChange={(e) => setTo(e.target.value)} className="w-40 px-2" />
        </label>
        <label className="block">
          <span className="text-ink-500 mb-1 block text-[11px]">Buy price per night ({currency})</span>
          <Input value={priceText} onChange={(e) => setPrice(e.target.value)} inputMode="decimal" placeholder="Optional" className="w-32 px-2" />
        </label>
        <Button
          type="button"
          disabled={buy.isPending || chosen.length === 0 || !from || !to || to <= from}
          onClick={() => {
            const value = priceText.trim() ? Number(priceText.replace(/[\s',]/g, "")) : null;
            buy.mutate({ contractId, slotIds: chosen, checkIn: from, checkOut: to, buyPriceCents: value !== null && Number.isFinite(value) ? Math.round(value * 100) : null });
          }}
        >
          {buy.isPending ? "Buying…" : `Mark ${chosen.length} ${chosen.length === 1 ? "room" : "rooms"} bought under this contract`}
        </Button>
      </div>
      {data.suggestedCents !== null && price === null && (
        <p className="text-ink-500 mt-1 text-xs font-light">
          {formatMoney(data.suggestedCents, currency)} a night: the contract&rsquo;s total over the nights of the rooms it names.
        </p>
      )}
      {buy.error && <p className="mt-1.5 text-xs text-[#c03654]">{buy.error.message}</p>}
      {buy.data && <p className="mt-1.5 text-xs text-[#0a7a47]">✓ {buy.data.nights} room-nights bought under this contract.</p>}
    </section>
  );
}
