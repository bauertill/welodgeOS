"use client";

import { useState } from "react";

import {
  Button,
  Field,
  Fieldset,
  FormError,
  Input,
  Select,
  Textarea,
} from "~/app/_components/form";
import { dayKey, parseDay } from "~/lib/dates";
import {
  actionHints,
  actionLabels,
  type InventoryAction,
} from "~/lib/inventory";
import { api } from "~/trpc/react";

/**
 * §4.8 — bulk operations are the primary interaction. Because the grain is a
 * night, no meaningful action is single-record: everything here applies one
 * transition to a *rectangle* — a set of rooms crossed with a date range —
 * which either applies wholly or fails wholly, saying which nights stopped it.
 */

type Structure = {
  id: string;
  name: string;
  categories: {
    id: string;
    name: string;
    unitCount: number;
    firstNight: Date | null;
    lastCheckOut: Date | null;
    slots: { id: string; slotNumber: number; nightCount: number }[];
  }[];
}[];

/** Grouped the way a rep thinks: the supplier, the client, and who is asking. */
const ACTION_GROUPS: { label: string; actions: InventoryAction[] }[] = [
  {
    label: "With the supplier",
    actions: [
      "START_NEGOTIATION",
      "TAKE_OPTION",
      "BUY",
      "EXTEND_OPTION",
      "REPRICE_BUY",
      "REASSIGN_ACQUISITION_OWNER",
      "ABANDON",
      "RELEASE",
    ],
  },
  {
    label: "With the client",
    actions: [
      "BLOCK",
      "SELL",
      "EXTEND_BLOCK",
      "REPRICE_SELL",
      "REASSIGN_SALES_OWNER",
      "RELEASE_HOLD",
      "CANCEL_SALE",
    ],
  },
  { label: "Requests", actions: ["REQUEST", "WITHDRAW_REQUEST"] },
];

/** Which fields each action asks for. Anything not listed is not shown. */
const FIELDS: Record<InventoryAction, string[]> = {
  START_NEGOTIATION: ["supplierRef", "buyPrice", "acquisitionOwner", "acquisitionNotes"],
  TAKE_OPTION: ["supplierRef", "optionExpiry", "buyPrice", "acquisitionOwner", "acquisitionNotes"],
  BUY: ["supplierRef", "buyPrice", "acquisitionOwner", "acquisitionNotes"],
  ABANDON: ["acquisitionNotes"],
  RELEASE: ["acquisitionNotes"],
  EXTEND_OPTION: ["optionExpiry"],
  REPRICE_BUY: ["buyPrice"],
  REASSIGN_ACQUISITION_OWNER: ["acquisitionOwner"],

  BLOCK: ["client", "blockExpiry", "clientRef", "dueDate", "sellPrice", "salesOwner", "salesNotes"],
  SELL: ["client", "clientRef", "sellPrice", "salesOwner", "salesNotes"],
  RELEASE_HOLD: ["salesNotes"],
  CANCEL_SALE: ["salesNotes"],
  EXTEND_BLOCK: ["blockExpiry"],
  REPRICE_SELL: ["sellPrice"],
  REASSIGN_SALES_OWNER: ["salesOwner"],

  REQUEST: ["client", "clientRef", "sellPrice", "salesOwner", "salesNotes"],
  WITHDRAW_REQUEST: ["client"],
};

const CURRENCIES = ["USD", "EUR", "CHF", "GBP"];

/** "31, 33–40" — so a run of missing room numbers reads as ranges, not a list. */
function formatRoomNumbers(numbers: number[]): string {
  if (numbers.length === 0) return "";
  const sorted = [...numbers].sort((a, b) => a - b);
  const ranges: string[] = [];
  let start = sorted[0]!;
  let prev = sorted[0]!;
  for (let i = 1; i < sorted.length; i++) {
    const n = sorted[i]!;
    if (n === prev + 1) {
      prev = n;
      continue;
    }
    ranges.push(start === prev ? `#${start}` : `#${start}–${prev}`);
    start = n;
    prev = n;
  }
  ranges.push(start === prev ? `#${start}` : `#${start}–${prev}`);
  return ranges.join(", ");
}

export function BulkAction({
  eventId,
  structure,
  defaultCheckIn,
  defaultCheckOut,
  onApplied,
}: {
  eventId: string;
  structure: Structure;
  defaultCheckIn: string;
  defaultCheckOut: string;
  onApplied: () => void;
}) {
  const clients = api.clients.list.useQuery();
  const people = api.user.list.useQuery();

  const [categoryId, setCategoryId] = useState("");
  const [allRooms, setAllRooms] = useState(true);
  const [roomFrom, setRoomFrom] = useState("");
  const [roomTo, setRoomTo] = useState("");
  const [checkIn, setCheckIn] = useState(defaultCheckIn);
  const [checkOut, setCheckOut] = useState(defaultCheckOut);
  const [action, setAction] = useState<InventoryAction>("TAKE_OPTION");
  const [reason, setReason] = useState("");

  const [supplierRef, setSupplierRef] = useState("");
  const [optionExpiry, setOptionExpiry] = useState("");
  const [buyPrice, setBuyPrice] = useState("");
  const [buyCurrency, setBuyCurrency] = useState("USD");
  const [acquisitionOwnerId, setAcquisitionOwnerId] = useState("");
  const [acquisitionNotes, setAcquisitionNotes] = useState("");

  const [clientId, setClientId] = useState("");
  const [clientRef, setClientRef] = useState("");
  const [blockExpiry, setBlockExpiry] = useState("");
  const [dueDate, setDueDate] = useState("");
  const [sellPrice, setSellPrice] = useState("");
  const [sellCurrency, setSellCurrency] = useState("USD");
  const [salesOwnerId, setSalesOwnerId] = useState("");
  const [salesNotes, setSalesNotes] = useState("");

  const [error, setError] = useState<string | null>(null);
  const [result, setResult] = useState<string | null>(null);

  const apply = api.inventory.applyChange.useMutation({
    onSuccess: (outcome) => {
      setError(null);
      setResult(
        `${actionLabels[action]} applied to ${outcome.rooms} ${outcome.rooms === 1 ? "room" : "rooms"} — ${outcome.nights} room-nights.`,
      );
      onApplied();
    },
    onError: (e) => {
      setResult(null);
      setError(e.message);
    },
  });

  const category = structure
    .flatMap((property) =>
      property.categories.map((c) => ({ ...c, propertyName: property.name })),
    )
    .find((c) => c.id === categoryId);

  const slots = category?.slots ?? [];
  const selectedSlots = allRooms
    ? slots
    : slots.filter(
        (slot) =>
          slot.slotNumber >= (Number(roomFrom) || 0) &&
          slot.slotNumber <= (Number(roomTo) || Infinity),
      );

  // A typed range can ask for rooms that were never brought into inventory —
  // the filter above just quietly drops them, so this is what tells the rep
  // their "1 to 40" only matched 30 rooms, and which ones do not exist.
  const existingSlotNumbers = new Set(slots.map((slot) => slot.slotNumber));
  const from = Number(roomFrom) || 0;
  const to = Number(roomTo) || 0;
  const missingRoomNumbers =
    !allRooms && roomFrom && roomTo && from <= to
      ? Array.from({ length: to - from + 1 }, (_, i) => from + i).filter(
          (n) => !existingSlotNumbers.has(n),
        )
      : [];

  const shows = (field: string) => FIELDS[action].includes(field);
  const cents = (value: string) =>
    value.trim() ? Math.round(Number(value) * 100) : undefined;

  return (
    <Fieldset
      title="Update rooms and nights"
      description="Every change applies to a set of rooms across a range of nights, all at once. If any night would break a rule, nothing is changed and you are told which."
    >
      <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
        <Field label="Property and room type" className="lg:col-span-3">
          <Select
            value={categoryId}
            onChange={(e) => {
              setCategoryId(e.target.value);
              setAllRooms(true);
              // Default the range to the nights this category actually has, so
              // the form does not open asking for nights nobody brought in.
              const picked = structure
                .flatMap((property) => property.categories)
                .find((c) => c.id === e.target.value);
              if (picked?.firstNight) setCheckIn(dayKey(picked.firstNight));
              if (picked?.lastCheckOut) setCheckOut(dayKey(picked.lastCheckOut));
            }}
          >
            <option value="">Choose…</option>
            {structure.map((property) => (
              <optgroup key={property.id} label={property.name}>
                {property.categories.map((c) => (
                  <option key={c.id} value={c.id}>
                    {c.name} — {c.slots.length} in inventory
                  </option>
                ))}
              </optgroup>
            ))}
          </Select>
        </Field>

        <div className="lg:col-span-3">
          <label className="mb-2 flex items-center gap-2 text-[13px] font-light">
            <input
              type="checkbox"
              checked={allRooms}
              onChange={(e) => setAllRooms(e.target.checked)}
              className="accent-brand-400 h-4 w-4"
            />
            Every room of this type in the event
          </label>
          {!allRooms && (
            <div className="grid gap-4 sm:grid-cols-2">
              <Field label="First room number">
                <Input
                  type="number"
                  min={1}
                  value={roomFrom}
                  onChange={(e) => setRoomFrom(e.target.value)}
                  invalid={missingRoomNumbers.length > 0}
                />
              </Field>
              <Field label="Last room number">
                <Input
                  type="number"
                  min={1}
                  value={roomTo}
                  onChange={(e) => setRoomTo(e.target.value)}
                  invalid={missingRoomNumbers.length > 0}
                />
              </Field>
            </div>
          )}
          {missingRoomNumbers.length > 0 && (
            <p className="mt-2 text-xs font-medium text-[#c03654]">
              Room {formatRoomNumbers(missingRoomNumbers)}{" "}
              {missingRoomNumbers.length === 1 ? "does" : "do"} not exist for
              this room type — only {slots.length} in inventory. This will
              apply to the {selectedSlots.length} that do.
            </p>
          )}
        </div>

        <Field label="From (check-in)">
          <Input
            type="date"
            value={checkIn}
            onChange={(e) => setCheckIn(e.target.value)}
          />
        </Field>
        <Field
          label="To (check-out)"
          hint="Check-out day is never a night."
        >
          <Input
            type="date"
            value={checkOut}
            onChange={(e) => setCheckOut(e.target.value)}
          />
        </Field>
        <div className="flex items-end">
          <p className="text-ink-500 pb-2 text-xs font-light">
            {selectedSlots.length
              ? `${selectedSlots.length} ${selectedSlots.length === 1 ? "room" : "rooms"} selected`
              : "No rooms selected"}
            {missingRoomNumbers.length > 0 &&
              ` (${missingRoomNumbers.length} requested ${missingRoomNumbers.length === 1 ? "room does" : "rooms do"} not exist)`}
          </p>
        </div>

        <Field label="What happened" hint={actionHints[action]} className="lg:col-span-3">
          <Select
            value={action}
            onChange={(e) => setAction(e.target.value as InventoryAction)}
          >
            {ACTION_GROUPS.map((group) => (
              <optgroup key={group.label} label={group.label}>
                {group.actions.map((option) => (
                  <option key={option} value={option}>
                    {actionLabels[option]}
                  </option>
                ))}
              </optgroup>
            ))}
          </Select>
        </Field>

        {shows("client") && (
          <Field label="Client">
            <Select value={clientId} onChange={(e) => setClientId(e.target.value)}>
              <option value="">Choose…</option>
              {(clients.data ?? []).map((c) => (
                <option key={c.id} value={c.id}>
                  {c.name}
                </option>
              ))}
            </Select>
          </Field>
        )}

        {shows("supplierRef") && (
          <Field label="Supplier reference" hint="Their contract or booking number.">
            <Input value={supplierRef} onChange={(e) => setSupplierRef(e.target.value)} />
          </Field>
        )}

        {shows("optionExpiry") && (
          <Field
            label="Option runs to"
            hint="Required. An option without a date is invisible to every deadline report."
          >
            <Input
              type="date"
              value={optionExpiry}
              onChange={(e) => setOptionExpiry(e.target.value)}
            />
          </Field>
        )}

        {shows("blockExpiry") && (
          <Field
            label="Block runs to"
            hint="Required. A block with no deadline is inventory frozen for free."
          >
            <Input
              type="date"
              value={blockExpiry}
              onChange={(e) => setBlockExpiry(e.target.value)}
            />
          </Field>
        )}

        {shows("clientRef") && (
          <Field label="Client reference" hint="Their order or contract number.">
            <Input value={clientRef} onChange={(e) => setClientRef(e.target.value)} />
          </Field>
        )}

        {shows("dueDate") && (
          <Field label="Due date" hint="Payment or decision deadline.">
            <Input
              type="date"
              value={dueDate}
              onChange={(e) => setDueDate(e.target.value)}
            />
          </Field>
        )}

        {shows("buyPrice") && (
          <Field label="We pay, per night">
            <div className="flex gap-2">
              <Input
                type="number"
                step="0.01"
                min={0}
                value={buyPrice}
                onChange={(e) => setBuyPrice(e.target.value)}
              />
              <Select
                value={buyCurrency}
                onChange={(e) => setBuyCurrency(e.target.value)}
                className="w-28"
              >
                {CURRENCIES.map((c) => (
                  <option key={c}>{c}</option>
                ))}
              </Select>
            </div>
          </Field>
        )}

        {shows("sellPrice") && (
          <Field label="Client pays, per night">
            <div className="flex gap-2">
              <Input
                type="number"
                step="0.01"
                min={0}
                value={sellPrice}
                onChange={(e) => setSellPrice(e.target.value)}
              />
              <Select
                value={sellCurrency}
                onChange={(e) => setSellCurrency(e.target.value)}
                className="w-28"
              >
                {CURRENCIES.map((c) => (
                  <option key={c}>{c}</option>
                ))}
              </Select>
            </div>
          </Field>
        )}

        {shows("acquisitionOwner") && (
          <Field label="Our rep, with the supplier">
            <Select
              value={acquisitionOwnerId}
              onChange={(e) => setAcquisitionOwnerId(e.target.value)}
            >
              <option value="">Nobody yet</option>
              {(people.data ?? []).map((person) => (
                <option key={person.id} value={person.id}>
                  {person.name ?? person.email}
                </option>
              ))}
            </Select>
          </Field>
        )}

        {shows("salesOwner") && (
          <Field label="Our rep, with the client">
            <Select
              value={salesOwnerId}
              onChange={(e) => setSalesOwnerId(e.target.value)}
            >
              <option value="">Nobody yet</option>
              {(people.data ?? []).map((person) => (
                <option key={person.id} value={person.id}>
                  {person.name ?? person.email}
                </option>
              ))}
            </Select>
          </Field>
        )}

        {shows("acquisitionNotes") && (
          <Field label="Supplier notes" className="lg:col-span-3">
            <Textarea
              rows={2}
              value={acquisitionNotes}
              onChange={(e) => setAcquisitionNotes(e.target.value)}
            />
          </Field>
        )}

        {shows("salesNotes") && (
          <Field label="Client notes" className="lg:col-span-3">
            <Textarea
              rows={2}
              value={salesNotes}
              onChange={(e) => setSalesNotes(e.target.value)}
            />
          </Field>
        )}

        <Field
          label="Why"
          hint="Kept on the record for good. Who changed what, and why."
          className="lg:col-span-3"
        >
          <Input
            value={reason}
            onChange={(e) => setReason(e.target.value)}
            placeholder="Dana confirmed on the phone"
          />
        </Field>
      </div>

      <div className="mt-4 flex flex-wrap items-center gap-3">
        <Button
          type="button"
          disabled={!selectedSlots.length || apply.isPending}
          onClick={() => {
            setError(null);
            setResult(null);
            apply.mutate({
              eventId,
              slotIds: selectedSlots.map((slot) => slot.id),
              checkIn: parseDay(checkIn),
              checkOut: parseDay(checkOut),
              action,
              reason: reason.trim() || undefined,
              supplierRef: supplierRef.trim() || undefined,
              optionExpiry: optionExpiry ? parseDay(optionExpiry) : undefined,
              buyPriceCents: cents(buyPrice),
              buyCurrency,
              acquisitionOwnerId: acquisitionOwnerId || undefined,
              acquisitionNotes: acquisitionNotes.trim() || undefined,
              clientId: clientId || undefined,
              clientRef: clientRef.trim() || undefined,
              blockExpiry: blockExpiry ? parseDay(blockExpiry) : undefined,
              dueDate: dueDate ? parseDay(dueDate) : undefined,
              sellPriceCents: cents(sellPrice),
              sellCurrency,
              salesOwnerId: salesOwnerId || undefined,
              salesNotes: salesNotes.trim() || undefined,
            });
          }}
        >
          {apply.isPending ? "Applying…" : actionLabels[action]}
        </Button>
        <span className="text-ink-500 text-xs font-light">
          Applies to every night from {checkIn} up to, but not including,{" "}
          {checkOut}.
        </span>
      </div>

      {error && (
        <div className="mt-4 whitespace-pre-line">
          <FormError message={error} />
        </div>
      )}
      {result && (
        <p className="mt-4 rounded-lg bg-[#12b878]/10 px-3 py-2 text-[13px] text-[#0d8f5d]">
          {result}
        </p>
      )}
    </Fieldset>
  );
}
