"use client";

import type { BudgetBasis, CleaningWanted } from "generated/prisma";
import { useRouter } from "next/navigation";
import { useEffect, useState } from "react";

import { Button, Field, FormError, friendlyError, Input, Label, Select, Textarea } from "~/app/_components/form";
import { CloseToPicker, type Point } from "~/app/_components/close-to-picker";
import { InfoTip } from "~/app/_components/info-tip";
import { DatePicker } from "~/app/_components/date-picker";
import { Card } from "~/app/_components/ui";
import { dayKey, nightsBetween } from "~/lib/dates";
import { formatDate, formatMoney, formatMomentInWords, formatRange } from "~/lib/format";
import { cleaningWantedLabels, cleaningWantedOrder, peopleWords, wishes } from "~/lib/needs";
import { currencyForCountry, roomTypeGroups } from "~/lib/sales";
import { api, type RouterOutputs } from "~/trpc/react";

/**
 * A sales request in detail (doc §4.11): it starts as an enquiry — what the
 * client asked, in their words — and becomes a sales request once its details
 * are in: rooms, period, budget, where to be close to, and the client's
 * comments. They are given after a call, or by the client through their link.
 */

type FullRequest = NonNullable<RouterOutputs["sales"]["byId"]>;
type Place = { id: string; name: string; latitude?: number; longitude?: number };
const knownRoomTypes = new Set<string>(roomTypeGroups.flatMap((group) => group.types.map((type) => type.name)));

/** What a unit is — the number on each line counts these (doc §4.11). */
const UNIT_HINT = "One unit is one hotel room or one whole apartment — a 3-bedroom apartment counts as 1 unit.";

const CURRENCIES = ["EUR", "USD", "CHF", "GBP"];
export const budgetBasisLabels: Record<BudgetBasis, string> = {
  PER_ROOM_NIGHT: "per room per night",
  PER_PERSON_NIGHT: "per person per night",
  TOTAL: "in total",
};

export type LineDraft = { rooms: string; roomType: string; people: string; checkIn: string; checkOut: string };
const blankLine = (from?: LineDraft): LineDraft => ({
  rooms: "",
  roomType: "",
  people: from?.people ?? "",
  // Another period usually starts where the last one ended.
  checkIn: from?.checkOut ?? "",
  checkOut: "",
});

export type DetailsValues = {
  lines: LineDraft[];
  budget: string;
  budgetCurrency: string;
  budgetBasis: BudgetBasis;
  closeToIds: string[];
  points: Point[];
  closeToOther: string;
  clientComments: string;
  breakfast: boolean | null;
  cleaning: CleaningWanted | null;
  parking: boolean | null;
  parkingSpaces: string;
};

type StoredLine = { rooms: number; roomType: string | null; people?: number | null; checkIn: Date | string | null; checkOut: Date | string | null };

export function detailsFrom(
  values: {
  lines: StoredLine[];
  budgetCents: number | null;
  budgetCurrency: string | null;
  budgetBasis: BudgetBasis | null;
  closeToIds: string[];
  closeToOther: string | null;
  clientComments: string | null;
  points?: { label: string; address: string | null; latitude: number; longitude: number }[];
  breakfast?: boolean | null;
  cleaning?: CleaningWanted | null;
  parking?: boolean | null;
  parkingSpaces?: number | null;
  },
  /** The event's currency, for a budget not given yet. */
  defaultCurrency = "EUR",
): DetailsValues {
  const day = (value: Date | string | null) => (!value ? "" : typeof value === "string" ? value : dayKey(value));
  return {
    lines: values.lines.length
      ? values.lines.map((line) => ({
          rooms: line.rooms ? String(line.rooms) : "",
          roomType: line.roomType ?? "",
          people: line.people ? String(line.people) : "",
          checkIn: day(line.checkIn),
          checkOut: day(line.checkOut),
        }))
      : [blankLine()],
    budget: values.budgetCents !== null ? (values.budgetCents / 100).toFixed(2).replace(/\.00$/, "") : "",
    budgetCurrency: values.budgetCurrency ?? defaultCurrency,
    budgetBasis: values.budgetBasis ?? "PER_ROOM_NIGHT",
    closeToIds: values.closeToIds,
    closeToOther: values.closeToOther ?? "",
    points: (values.points ?? []).map((point) => ({ ...point, address: point.address ?? "" })),
    clientComments: values.clientComments ?? "",
    breakfast: values.breakfast ?? null,
    cleaning: values.cleaning ?? null,
    parking: values.parking ?? null,
    parkingSpaces: values.parkingSpaces ? String(values.parkingSpaces) : "",
  };
}

/** The details as the server takes them; a problem in words when something does not read. */
export function detailsInput(values: DetailsValues): { problem: string } | { input: ReturnType<typeof toInput> } {
  const lines = [];
  // A line with nothing in it is left out, not refused.
  for (const [index, line] of values.lines.entries()) {
    if (!line.rooms.trim() && !line.roomType.trim() && !line.checkIn && !line.checkOut) continue;
    const label = values.lines.length > 1 ? `Line ${index + 1}: ` : "";
    const rooms = Number(line.rooms);
    if (!line.rooms.trim() || !Number.isInteger(rooms) || rooms < 1) return { problem: `${label}say how many units, like 20.` };
    if (line.checkIn && line.checkOut && line.checkOut <= line.checkIn) return { problem: `${label}the departure must be after the arrival.` };
    const people = line.people.trim() ? Number(line.people) : null;
    if (people !== null && (!Number.isInteger(people) || people < 1)) return { problem: `${label}people per unit should be a number, like 2.` };
    lines.push({ rooms, roomType: line.roomType, people, checkIn: line.checkIn, checkOut: line.checkOut });
  }
  const budget = values.budget.trim() ? Number(values.budget.replace(/[’'\s,]/g, "")) : null;
  if (budget !== null && (!Number.isFinite(budget) || budget < 0)) return { problem: "The budget should be an amount, like 180." };
  const spaces = values.parking && values.parkingSpaces.trim() ? Number(values.parkingSpaces) : null;
  if (spaces !== null && (!Number.isInteger(spaces) || spaces < 1)) return { problem: "Parking: say how many cars, like 3." };
  return { input: toInput(values, lines, budget, spaces) };
}
function toInput(
  values: DetailsValues,
  lines: { rooms: number; roomType: string; people: number | null; checkIn: string; checkOut: string }[],
  budget: number | null,
  parkingSpaces: number | null,
) {
  return {
    lines,
    budgetCents: budget === null ? null : Math.round(budget * 100),
    budgetCurrency: budget === null ? null : values.budgetCurrency,
    budgetBasis: budget === null ? null : values.budgetBasis,
    closeToIds: values.closeToIds,
    points: values.points,
    closeToOther: values.closeToOther,
    clientComments: values.clientComments,
    breakfast: values.breakfast,
    cleaning: values.cleaning,
    parking: values.parking,
    parkingSpaces,
  };
}

/** The boxes, the same for us and for the client on their link. */
export function DetailsFields({
  values,
  onChange,
  places,
  forClient = false,
  find,
  eventStart,
}: {
  values: DetailsValues;
  onChange: (values: DetailsValues) => void;
  places: Place[];
  forClient?: boolean;
  /** An address → its position: through the client's link, or ours. */
  find: (address: string) => Promise<{ latitude: number; longitude: number; address: string | null } | null>;
  /** "2028-07-10": the event's first day — the calendars open on its month. */
  eventStart?: string | null;
}) {
  const set = <K extends keyof DetailsValues>(key: K, value: DetailsValues[K]) => onChange({ ...values, [key]: value });
  const setLine = (index: number, patch: Partial<LineDraft>) =>
    set(
      "lines",
      values.lines.map((line, i) => (i === index ? { ...line, ...patch } : line)),
    );
  return (
    <div className="space-y-4">
      <div>
        <Label>{forClient ? "The units you need, and when" : "Units and periods"}</Label>
        <div className="space-y-2">
          {values.lines.map((line, index) => (
            <div key={index} className="border-ink-200/60 grid grid-cols-2 gap-2 rounded-lg border p-2 sm:grid-cols-[4.75rem_minmax(10rem,1fr)_5.5rem_8.75rem_8.75rem_1.25rem] sm:items-end sm:border-0 sm:p-0">
              <label className="min-w-0">
                <span className="text-ink-500 mb-1 block text-[11px] whitespace-nowrap">
                  Units
                  <InfoTip text={UNIT_HINT} />
                </span>
                <Input value={line.rooms} onChange={(e) => setLine(index, { rooms: e.target.value })} inputMode="numeric" placeholder="20" aria-label={`Line ${index + 1} units`} className="px-2" />
              </label>
              <label className="min-w-0">
                <span className="text-ink-500 mb-1 block text-[11px]">Type</span>
                {line.roomType && !knownRoomTypes.has(line.roomType) && line.roomType !== "__other__" ? (
                  <Input value={line.roomType} onChange={(e) => setLine(index, { roomType: e.target.value })} aria-label={`Line ${index + 1} room type`} autoFocus />
                ) : (
                  <Select
                    value={line.roomType}
                    onChange={(e) => {
                      const name = e.target.value;
                      setLine(index, { roomType: name === "__other__" ? " " : name });
                    }}
                    aria-label={`Line ${index + 1} room type`}
                  >
                    <option value="">Choose…</option>
                    {roomTypeGroups.map((group) => (
                      <optgroup key={group.kind} label={group.label}>
                        {group.types.map((type) => (
                          <option key={type.name} value={type.name}>
                            {/* Short: the group's name says the rest. */}
                            {type.short}
                          </option>
                        ))}
                      </optgroup>
                    ))}
                    <option value="__other__">Something else…</option>
                  </Select>
                )}
              </label>
              <label className="min-w-0">
                <span className="text-ink-500 mb-1 block text-[11px] whitespace-nowrap">People / unit</span>
                <Input value={line.people} onChange={(e) => setLine(index, { people: e.target.value })} inputMode="numeric" placeholder="2" aria-label={`Line ${index + 1} people per unit`} className="px-2" />
              </label>
              <label className="min-w-0">
                <span className="text-ink-500 mb-1 block text-[11px]">Arrival</span>
                <DatePicker
                  value={line.checkIn}
                  onChange={(day) => setLine(index, { checkIn: day })}
                  openAt={values.lines[index - 1]?.checkOut || eventStart}
                  ariaLabel={`Line ${index + 1} arrival`}
                />
              </label>
              <label className="min-w-0">
                <span className="text-ink-500 mb-1 block text-[11px]">Departure</span>
                <DatePicker
                  value={line.checkOut}
                  onChange={(day) => setLine(index, { checkOut: day })}
                  openAt={line.checkIn || eventStart}
                  ariaLabel={`Line ${index + 1} departure`}
                />
              </label>
              {values.lines.length > 1 ? (
                <button
                  type="button"
                  aria-label={`Remove line ${index + 1}`}
                  onClick={() => set("lines", values.lines.filter((_, i) => i !== index))}
                  className="text-ink-400 pb-2 text-lg leading-none hover:text-[#c03654]"
                >
                  ×
                </button>
              ) : (
                <span />
              )}
            </div>
          ))}
        </div>
        <button type="button" onClick={() => set("lines", [...values.lines, blankLine(values.lines.at(-1))])} className="text-brand-700 mt-2 text-[13px] font-medium hover:underline">
          + Add another period or room type
        </button>
      </div>
      <div>
        <Label>{forClient ? "Your budget" : "Budget"}</Label>
        <div className="flex flex-wrap gap-2">
          <Input value={values.budget} onChange={(e) => set("budget", e.target.value)} inputMode="decimal" placeholder="180" aria-label="Budget" className="w-32" />
          <Select value={values.budgetCurrency} onChange={(e) => set("budgetCurrency", e.target.value)} aria-label="Currency" className="w-24">
            {(CURRENCIES.includes(values.budgetCurrency) ? CURRENCIES : [values.budgetCurrency, ...CURRENCIES]).map((code) => (
              <option key={code}>{code}</option>
            ))}
          </Select>
          <Select value={values.budgetBasis} onChange={(e) => set("budgetBasis", e.target.value as BudgetBasis)} aria-label="Budget per" className="w-52">
            {(Object.keys(budgetBasisLabels) as BudgetBasis[]).map((basis) => (
              <option key={basis} value={basis}>
                {budgetBasisLabels[basis]}
              </option>
            ))}
          </Select>
        </div>
      </div>
      <div>
        <Label>{forClient ? "Where would you like to be close to?" : "Close to"}</Label>
        {places.length > 0 && (
          <div className="mb-2 flex flex-wrap gap-1.5">
            {places.map((place) => {
              const chosen = values.closeToIds.includes(place.id);
              return (
                <button
                  key={place.id}
                  type="button"
                  aria-pressed={chosen}
                  onClick={() => set("closeToIds", chosen ? values.closeToIds.filter((id) => id !== place.id) : [...values.closeToIds, place.id])}
                  className={`rounded-full border px-3 py-1.5 text-[13px] transition-colors ${
                    chosen ? "border-brand-400 bg-brand-50 text-brand-800 font-medium" : "border-ink-200 text-ink-500 hover:text-ink-900 bg-white font-light"
                  }`}
                >
                  {place.name}
                </button>
              );
            })}
          </div>
        )}
        <CloseToPicker points={values.points} onChange={(points) => set("points", points)} places={places} find={find} />
        {values.closeToOther && (
          // Said in words before places could be found on a map.
          <Input value={values.closeToOther} onChange={(e) => set("closeToOther", e.target.value)} aria-label="Close to, in words" className="mt-2" />
        )}
      </div>
      <div>
        <Label>{forClient ? "What you would like with the rooms" : "What they want with the rooms"}</Label>
        <div className="border-ink-200/60 divide-ink-200/60 divide-y rounded-lg border">
          <WishRow label="Breakfast">
            <YesNo value={values.breakfast} onChange={(value) => set("breakfast", value)} />
          </WishRow>
          <WishRow label="Parking">
            <YesNo value={values.parking} onChange={(value) => set("parking", value)} />
            {values.parking && (
              <span className="text-ink-700 ml-2 flex items-center gap-2 text-[13px] font-light">
                <Input value={values.parkingSpaces} onChange={(e) => set("parkingSpaces", e.target.value)} inputMode="numeric" placeholder="3" aria-label="How many cars" className="w-16 px-2 py-1" />
                cars
              </span>
            )}
          </WishRow>
          <WishRow label="Cleaning">
            {cleaningWantedOrder.map((option) => (
              <Choice key={option} on={values.cleaning === option} onClick={() => set("cleaning", values.cleaning === option ? null : option)}>
                {cleaningWantedLabels[option]}
              </Choice>
            ))}
          </WishRow>
        </div>
      </div>
      <Field label={forClient ? "Anything else we should know" : "Client's comments"}>
        <Textarea rows={3} value={values.clientComments} onChange={(e) => set("clientComments", e.target.value)} placeholder="Arriving in two groups, a quiet floor, close to each other…" />
      </Field>
    </div>
  );
}

/** A pill to choose, on or off. */
function Choice({ on, onClick, children }: { on: boolean; onClick: () => void; children: React.ReactNode }) {
  return (
    <button
      type="button"
      aria-pressed={on}
      onClick={onClick}
      className={`rounded-full border px-3 py-1 text-[13px] transition-colors ${
        on ? "border-brand-400 bg-brand-50 text-brand-800 font-medium" : "border-ink-200 text-ink-500 hover:text-ink-900 bg-white font-light"
      }`}
    >
      {children}
    </button>
  );
}

/** Yes, No — or, clicked again, not said. */
function YesNo({ value, onChange }: { value: boolean | null; onChange: (value: boolean | null) => void }) {
  return (
    <>
      <Choice on={value === true} onClick={() => onChange(value === true ? null : true)}>
        Yes
      </Choice>
      <Choice on={value === false} onClick={() => onChange(value === false ? null : false)}>
        No
      </Choice>
    </>
  );
}

/** One wish on its line: its name, then its choices. */
function WishRow({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <div className="flex flex-col gap-2 px-3 py-2.5 sm:flex-row sm:items-center">
      <span className="text-ink-700 w-24 shrink-0 text-[13px]">{label}</span>
      <div className="flex flex-wrap items-center gap-1.5">{children}</div>
    </div>
  );
}

function useSaved() {
  const router = useRouter();
  const utils = api.useUtils();
  return () => {
    void utils.sales.invalidate();
    void utils.audit.invalidate();
    router.refresh();
  };
}

/** The event's own dates, where a first line starts. */
const eventStay = (event: { startDate: Date; endDate: Date } | null) =>
  event ? { checkIn: dayKey(event.startDate), checkOut: dayKey(event.endDate) } : null;

/** Whether a request is still an enquiry, or a sales request with its details in. */
export function RequestKind({ request }: { request: { detailedAt: Date | null } }) {
  return request.detailedAt ? (
    <span className="bg-brand-50 text-brand-800 rounded-full px-2.5 py-0.5 text-[11px] font-medium">Sales request</span>
  ) : (
    <span className="rounded-full bg-[#fff4e0] px-2.5 py-0.5 text-[11px] font-medium text-[#8a5a00]">Enquiry</span>
  );
}

/** The details card on a request: shown, filled in after a call, or asked of the client. */
export function RequestDetailsCard({ request }: { request: FullRequest }) {
  const saved = useSaved();
  const places = api.place.listForEvent.useQuery({ eventId: request.event?.id ?? "" }, { enabled: Boolean(request.event) });
  const [editing, setEditing] = useState(false);
  const [values, setValues] = useState<DetailsValues>(() => detailsFrom({ ...request, lines: request.lines, closeToIds: request.closeTo.map((place) => place.id), points: request.closeToPoints }, currencyForCountry(request.event?.country)));
  const [problem, setProblem] = useState<string | null>(null);
  const save = api.sales.saveDetails.useMutation({
    onSuccess: () => {
      saved();
      setEditing(false);
    },
  });
  const placeList = (places.data ?? []).map((place) => ({ id: place.id, name: place.name, latitude: place.latitude, longitude: place.longitude }));
  const geocode = api.property.geocode.useMutation();
  const closeTo = [...request.closeTo.map((place) => place.name), ...request.closeToPoints.map((point) => point.label), request.closeToOther]
    .filter(Boolean)
    .join(", ");

  return (
    <Card>
      <div className="mb-3 flex items-center justify-between gap-3">
        <h2 className="text-ink-900 flex items-center gap-2 text-[15px] font-medium">
          The request in detail <RequestKind request={request} />
        </h2>
        {!editing && (
          <button
            type="button"
            onClick={() => {
              setValues(detailsFrom({ ...request, lines: request.lines, closeToIds: request.closeTo.map((place) => place.id), points: request.closeToPoints }, currencyForCountry(request.event?.country)));
              setEditing(true);
            }}
            className="text-brand-700 text-[13px] font-light hover:underline"
          >
            {request.detailedAt ? "Edit" : "Fill in after a call"}
          </button>
        )}
      </div>

      {editing ? (
        <form
          onSubmit={(e) => {
            e.preventDefault();
            setProblem(null);
            const result = detailsInput(values);
            if ("problem" in result) return setProblem(result.problem);
            save.mutate({ id: request.id, ...result.input });
          }}
        >
          <DetailsFields
            values={values}
            onChange={setValues}
            places={placeList}
            find={(address) => geocode.mutateAsync({ address })}
            eventStart={eventStay(request.event)?.checkIn}
          />
          <div className="mt-4 space-y-2">
            <FormError message={problem ?? (save.error ? friendlyError(save.error) : null)} />
            <div className="flex gap-2">
              <Button type="submit" disabled={save.isPending}>
                {save.isPending ? "Saving…" : request.detailedAt ? "Save" : "Save — it becomes a sales request"}
              </Button>
              <Button type="button" variant="ghost" onClick={() => setEditing(false)}>
                Cancel
              </Button>
            </div>
          </div>
        </form>
      ) : request.detailedAt ? (
        // What the client asked, made to stand out (doc §4.11): each line large, its dates beneath.
        <div>
          <div className="border-brand-200 bg-brand-50/60 rounded-xl border px-5 py-4">
            {request.lines.length === 0 ? (
              <p className="text-ink-500 text-sm font-light">No units given yet.</p>
            ) : (
              <ul className="space-y-3">
                {request.lines.map((line) => (
                  <li key={line.id}>
                    <span className="text-ink-900 block text-lg font-semibold" title={UNIT_HINT}>
                      {line.rooms} × {line.roomType ?? "units"}
                    </span>
                    <span className="text-ink-700 block text-[13px] font-light">
                      {[
                        line.checkIn && line.checkOut
                          ? `${formatRange(line.checkIn, line.checkOut)} · ${nightsBetween(line.checkIn, line.checkOut)} nights`
                          : line.checkIn
                            ? `From ${formatDate(line.checkIn)}`
                            : "Dates not given",
                        peopleWords(line.people),
                      ]
                        .filter(Boolean)
                        .join(" · ")}
                    </span>
                  </li>
                ))}
              </ul>
            )}
            <div className="border-brand-200/70 mt-4 grid gap-x-6 gap-y-3 border-t pt-3 text-sm sm:grid-cols-2">
              <div>
                <p className="text-brand-800 text-[11px] font-medium tracking-wider uppercase">Budget</p>
                <p className="text-ink-900 font-medium">
                  {request.budgetCents !== null && request.budgetCurrency ? formatMoney(request.budgetCents, request.budgetCurrency) : "—"}
                  {request.budgetCents !== null && request.budgetBasis && <span className="text-ink-500 font-light"> {budgetBasisLabels[request.budgetBasis]}</span>}
                </p>
              </div>
              <div>
                <p className="text-brand-800 text-[11px] font-medium tracking-wider uppercase">Close to</p>
                {closeTo ? (
                  <div className="mt-0.5 flex flex-wrap gap-1.5">
                    {closeTo.split(", ").map((place) => (
                      <span key={place} className="bg-ink-900 rounded-full px-2.5 py-0.5 text-xs text-white">
                        {place}
                      </span>
                    ))}
                  </div>
                ) : (
                  <p className="text-ink-900">—</p>
                )}
              </div>
              {wishes(request).map((wish) => (
                <div key={wish.label}>
                  <p className="text-brand-800 text-[11px] font-medium tracking-wider uppercase">{wish.label}</p>
                  <p className="text-ink-900 font-medium">{wish.value}</p>
                </div>
              ))}
              {request.clientComments && (
                <div className="sm:col-span-2">
                  <p className="text-brand-800 text-[11px] font-medium tracking-wider uppercase">In their words</p>
                  <p className="text-ink-700 italic whitespace-pre-line">“{request.clientComments}”</p>
                </div>
              )}
            </div>
          </div>
          {request.needsSubmittedAt && (
            <p className="text-ink-500 pt-2 text-xs font-light">Sent by the client through their link {formatMomentInWords(request.needsSubmittedAt)}.</p>
          )}
        </div>
      ) : (
        <p className="text-ink-500 text-sm font-light">
          Still an enquiry. Call the client, or email them below — with your link to book a call, or a form to tell us their needs — and the
          details land here.
        </p>
      )}

      {!editing && <ReachOut request={request} />}
    </Card>
  );
}

/**
 * Getting the details from the client (doc §4.11): their needs link — made,
 * copied, switched off — and an email written for them, opened in your own
 * email to check and send, with your booking link for a call and/or the form.
 */
function ReachOut({ request }: { request: FullRequest }) {
  const saved = useSaved();
  const me = api.user.me.useQuery();
  const myBooking = api.notification.bookingLink.useQuery();
  const make = api.sales.makeNeedsLink.useMutation({ onSuccess: saved });
  const off = api.sales.switchOffNeedsLink.useMutation({ onSuccess: saved });
  const [origin, setOrigin] = useState("");
  useEffect(() => setOrigin(window.location.origin), []);
  const [copied, setCopied] = useState(false);
  const [withCall, setWithCall] = useState(true);
  const [withForm, setWithForm] = useState(true);
  const url = request.needsToken ? `${origin}/needs/${request.needsToken}` : null;
  // The owner's booking link — or yours, when you are writing and they have none.
  const booking = request.owner?.bookingLink ?? myBooking.data ?? "";
  const sender = (me.data?.name ?? "").split(" ")[0] ?? "";

  const email = async () => {
    let link = url;
    if (withForm && !link) {
      const made = await make.mutateAsync({ id: request.id });
      link = `${origin}/needs/${made.needsToken}`;
    }
    const greeting = request.contact?.name ? `Dear ${request.contact.name.split(" ")[0]},` : "Hello,";
    const about = request.event ? `accommodation for ${request.event.name}` : "accommodation";
    const body = [
      greeting,
      "",
      `Thank you for your interest in ${about}. To find you the right options, we would like to understand your needs a little better.`,
      "",
      ...(withCall && booking ? [`You can pick a time for a short call with me here: ${booking}`, ""] : []),
      ...(withForm && link
        ? [`${withCall && booking ? "Or, if you prefer, tell" : "Could you tell"} us what you need here — rooms, dates, budget and where you would like to be — it takes two minutes: ${link}`, ""]
        : []),
      "Kind regards,",
      sender || "We Lodge",
    ].join("\n");
    const subject = `Your ${about}`;
    const to = request.contact?.email ?? "";
    window.location.href = `mailto:${encodeURIComponent(to)}?subject=${encodeURIComponent(subject)}&body=${encodeURIComponent(body)}`;
  };

  return (
    <div className="border-ink-200/60 mt-4 space-y-3 border-t pt-4">
      <div className="flex flex-wrap items-center gap-x-4 gap-y-2">
        <label className="text-ink-700 flex items-center gap-2 text-[13px]">
          <input type="checkbox" className="accent-brand-400 h-4 w-4" checked={withCall} onChange={(e) => setWithCall(e.target.checked)} disabled={!booking} />
          Link to book a call
          {!booking && <span className="text-ink-400 text-xs">— add yours on My profile</span>}
        </label>
        <label className="text-ink-700 flex items-center gap-2 text-[13px]">
          <input type="checkbox" className="accent-brand-400 h-4 w-4" checked={withForm} onChange={(e) => setWithForm(e.target.checked)} />
          Form to tell us their needs
        </label>
        <Button type="button" variant="secondary" disabled={(!withForm && !(withCall && booking)) || make.isPending} onClick={() => void email()}>
          Email the client
        </Button>
      </div>
      <p className="text-ink-500 text-xs font-light">
        Opens your own email with the message written{request.contact?.email ? ` to ${request.contact.email}` : ""} — check it and send it from
        there.
      </p>
      {url ? (
        <div className="bg-ink-50/60 flex flex-wrap items-center gap-2 rounded-lg px-3 py-2 text-xs">
          <span className="text-ink-500">Needs form:</span>
          <span className="text-ink-700 min-w-0 flex-1 truncate font-mono">{url}</span>
          <button
            type="button"
            onClick={() => void navigator.clipboard.writeText(url).then(() => { setCopied(true); setTimeout(() => setCopied(false), 1500); })}
            className="text-brand-700 hover:underline"
          >
            {copied ? "Copied" : "Copy"}
          </button>
          <button
            type="button"
            onClick={() => window.confirm("Switch the link off? It will open nothing any more; what the client sent stays.") && off.mutate({ id: request.id })}
            className="text-[#c03654] hover:underline"
          >
            Switch off
          </button>
        </div>
      ) : (
        <button type="button" onClick={() => make.mutate({ id: request.id })} disabled={make.isPending} className="text-brand-700 text-xs font-light hover:underline">
          Only make the needs-form link, to send another way
        </button>
      )}
    </div>
  );
}

/** The page a client opens from their needs link: what they need, sent straight to the request. */
export function NeedsForm({ token }: { token: string }) {
  const form = api.sales.needsForm.useQuery({ token }, { retry: false, refetchOnWindowFocus: false });
  const [values, setValues] = useState<DetailsValues | null>(null);
  const [problem, setProblem] = useState<string | null>(null);
  const [sent, setSent] = useState(false);
  useEffect(() => {
    if (form.data && !values) setValues(detailsFrom(form.data.values, form.data.currency));
  }, [form.data, values]);
  const geocode = api.sales.needsGeocode.useMutation();
  const submit = api.sales.submitNeeds.useMutation({
    onSuccess: () => {
      setSent(true);
      window.scrollTo({ top: 0 });
    },
  });

  if (form.isLoading) return <p className="text-ink-500 text-sm font-light">Loading…</p>;
  if (form.error || !form.data) {
    return (
      <Card>
        <h1 className="text-ink-900 text-xl font-semibold">This link is not in use any more</h1>
        <p className="text-ink-500 mt-2 text-sm font-light">Please ask your contact at We Lodge for a new one.</p>
      </Card>
    );
  }
  if (sent) {
    return (
      <Card>
        <h1 className="text-ink-900 text-xl font-semibold">Thank you — we have it</h1>
        <p className="text-ink-500 mt-2 text-sm font-light">
          Your contact at We Lodge has been told and will come back to you with options. You can open this link again to change anything.
        </p>
        <button type="button" onClick={() => setSent(false)} className="text-brand-700 mt-4 text-sm hover:underline">
          Change what I sent
        </button>
      </Card>
    );
  }
  return (
    <Card>
      <h1 className="text-ink-900 text-xl font-semibold">Your accommodation{form.data.eventName ? ` for ${form.data.eventName}` : ""}</h1>
      <p className="text-ink-500 mt-1 mb-5 text-sm font-light">
        For {form.data.clientName}. Tell us what you need, and we will come back with options that fit.
        {form.data.submittedAt ? ` You last sent this ${formatMomentInWords(form.data.submittedAt)}.` : ""}
      </p>
      {values && (
        <form
          onSubmit={(e) => {
            e.preventDefault();
            setProblem(null);
            if (!values.lines.some((line) => line.rooms.trim())) return setProblem("Please say how many rooms you need.");
            const result = detailsInput(values);
            if ("problem" in result) return setProblem(result.problem);
            submit.mutate({ token, ...result.input });
          }}
        >
          <DetailsFields
            values={values}
            onChange={setValues}
            places={form.data.places}
            forClient
            find={(address) => geocode.mutateAsync({ token, address })}
            eventStart={form.data.stay?.checkIn}
          />
          <div className="mt-5 space-y-2">
            <FormError message={problem ?? (submit.error ? friendlyError(submit.error) : null)} />
            <Button type="submit" disabled={submit.isPending}>
              {submit.isPending ? "Sending…" : "Send to We Lodge"}
            </Button>
          </div>
        </form>
      )}
    </Card>
  );
}

/** On My profile: your link for clients to book a call with you. */
export function BookingLinkCard() {
  const utils = api.useUtils();
  const current = api.notification.bookingLink.useQuery();
  const [value, setValue] = useState<string | null>(null);
  const save = api.notification.setBookingLink.useMutation({ onSuccess: () => void utils.notification.bookingLink.invalidate() });
  const shown = value ?? current.data ?? "";
  return (
    <div className="border-ink-200/60 mb-8 rounded-xl border bg-white p-5">
      <h2 className="text-ink-900 text-[15px] font-medium">Your link to book a call</h2>
      <p className="text-ink-500 mt-1 mb-3 text-sm font-light">
        Put in the emails you send clients from a sales request, so they can pick a time with you — a Google Calendar appointment page, Calendly or
        similar.
      </p>
      <form
        className="flex flex-wrap gap-2"
        onSubmit={(e) => {
          e.preventDefault();
          save.mutate({ link: shown }, { onSuccess: () => setValue(null) });
        }}
      >
        <Input value={shown} onChange={(e) => setValue(e.target.value)} placeholder="https://calendar.app.google/…" aria-label="Booking link" className="min-w-0 flex-1" />
        <Button type="submit" variant="secondary" disabled={save.isPending || value === null}>
          {save.isSuccess && value === null ? "Saved" : "Save"}
        </Button>
      </form>
      {save.error && <FormError message={friendlyError(save.error)} />}
    </div>
  );
}
