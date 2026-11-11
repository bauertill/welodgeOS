"use client";

import { useEffect, useState } from "react";

import { Button, FormError, friendlyError, Input } from "~/app/_components/form";
import { Card } from "~/app/_components/ui";
import { byStart, eventPeriodProblem, periodColour, type EventPeriodDays } from "~/lib/event-periods";
import { nightsBetween, parseDay } from "~/lib/dates";
import { api } from "~/trpc/react";

/**
 * The event's periods (doc §3.10), on its Edit page. Most events have none —
 * their own dates are the one period. LA28 has three: Olympics, Between Games,
 * Paralympics, each priced on its own.
 */
export function EventPeriods({ eventId, eventStart, eventEnd }: { eventId: string; eventStart: string; eventEnd: string }) {
  const utils = api.useUtils();
  const saved = api.event.periods.useQuery({ eventId });
  const [draft, setDraft] = useState<EventPeriodDays[] | null>(null);
  useEffect(() => {
    if (saved.data && draft === null) setDraft(saved.data.map(({ name, from, to }) => ({ name, from, to })));
  }, [saved.data, draft]);
  const save = api.event.savePeriods.useMutation({
    onSuccess: async () => {
      await utils.event.periods.invalidate({ eventId });
      setDraft(null);
    },
  });

  const rows = draft ?? [];
  const problem = rows.length ? eventPeriodProblem(rows) : null;
  const changed = JSON.stringify(rows) !== JSON.stringify((saved.data ?? []).map(({ name, from, to }) => ({ name, from, to })));
  const set = (index: number, key: keyof EventPeriodDays, value: string) => setDraft(rows.map((row, i) => (i === index ? { ...row, [key]: value } : row)));
  const add = () => {
    const last = byStart(rows).at(-1);
    setDraft([...rows, { name: "", from: last?.to ?? eventStart, to: last ? "" : eventEnd }]);
  };

  return (
    <Card>
      <h2 className="text-ink-900 text-[15px] font-medium">Periods</h2>
      <p className="text-ink-500 mt-1 mb-4 text-sm font-light">
        Only for an event priced in parts — LA28&rsquo;s Olympics, the days between and the Paralympics. Each is named, with its first night
        and its check-out day; there may be gaps between them, never overlaps. They show on the stock sheet, split a rate by period, and fill
        in dates on quotations and sales requests. With none, the event&rsquo;s own dates are its one period.
      </p>

      {rows.length > 0 && (
        <div className="space-y-2">
          <div className="text-ink-500 hidden grid-cols-[1rem_minmax(0,1.4fr)_minmax(0,1fr)_minmax(0,1fr)_5rem_4rem] gap-2 text-[11px] sm:grid">
            <span />
            <span>Name</span>
            <span>First night</span>
            <span>Check-out day</span>
            <span>Nights</span>
            <span />
          </div>
          {rows.map((row, index) => {
            const nights = row.from && row.to && row.to > row.from ? nightsBetween(parseDay(row.from), parseDay(row.to)) : null;
            const colourIndex = byStart(rows).indexOf(row);
            return (
              <div key={index} className="grid grid-cols-[1rem_minmax(0,1fr)] items-center gap-2 sm:grid-cols-[1rem_minmax(0,1.4fr)_minmax(0,1fr)_minmax(0,1fr)_5rem_4rem]">
                <span aria-hidden="true" className="h-3 w-3 rounded-full" style={{ backgroundColor: periodColour(colourIndex) }} />
                <Input value={row.name} onChange={(e) => set(index, "name", e.target.value)} placeholder="Olympics" aria-label={`Period ${index + 1} name`} />
                <Input type="date" value={row.from} onChange={(e) => set(index, "from", e.target.value)} aria-label={`Period ${index + 1} first night`} className="col-start-2 sm:col-start-auto" />
                <Input type="date" value={row.to} onChange={(e) => set(index, "to", e.target.value)} aria-label={`Period ${index + 1} check-out day`} className="col-start-2 sm:col-start-auto" />
                <span className="text-ink-500 col-start-2 text-xs font-light sm:col-start-auto">{nights !== null ? `${nights} ${nights === 1 ? "night" : "nights"}` : "—"}</span>
                <button type="button" onClick={() => setDraft(rows.filter((_, i) => i !== index))} className="col-start-2 text-left text-xs text-[#c03654] hover:underline sm:col-start-auto">
                  Remove
                </button>
              </div>
            );
          })}
        </div>
      )}

      <div className="mt-4 space-y-2">
        <FormError message={save.error ? friendlyError(save.error) : changed ? problem : null} />
        <div className="flex flex-wrap items-center gap-3">
          <Button type="button" variant="ghost" onClick={add}>
            + Add a period
          </Button>
          <Button type="button" disabled={!changed || Boolean(problem) || save.isPending} onClick={() => save.mutate({ eventId, periods: rows.map((row) => ({ ...row, name: row.name.trim() })) })}>
            {save.isPending ? "Saving…" : "Save periods"}
          </Button>
          {save.isSuccess && !changed && <span className="text-ink-500 text-xs font-light">Saved.</span>}
        </div>
      </div>
    </Card>
  );
}
