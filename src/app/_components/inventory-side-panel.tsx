"use client";

import { useState } from "react";
import type { AcquisitionState, SalesState } from "generated/prisma";

import {
  Button,
  Field,
  FormError,
  Input,
  Select,
  Textarea,
} from "~/app/_components/form";
import { formatDay, formatMoney } from "~/lib/format";
import { nightsBetween, parseDay } from "~/lib/dates";
import {
  acquisitionLabels,
  acquisitionTarget,
  actionFields,
  actionGroups,
  actionHints,
  actionLabels,
  salesLabels,
  salesTarget,
  type InventoryAction,
} from "~/lib/inventory";
import { api } from "~/trpc/react";

/** What the grid already knows about one selected, materialised room-night. */
export type SelectedCell = {
  key: string;
  acquisitionState: AcquisitionState;
  supplierRef: string | null;
  optionExpiry: Date | null;
  buyPriceCents: number | null;
  buyCurrency: string | null;
  salesState: SalesState;
  clientId: string | null;
  clientName: string | null;
  clientRef: string | null;
  blockExpiry: Date | null;
  dueDate: Date | null;
  sellPriceCents: number | null;
  sellCurrency: string | null;
};

const CURRENCIES = ["USD", "EUR", "CHF", "GBP"];

/** "5 Bought, 3 In progress" — a mixed selection said as counts, not one lie. */
function tally<T extends string>(
  values: T[],
  labels: Record<T, string>,
): string {
  const counts = new Map<T, number>();
  for (const value of values) counts.set(value, (counts.get(value) ?? 0) + 1);
  return [...counts.entries()]
    .sort((a, b) => b[1] - a[1])
    .map(([state, count]) => `${count} ${labels[state]}`)
    .join(", ");
}

/**
 * Opened by highlighting cells in the inventory grid. Replaces the old
 * "Update rooms and nights" form: the rectangle comes from the selection
 * instead of typed room numbers and dates, but the mutation underneath
 * (`inventory.applyChange`) is the same one, so every existing rule and the
 * confirm-before-overwrite check both carry over unchanged.
 */
export function InventorySidePanel({
  eventId,
  slotIds,
  checkIn,
  checkOut,
  roomCount,
  cells,
  onClose,
  onApplied,
}: {
  eventId: string;
  slotIds: string[];
  checkIn: Date;
  checkOut: Date;
  roomCount: number;
  /** Only the selected room-nights that are actually in inventory. */
  cells: SelectedCell[];
  onClose: () => void;
  onApplied: () => void;
}) {
  const clients = api.clients.list.useQuery();
  const people = api.user.list.useQuery();
  const utils = api.useUtils();

  const [tab, setTab] = useState<"acquisition" | "sales">("acquisition");
  const totalNights = roomCount * nightsBetween(checkIn, checkOut);
  const single = cells.length === 1 && totalNights === 1 ? cells[0] : null;

  const defaultAction = (
    tab === "acquisition" ? actionGroups[0] : actionGroups[1]
  )!.actions[0]!;
  const [action, setAction] = useState<InventoryAction>(defaultAction);
  const [reason, setReason] = useState("");

  const [supplierRef, setSupplierRef] = useState(single?.supplierRef ?? "");
  const [optionExpiry, setOptionExpiry] = useState("");
  const [buyPrice, setBuyPrice] = useState(
    single?.buyPriceCents ? String(single.buyPriceCents / 100) : "",
  );
  const [buyCurrency, setBuyCurrency] = useState(single?.buyCurrency ?? "USD");
  const [acquisitionOwnerId, setAcquisitionOwnerId] = useState("");
  const [acquisitionNotes, setAcquisitionNotes] = useState("");

  const [clientId, setClientId] = useState(single?.clientId ?? "");
  const [clientRef, setClientRef] = useState(single?.clientRef ?? "");
  const [addingClient, setAddingClient] = useState(false);
  const [newClientName, setNewClientName] = useState("");
  const [newClientShortName, setNewClientShortName] = useState("");
  const [blockExpiry, setBlockExpiry] = useState("");
  const [dueDate, setDueDate] = useState("");
  const [sellPrice, setSellPrice] = useState(
    single?.sellPriceCents ? String(single.sellPriceCents / 100) : "",
  );
  const [sellCurrency, setSellCurrency] = useState(single?.sellCurrency ?? "USD");
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

  const remove = api.inventory.remove.useMutation({
    onSuccess: (outcome) => {
      setError(null);
      setResult(`Removed ${outcome.removed} room-nights from inventory.`);
      onApplied();
    },
    onError: (e) => {
      setResult(null);
      setError(e.message);
    },
  });

  const createClient = api.clients.create.useMutation({
    onSuccess: (client) => {
      void utils.clients.invalidate();
      setClientId(client.id);
      setAddingClient(false);
      setNewClientName("");
      setNewClientShortName("");
    },
    onError: (e) => setError(e.message),
  });

  const missing = totalNights - cells.length;
  const allUntouched =
    cells.length > 0 &&
    missing === 0 &&
    cells.every(
      (cell) => cell.acquisitionState === "NONE" && cell.salesState === "NONE",
    );

  const shows = (field: string) => actionFields[action].includes(field);
  const cents = (value: string) =>
    value.trim() ? Math.round(Number(value) * 100) : undefined;

  const groups = tab === "acquisition" ? [actionGroups[0]!] : actionGroups.slice(1);

  const submit = async () => {
    setError(null);
    setResult(null);

    // A rectangle that already carries data on the axis this action touches
    // is about to be overwritten silently — ask first (doc §4), exactly as
    // the old bulk-action form did.
    const acquisitionTo = acquisitionTarget[action];
    const salesTo = salesTarget[action];
    if (acquisitionTo ?? salesTo) {
      const existing = await utils.inventory.existingActivity.fetch({
        eventId,
        slotIds,
        checkIn,
        checkOut,
      });
      const activeCount = acquisitionTo
        ? existing.acquisitionActive
        : existing.salesActive;
      if (
        activeCount > 0 &&
        !window.confirm(
          `${activeCount} of the ${totalNights} room-nights you selected already have an entry for this period. Update ${activeCount === 1 ? "it" : "them"} anyway?`,
        )
      ) {
        return;
      }
    }

    apply.mutate({
      eventId,
      slotIds,
      checkIn,
      checkOut,
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
  };

  return (
    <>
      <div
        className="fixed inset-0 z-30 bg-black/20"
        onClick={onClose}
        aria-hidden="true"
      />
      <div className="border-ink-200/60 fixed inset-y-0 right-0 z-40 w-full max-w-md overflow-y-auto border-l bg-white p-5 shadow-xl">
        <div className="mb-4 flex items-start justify-between gap-3">
          <div>
            <h2 className="text-ink-900 text-[15px] font-medium">
              {roomCount} {roomCount === 1 ? "room" : "rooms"} ·{" "}
              {totalNights} room-{totalNights === 1 ? "night" : "nights"}
            </h2>
            <p className="text-ink-500 mt-0.5 text-xs font-light">
              {formatDay(checkIn)} – {formatDay(checkOut)}
              {missing > 0 &&
                ` · ${missing} of ${totalNights} not yet in inventory`}
            </p>
          </div>
          <button
            type="button"
            onClick={onClose}
            aria-label="Close"
            className="text-ink-400 hover:text-ink-700"
          >
            ✕
          </button>
        </div>

        {cells.length > 1 && (
          <div className="border-ink-200/60 mb-4 rounded-lg border p-3 text-xs font-light">
            <p className="text-ink-700">
              Supplier: {tally(cells.map((c) => c.acquisitionState), acquisitionLabels)}
            </p>
            <p className="text-ink-700 mt-1">
              Client: {tally(cells.map((c) => c.salesState), salesLabels)}
            </p>
          </div>
        )}

        {single && (
          <div className="border-ink-200/60 mb-4 rounded-lg border p-3 text-xs font-light">
            <p className="text-ink-700">
              {acquisitionLabels[single.acquisitionState]}
              {single.buyPriceCents !== null && single.buyCurrency
                ? ` · ${formatMoney(single.buyPriceCents, single.buyCurrency)}`
                : ""}
            </p>
            <p className="text-ink-700 mt-1">
              {salesLabels[single.salesState]}
              {single.clientName ? ` · ${single.clientName}` : ""}
              {single.sellPriceCents !== null && single.sellCurrency
                ? ` · ${formatMoney(single.sellPriceCents, single.sellCurrency)}`
                : ""}
            </p>
            {single.blockExpiry && (
              <p className="text-ink-500 mt-1">
                Block runs to {formatDay(single.blockExpiry)}
              </p>
            )}
          </div>
        )}

        {allUntouched && (
          <Button
            type="button"
            variant="danger"
            className="mb-4 w-full justify-center"
            disabled={remove.isPending}
            onClick={() => {
              setError(null);
              setResult(null);
              remove.mutate({ eventId, slotIds, checkIn, checkOut });
            }}
          >
            {remove.isPending ? "Removing…" : "Remove from inventory"}
          </Button>
        )}

        <div className="border-ink-200/60 mb-4 flex gap-1 border-b">
          {(["acquisition", "sales"] as const).map((t) => (
            <button
              key={t}
              type="button"
              onClick={() => {
                setTab(t);
                setAction((t === "acquisition" ? actionGroups[0] : actionGroups[1])!.actions[0]!);
              }}
              className={`-mb-px border-b-2 px-3 py-2 text-[13px] transition-colors ${
                tab === t
                  ? "border-brand-400 text-ink-900 font-medium"
                  : "text-ink-500 hover:text-ink-900 border-transparent font-light"
              }`}
            >
              {t === "acquisition" ? "Acquisition" : "Sales"}
            </button>
          ))}
        </div>

        <div className="space-y-4">
          <Field label="What happened" hint={actionHints[action]}>
            <Select
              value={action}
              onChange={(e) => setAction(e.target.value as InventoryAction)}
            >
              {groups.map((group) => (
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
              {addingClient ? (
                <div className="border-ink-200/60 space-y-2 rounded-lg border p-3">
                  <Input
                    value={newClientName}
                    onChange={(e) => setNewClientName(e.target.value)}
                    placeholder="Name"
                    autoFocus
                  />
                  <Input
                    value={newClientShortName}
                    onChange={(e) => setNewClientShortName(e.target.value)}
                    placeholder="Short name (used on the stock sheet)"
                  />
                  <div className="flex gap-2">
                    <Button
                      type="button"
                      disabled={!newClientName.trim() || createClient.isPending}
                      onClick={() =>
                        createClient.mutate({
                          name: newClientName,
                          shortName: newClientShortName || undefined,
                        })
                      }
                    >
                      {createClient.isPending ? "Adding…" : "Add client"}
                    </Button>
                    <Button type="button" variant="ghost" onClick={() => setAddingClient(false)}>
                      Cancel
                    </Button>
                  </div>
                </div>
              ) : (
                <Select
                  value={clientId}
                  onChange={(e) => {
                    if (e.target.value === "__new__") setAddingClient(true);
                    else setClientId(e.target.value);
                  }}
                >
                  <option value="">Choose…</option>
                  {(clients.data ?? []).map((c) => (
                    <option key={c.id} value={c.id}>
                      {c.name}
                    </option>
                  ))}
                  <option value="__new__">+ Add a new client…</option>
                </Select>
              )}
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
                  className="w-24"
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
                  className="w-24"
                >
                  {CURRENCIES.map((c) => (
                    <option key={c}>{c}</option>
                  ))}
                </Select>
              </div>
            </Field>
          )}

          {shows("acquisitionOwner") && (
            <Field label="Accommodation Manager">
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
            <Field label="Sales Manager">
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
            <Field label="Supplier notes">
              <Textarea
                rows={2}
                value={acquisitionNotes}
                onChange={(e) => setAcquisitionNotes(e.target.value)}
              />
            </Field>
          )}

          {shows("salesNotes") && (
            <Field label="Client notes">
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
          >
            <Input
              value={reason}
              onChange={(e) => setReason(e.target.value)}
              placeholder="Dana confirmed on the phone"
            />
          </Field>
        </div>

        <div className="mt-4 flex items-center gap-3">
          <Button
            type="button"
            disabled={!slotIds.length || apply.isPending}
            onClick={() => void submit()}
          >
            {apply.isPending ? "Applying…" : actionLabels[action]}
          </Button>
          <Button type="button" variant="ghost" onClick={onClose}>
            Close
          </Button>
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
      </div>
    </>
  );
}
