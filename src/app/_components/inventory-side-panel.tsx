"use client";

import { useEffect, useRef, useState } from "react";
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
import { dayKey, nightsBetween, parseDay } from "~/lib/dates";
import {
  acquisitionLabels,
  acquisitionTarget,
  actionFields,
  actionGroups,
  actionHints,
  actionLabels,
  needsBuyPrice,
  needsSellPrice,
  salesLabels,
  salesTarget,
  type InventoryAction,
} from "~/lib/inventory";
import { isClosed, salesStageLabels } from "~/lib/sales";
import { api } from "~/trpc/react";

/** What the grid already knows about one selected, materialised room-night. */
export type SelectedCell = {
  key: string;
  acquisitionState: AcquisitionState;
  supplierRef: string | null;
  optionExpiry: Date | null;
  buyPriceCents: number | null;
  buyCurrency: string | null;
  acquisitionOwner: string | null;
  acquisitionOwnerId: string | null;
  acquisitionNotes: string | null;
  salesState: SalesState;
  clientId: string | null;
  clientName: string | null;
  clientRef: string | null;
  blockExpiry: Date | null;
  dueDate: Date | null;
  sellPriceCents: number | null;
  sellCurrency: string | null;
  salesOwner: string | null;
  salesOwnerId: string | null;
  salesNotes: string | null;
  propertyId: string;
  acquisitionContractId: string | null;
  acquisitionContract: string | null;
  salesContractId: string | null;
  salesContract: string | null;
};

/**
 * One detail across the selected nights: the value they all share, or that
 * they differ. What is shared is filled in for editing; what differs is left
 * empty, and left empty keeps each night's own (doc §4.8).
 */
type Shared = { same: true; value: string } | { same: false; count: number };

function shared(cells: SelectedCell[], read: (cell: SelectedCell) => string): Shared {
  const values = new Set(cells.map(read));
  if (values.size <= 1) return { same: true, value: [...values][0] ?? "" };
  return { same: false, count: values.size };
}

/** What to send for one detail: left as it was → nothing (kept); emptied → cleared; else the new value. */
function changed(current: string, start: string): string | null | undefined {
  if (current.trim() === start.trim()) return undefined;
  return current.trim() === "" ? null : current;
}

const priceText = (cents: number | null) => (cents === null ? "" : String(cents / 100));

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

  // Editable in case the drag on the grid caught the wrong nights — the
  // rooms stay as highlighted, only the date range can be corrected here.
  const [checkInInput, setCheckInInput] = useState(dayKey(checkIn));
  const [checkOutInput, setCheckOutInput] = useState(dayKey(checkOut));
  const dateRangeEdited =
    checkInInput !== dayKey(checkIn) || checkOutInput !== dayKey(checkOut);

  const effectiveCheckIn = checkInInput ? parseDay(checkInInput) : checkIn;
  const effectiveCheckOut = checkOutInput ? parseDay(checkOutInput) : checkOut;
  const validRange =
    !Number.isNaN(effectiveCheckIn.getTime()) &&
    !Number.isNaN(effectiveCheckOut.getTime()) &&
    effectiveCheckOut > effectiveCheckIn;
  const effectiveNights = validRange
    ? nightsBetween(effectiveCheckIn, effectiveCheckOut)
    : 0;

  const totalNights = roomCount * effectiveNights;
  // The cell data the grid handed over is for the *original* selection — once
  // the range is edited it can no longer be trusted for prefill or tallies,
  // so those fall back to nothing rather than showing something stale.
  const single =
    !dateRangeEdited && cells.length === 1 && totalNights === 1
      ? cells[0]
      : null;

  // The action starts as what the nights already are on that side — Option
  // nights open on "Take an option", sold ones on "Sell to a client" — so with
  // every detail filled in, amending an entry is change-what-differs and save.
  const currentAction = (side: "acquisition" | "sales"): InventoryAction => {
    const fallback = (side === "acquisition" ? actionGroups[0] : actionGroups[1])!.actions[0]!;
    if (dateRangeEdited || cells.length === 0) return fallback;
    const most = <T extends string>(values: T[]) => {
      const counts = new Map<T, number>();
      for (const value of values) counts.set(value, (counts.get(value) ?? 0) + 1);
      return [...counts.entries()].sort((a, b) => b[1] - a[1])[0]![0];
    };
    return side === "acquisition"
      ? (statusAction.acquisition[most(cells.map((cell) => cell.acquisitionState))] ?? fallback)
      : (statusAction.sales[most(cells.map((cell) => cell.salesState))] ?? fallback);
  };
  const [action, setAction] = useState<InventoryAction>(() => currentAction(tab));
  const [reason, setReason] = useState("");

  // What every selected night already says, detail by detail — the starting
  // point of each box, so what is recorded shows and only changes are sent.
  const known = dateRangeEdited ? [] : cells;
  const start = {
    supplierRef: shared(known, (cell) => cell.supplierRef ?? ""),
    optionExpiry: shared(known, (cell) => (cell.acquisitionState === "OPTION" && cell.optionExpiry ? dayKey(cell.optionExpiry) : "")),
    blockExpiry: shared(known, (cell) => (cell.salesState === "BLOCKED" && cell.blockExpiry ? dayKey(cell.blockExpiry) : "")),
    buyPrice: shared(known, (cell) => priceText(cell.buyPriceCents)),
    buyCurrency: shared(known, (cell) => cell.buyCurrency ?? ""),
    acquisitionOwnerId: shared(known, (cell) => cell.acquisitionOwnerId ?? ""),
    acquisitionNotes: shared(known, (cell) => cell.acquisitionNotes ?? ""),
    clientId: shared(known, (cell) => cell.clientId ?? ""),
    clientRef: shared(known, (cell) => cell.clientRef ?? ""),
    dueDate: shared(known, (cell) => (cell.dueDate ? dayKey(cell.dueDate) : "")),
    sellPrice: shared(known, (cell) => priceText(cell.sellPriceCents)),
    sellCurrency: shared(known, (cell) => cell.sellCurrency ?? ""),
    salesOwnerId: shared(known, (cell) => cell.salesOwnerId ?? ""),
    salesNotes: shared(known, (cell) => cell.salesNotes ?? ""),
    acquisitionContractId: shared(known, (cell) => cell.acquisitionContractId ?? ""),
    salesContractId: shared(known, (cell) => cell.salesContractId ?? ""),
  };
  // The one hotel the selection is in — a supplier contract is with one hotel.
  const hotels = [...new Set(known.map((cell) => cell.propertyId))];
  const initial = (detail: Shared) => (detail.same ? detail.value : "");

  const [supplierRef, setSupplierRef] = useState(initial(start.supplierRef));
  const [optionExpiry, setOptionExpiry] = useState(initial(start.optionExpiry));
  const [buyPrice, setBuyPrice] = useState(initial(start.buyPrice));
  const [buyCurrency, setBuyCurrency] = useState(initial(start.buyCurrency) || "USD");
  const [acquisitionOwnerId, setAcquisitionOwnerId] = useState(initial(start.acquisitionOwnerId));
  const [acquisitionNotes, setAcquisitionNotes] = useState(initial(start.acquisitionNotes));
  const [acquisitionContractId, setAcquisitionContractId] = useState(initial(start.acquisitionContractId));

  const [clientId, setClientId] = useState(initial(start.clientId));
  const [clientRef, setClientRef] = useState(initial(start.clientRef));
  const [addingClient, setAddingClient] = useState(false);
  const [newClientName, setNewClientName] = useState("");
  const [newClientShortName, setNewClientShortName] = useState("");
  const [blockExpiry, setBlockExpiry] = useState(() =>
    start.clientId.same && start.clientId.value ? initial(start.blockExpiry) : "",
  );
  const [dueDate, setDueDate] = useState(initial(start.dueDate));
  const [sellPrice, setSellPrice] = useState(initial(start.sellPrice));
  const [sellCurrency, setSellCurrency] = useState(initial(start.sellCurrency) || "USD");
  const [salesOwnerId, setSalesOwnerId] = useState(initial(start.salesOwnerId));
  const [salesNotes, setSalesNotes] = useState(initial(start.salesNotes));
  const [salesContractId, setSalesContractId] = useState(() =>
    start.clientId.same && start.clientId.value ? initial(start.salesContractId) : "",
  );
  // The client's details only carry over while it is the same client: for
  // another one, the boxes start empty (and the server clears the last one's).
  const sameClient = start.clientId.same && Boolean(start.clientId.value) && start.clientId.value === clientId;
  const clientStart = (detail: Shared) => (sameClient ? initial(detail) : "");
  // Switching to another client empties its boxes; switching back refills them.
  const firstRender = useRef(true);
  useEffect(() => {
    if (firstRender.current) {
      firstRender.current = false;
      return;
    }
    setClientRef(clientStart(start.clientRef));
    setBlockExpiry(clientStart(start.blockExpiry));
    setDueDate(clientStart(start.dueDate));
    setSellPrice(clientStart(start.sellPrice));
    setSellCurrency(clientStart(start.sellCurrency) || "USD");
    setSalesOwnerId(clientStart(start.salesOwnerId));
    setSalesNotes(clientStart(start.salesNotes));
    setSalesContractId(clientStart(start.salesContractId));
    // eslint-disable-next-line react-hooks/exhaustive-deps -- only when it becomes, or stops being, the same client
  }, [sameClient]);
  // Which of the client's sales requests these nights belong to (doc §4.11).
  // "" means none; left untouched, it follows the client's only open request.
  const [salesRequestId, setSalesRequestId] = useState<string | null>(null);
  const forRequest = action === "REQUEST" || action === "BLOCK" || action === "SELL";
  const clientRequests = api.sales.forClient.useQuery({ clientId }, { enabled: Boolean(clientId) && forRequest });
  const openRequests = (clientRequests.data ?? []).filter(
    (request) => request.event?.id === eventId && !isClosed(request.stage),
  );
  const chosenRequest = salesRequestId ?? (openRequests.length === 1 ? openRequests[0]!.id : "");

  const [error, setError] = useState<string | null>(null);
  const [result, setResult] = useState<string | null>(null);
  // A problem with one field is said under that field, not at the foot of the
  // panel where it has to be scrolled to (2026-10-01).
  const [fieldErrors, setFieldErrors] = useState<Partial<Record<PanelField, string>>>({});
  const showProblems = (problems: Partial<Record<PanelField, string>>) => {
    setFieldErrors(problems);
    const first = panelFields.find((field) => problems[field]);
    if (!first) return;
    requestAnimationFrame(() => {
      const box = document.getElementById(`panel-field-${first}`);
      box?.scrollIntoView({ block: "center", behavior: "smooth" });
      box?.querySelector<HTMLElement>("input, select, textarea")?.focus({ preventScroll: true });
    });
  };
  const footer = useRef<HTMLDivElement>(null);
  // A message goes as soon as its field is put right, and all of them when the action changes.
  const clear = (field: PanelField) => setFieldErrors((current) => (current[field] ? { ...current, [field]: undefined } : current));
  useEffect(() => clear("client"), [clientId]);
  useEffect(() => clear("optionExpiry"), [optionExpiry]);
  useEffect(() => clear("blockExpiry"), [blockExpiry]);
  useEffect(() => clear("buyPrice"), [buyPrice]);
  useEffect(() => clear("sellPrice"), [sellPrice]);
  useEffect(() => clear("acquisitionOwner"), [acquisitionOwnerId]);
  useEffect(() => clear("salesOwner"), [salesOwnerId]);
  useEffect(() => clear("acquisitionContract"), [acquisitionContractId]);
  useEffect(() => clear("salesContract"), [salesContractId]);
  useEffect(() => setFieldErrors({}), [action]);

  const apply = api.inventory.applyChange.useMutation({
    onSuccess: (outcome) => {
      setError(null);
      setResult(
        `${outcome.added ? `Added ${outcome.added} room-nights to inventory, then ` : ""}${
          outcome.added ? actionLabels[action].toLowerCase() : actionLabels[action]
        } applied to ${outcome.rooms} ${outcome.rooms === 1 ? "room" : "rooms"} — ${outcome.nights} room-nights.`,
      );
      onApplied();
    },
    onError: (e) => {
      setResult(null);
      // A refusal about one field goes under it; anything else — a night
      // already held by someone else, say — stays by the button, in view.
      const field = fieldOfMessage(e.message);
      if (field) {
        setError(null);
        showProblems({ [field]: e.message });
      } else {
        setError(e.message);
        requestAnimationFrame(() => footer.current?.scrollIntoView({ block: "nearest", behavior: "smooth" }));
      }
    },
  });

  const addNights = api.inventory.addNights.useMutation({
    onSuccess: (outcome) => {
      setError(null);
      setResult(`Added ${outcome.added} room-nights to inventory. Nothing is contracted on them yet.`);
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

  const missing = dateRangeEdited ? null : totalNights - cells.length;
  const allUntouched =
    !dateRangeEdited &&
    cells.length > 0 &&
    missing === 0 &&
    cells.every(
      (cell) => cell.acquisitionState === "NONE" && cell.salesState === "NONE",
    );

  const shows = (field: string) => actionFields[action].includes(field);
  const nullableDay = (value: string | null | undefined) => (value === undefined ? undefined : value === null ? null : parseDay(value));
  /** A price and its currency: sent only when either changed, and cleared together. */
  const price = (side: "buy" | "sell", amount: string, currency: string, startAmount: string, startCurrency: string) => {
    const cents = side === "buy" ? "buyPriceCents" : "sellPriceCents";
    const code = side === "buy" ? "buyCurrency" : "sellCurrency";
    if (amount.trim() === startAmount.trim() && (!amount.trim() || currency === (startCurrency || currency))) return {};
    if (!amount.trim()) return { [cents]: null };
    return { [cents]: Math.round(Number(amount) * 100), [code]: currency };
  };
  /** What a box says while the selected nights differ on it. */
  const varies = (detail: Shared) =>
    !detail.same ? `Varies across these nights (${detail.count} different) — leave empty to keep each night's own` : undefined;

  const groups = tab === "acquisition" ? [actionGroups[0]!] : actionGroups.slice(1);

  const submit = async () => {
    setError(null);
    setResult(null);

    // What is plainly missing is said before anything is sent, field by field.
    const problems: Partial<Record<PanelField, string>> = {};
    const needs = (field: PanelField, missing: boolean, message: string) => {
      if (missing && !problems[field]) problems[field] = message;
    };
    const known = dateRangeEdited ? [] : cells;
    needs("client", shows("client") && !clientId, "Say which client this is for.");
    needs("optionExpiry", shows("optionExpiry") && !optionExpiry, "Give the date the option runs to.");
    needs("blockExpiry", shows("blockExpiry") && !blockExpiry, "Give the due date — a block without one is inventory frozen for free.");
    needs(
      "buyPrice",
      (needsBuyPrice.includes(action) || action === "REPRICE_BUY") &&
        !buyPrice.trim() &&
        (action === "REPRICE_BUY" || known.length === 0 || known.some((cell) => cell.buyPriceCents === null)),
      "Give the price we pay per night — a night marked bought needs its price.",
    );
    needs(
      "sellPrice",
      (needsSellPrice.includes(action) || action === "REPRICE_SELL") &&
        !sellPrice.trim() &&
        (action === "REPRICE_SELL" || known.length === 0 || known.some((cell) => cell.sellPriceCents === null || cell.clientId !== clientId)),
      `Give the price the client pays per night — a night ${action === "BLOCK" ? "blocked" : "sold"} for a client needs its agreed price.`,
    );
    needs(
      "acquisitionContract",
      action === "BUY" && !acquisitionContractId && (known.length === 0 || known.some((cell) => !cell.acquisitionContractId)),
      "Choose the supplier contract these nights are bought under — or add it with + New contract.",
    );
    needs(
      "salesContract",
      action === "SELL" && !salesContractId && (known.length === 0 || known.some((cell) => !cell.salesContractId || cell.clientId !== clientId)),
      "Choose the client contract these nights are sold under — or add it with + New contract.",
    );
    needs("acquisitionOwner", action === "REASSIGN_ACQUISITION_OWNER" && !acquisitionOwnerId, "Pick who takes over with the supplier.");
    needs("salesOwner", action === "REASSIGN_SALES_OWNER" && !salesOwnerId, "Pick who takes over with the client.");
    showProblems(problems);
    if (Object.keys(problems).length) return;

    // A rectangle that already carries data on the axis this action touches
    // is about to be overwritten silently — ask first (doc §4), exactly as
    // the old bulk-action form did.
    const acquisitionTo = acquisitionTarget[action];
    const salesTo = salesTarget[action];
    if (acquisitionTo ?? salesTo) {
      const existing = await utils.inventory.existingActivity.fetch({
        eventId,
        slotIds,
        checkIn: effectiveCheckIn,
        checkOut: effectiveCheckOut,
      });
      const activeCount = acquisitionTo
        ? existing.acquisitionActive
        : existing.salesActive;
      if (
        activeCount > 0 &&
        !window.confirm(
          `${activeCount} of the ${totalNights} room-nights you selected already have an entry for this period. Update ${activeCount === 1 ? "it" : "them"} anyway? Details you leave as they are keep what each night has.`,
        )
      ) {
        return;
      }
    }

    apply.mutate({
      eventId,
      slotIds,
      checkIn: effectiveCheckIn,
      checkOut: effectiveCheckOut,
      action,
      // Extending from the sheet: nights not in inventory yet are added first.
      addMissing: true,
      reason: reason.trim() || undefined,
      supplierRef: changed(supplierRef, initial(start.supplierRef)),
      optionExpiry: optionExpiry ? parseDay(optionExpiry) : undefined,
      ...price("buy", buyPrice, buyCurrency, initial(start.buyPrice), initial(start.buyCurrency)),
      acquisitionOwnerId: changed(acquisitionOwnerId, initial(start.acquisitionOwnerId)),
      acquisitionNotes: changed(acquisitionNotes, initial(start.acquisitionNotes)),
      acquisitionContractId: shows("acquisitionContract") ? changed(acquisitionContractId, initial(start.acquisitionContractId)) ?? undefined : undefined,
      clientId: clientId || undefined,
      clientRef: changed(clientRef, clientStart(start.clientRef)),
      blockExpiry: blockExpiry ? parseDay(blockExpiry) : undefined,
      dueDate: nullableDay(changed(dueDate, clientStart(start.dueDate))),
      ...price("sell", sellPrice, sellCurrency, clientStart(start.sellPrice), clientStart(start.sellCurrency)),
      salesOwnerId: changed(salesOwnerId, clientStart(start.salesOwnerId)),
      salesNotes: changed(salesNotes, clientStart(start.salesNotes)),
      salesContractId: shows("salesContract") ? changed(salesContractId, clientStart(start.salesContractId)) ?? undefined : undefined,
      salesRequestId: forRequest && chosenRequest ? chosenRequest : undefined,
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
            <div className="mt-1.5 flex items-center gap-2">
              <div className="w-36">
                <Input
                  type="date"
                  value={checkInInput}
                  onChange={(e) => setCheckInInput(e.target.value)}
                  invalid={!validRange}
                />
              </div>
              <span className="text-ink-400 text-xs">–</span>
              <div className="w-36">
                <Input
                  type="date"
                  value={checkOutInput}
                  onChange={(e) => setCheckOutInput(e.target.value)}
                  invalid={!validRange}
                />
              </div>
            </div>
            {!validRange ? (
              <p className="mt-1 text-xs font-medium text-[#c03654]">
                Check-out must be after check-in.
              </p>
            ) : dateRangeEdited ? (
              <p className="text-ink-500 mt-1 text-xs font-light">
                Adjusted from the highlighted range.
              </p>
            ) : (
              missing !== null &&
              missing > 0 && (
                <div className="bg-brand-50 text-brand-800 mt-2 rounded-lg px-3 py-2 text-xs font-light">
                  <p>
                    <span className="font-medium">
                      {missing} of {totalNights} room-nights aren't in inventory yet.
                    </span>{" "}
                    Any change below adds them first, extending these rooms.
                  </p>
                  <button
                    type="button"
                    disabled={addNights.isPending}
                    onClick={() => {
                      setError(null);
                      setResult(null);
                      addNights.mutate({ eventId, slotIds, checkIn, checkOut });
                    }}
                    className="text-brand-700 mt-1 font-medium underline disabled:opacity-50"
                  >
                    Only add them to inventory
                  </button>
                </div>
              )
            )}
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

        {!dateRangeEdited && cells.length > 0 && <Recorded cells={cells} />}

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
                setAction(currentAction(t));
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
            <div id="panel-field-client">
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
                        {c.shortName ? `${c.shortName} — ${c.name}` : c.name}
                      </option>
                    ))}
                    <option value="__new__">+ Add a new client…</option>
                  </Select>
                )}
              </Field>
              <FieldProblem message={fieldErrors.client} />
            </div>
          )}

          {shows("acquisitionContract") && (
            <div id="panel-field-acquisitionContract">
              <ContractPicker
                party="SUPPLIER"
                eventId={eventId}
                propertyId={hotels.length === 1 ? hotels[0]! : null}
                value={acquisitionContractId}
                onChange={setAcquisitionContractId}
                required={action === "BUY"}
                varies={!start.acquisitionContractId.same}
              />
              <FieldProblem message={fieldErrors.acquisitionContract} />
            </div>
          )}

          {shows("supplierRef") && (
            <Field label="Supplier reference" hint="Their contract or booking number.">
              <Input value={supplierRef} onChange={(e) => setSupplierRef(e.target.value)} placeholder={varies(start.supplierRef)} />
            </Field>
          )}

          {shows("optionExpiry") && (
            <div id="panel-field-optionExpiry">
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
              <FieldProblem message={fieldErrors.optionExpiry} />
            </div>
          )}

          {shows("blockExpiry") && (
            <div id="panel-field-blockExpiry">
              <Field
                label={action === "EXTEND_BLOCK" ? "New due date" : "Due date"}
                hint="Required. The date the client must decide by — a block without one is inventory frozen for free."
              >
                <Input
                  type="date"
                  value={blockExpiry}
                  onChange={(e) => setBlockExpiry(e.target.value)}
                />
              </Field>
              <FieldProblem message={fieldErrors.blockExpiry} />
            </div>
          )}

          {forRequest && clientId && openRequests.length > 0 && (
            <Field label="Sales request" hint="Which of the client's requests these nights belong to — they then show on it.">
              <Select value={chosenRequest} onChange={(e) => setSalesRequestId(e.target.value)}>
                <option value="">None</option>
                {openRequests.map((request) => (
                  <option key={request.id} value={request.id}>
                    {[salesStageLabels[request.stage], request.contact?.name, request.description?.slice(0, 50)].filter(Boolean).join(" · ")}
                  </option>
                ))}
              </Select>
            </Field>
          )}

          {shows("salesContract") && (
            <div id="panel-field-salesContract">
              <ContractPicker
                party="CLIENT"
                eventId={eventId}
                clientId={clientId || null}
                value={salesContractId}
                onChange={setSalesContractId}
                required={action === "SELL"}
                varies={sameClient && !start.salesContractId.same}
              />
              <FieldProblem message={fieldErrors.salesContract} />
            </div>
          )}

          {shows("clientRef") && (
            <Field label="Client reference" hint="Their order or contract number.">
              <Input value={clientRef} onChange={(e) => setClientRef(e.target.value)} placeholder={sameClient ? varies(start.clientRef) : undefined} />
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
            <div id="panel-field-buyPrice">
              <Field
                label={needsBuyPrice.includes(action) ? "We pay, per night — required" : "We pay, per night"}
                hint={
                  needsBuyPrice.includes(action)
                    ? "A night marked bought needs its price. Left empty, it is only accepted where every night already has one."
                    : undefined
                }
              >
                <div className="flex gap-2">
                  <Input
                    type="number"
                    step="0.01"
                    min={0}
                    value={buyPrice}
                    onChange={(e) => setBuyPrice(e.target.value)}
                    placeholder={varies(start.buyPrice) ? "Varies — leave empty to keep" : undefined}
                    title={varies(start.buyPrice)}
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
              <FieldProblem message={fieldErrors.buyPrice} />
            </div>
          )}

          {shows("sellPrice") && (
            <div id="panel-field-sellPrice">
              <Field
                label={needsSellPrice.includes(action) ? "Client pays, per night — required" : "Client pays, per night"}
                hint={
                  needsSellPrice.includes(action)
                    ? "The agreed price. Left empty, it is only accepted where every night already has this client's price."
                    : undefined
                }
              >
                <div className="flex gap-2">
                  <Input
                    type="number"
                    step="0.01"
                    min={0}
                    value={sellPrice}
                    onChange={(e) => setSellPrice(e.target.value)}
                    placeholder={sameClient && varies(start.sellPrice) ? "Varies — leave empty to keep" : undefined}
                    title={sameClient ? varies(start.sellPrice) : undefined}
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
              <FieldProblem message={fieldErrors.sellPrice} />
            </div>
          )}

          {shows("acquisitionOwner") && (
            <div id="panel-field-acquisitionOwner">
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
              <FieldProblem message={fieldErrors.acquisitionOwner} />
            </div>
          )}

          {shows("salesOwner") && (
            <div id="panel-field-salesOwner">
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
              <FieldProblem message={fieldErrors.salesOwner} />
            </div>
          )}

          {shows("acquisitionNotes") && (
            <Field label="Supplier notes">
              <Textarea
                rows={2}
                value={acquisitionNotes}
                onChange={(e) => setAcquisitionNotes(e.target.value)}
                placeholder={varies(start.acquisitionNotes)}
              />
            </Field>
          )}

          {shows("salesNotes") && (
            <Field label="Client notes">
              <Textarea
                rows={2}
                value={salesNotes}
                onChange={(e) => setSalesNotes(e.target.value)}
                placeholder={sameClient ? varies(start.salesNotes) : undefined}
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

        <div ref={footer} className="mt-4 flex items-center gap-3">
          <Button
            type="button"
            disabled={!slotIds.length || !validRange || apply.isPending}
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

/**
 * What is recorded on the selected nights right now (doc §5.4): the status on
 * each side, and every detail — prices, references, dates, managers, notes —
 * as the one value they share, or as varying where they differ.
 */
function Recorded({ cells }: { cells: SelectedCell[] }) {
  const line = (label: string, read: (cell: SelectedCell) => string | null) => {
    const values = [...new Set(cells.map(read))];
    const known = values.filter((value): value is string => Boolean(value));
    if (known.length === 0) return null;
    const text =
      values.length === 1
        ? known[0]!
        : known.length === 1
          ? `${known[0]} on some nights, nothing on others`
          : `varies — ${known.length} different`;
    return (
      <div key={label} className="flex gap-2">
        <dt className="text-ink-500 w-32 shrink-0">{label}</dt>
        <dd className="text-ink-900 min-w-0 break-words whitespace-pre-line">{text}</dd>
      </div>
    );
  };
  const money = (cents: number | null, currency: string | null) =>
    cents !== null && currency ? formatMoney(cents, currency) : null;
  const day = (value: Date | null) => (value ? formatDay(value) : null);
  return (
    <div className="border-ink-200/60 mb-4 space-y-3 rounded-lg border p-3 text-xs font-light">
      <p className="text-ink-500 text-[10px] font-medium tracking-wider uppercase">Recorded now</p>
      <dl className="space-y-1">
        <div className="flex gap-2">
          <dt className="text-ink-500 w-32 shrink-0">Supplier side</dt>
          <dd className="text-ink-900">{tally(cells.map((cell) => cell.acquisitionState), acquisitionLabels)}</dd>
        </div>
        {line("Buy price", (cell) => money(cell.buyPriceCents, cell.buyCurrency))}
        {line("Option runs to", (cell) => day(cell.optionExpiry))}
        {line("Supplier ref.", (cell) => cell.supplierRef)}
        {line("Supplier contract", (cell) => cell.acquisitionContract)}
        {line("Accommodation Mgr", (cell) => cell.acquisitionOwner)}
        {line("Supplier notes", (cell) => cell.acquisitionNotes)}
      </dl>
      <dl className="border-ink-200/60 space-y-1 border-t pt-3">
        <div className="flex gap-2">
          <dt className="text-ink-500 w-32 shrink-0">Client side</dt>
          <dd className="text-ink-900">{tally(cells.map((cell) => cell.salesState), salesLabels)}</dd>
        </div>
        {line("Client", (cell) => cell.clientName)}
        {line("Sell price", (cell) => money(cell.sellPriceCents, cell.sellCurrency))}
        {line("Due date", (cell) => day(cell.blockExpiry))}
        {/* Only where it was recorded before there was one due date (2026-10-01). */}
        {line("Payment due", (cell) => day(cell.dueDate))}
        {line("Client ref.", (cell) => cell.clientRef)}
        {line("Client contract", (cell) => cell.salesContract)}
        {line("Sales Manager", (cell) => cell.salesOwner)}
        {line("Client notes", (cell) => cell.salesNotes)}
      </dl>
    </div>
  );
}

/** The fields a problem can be pointed at, top to bottom as they appear. */
const panelFields = [
  "client",
  "acquisitionContract",
  "salesContract",
  "optionExpiry",
  "blockExpiry",
  "buyPrice",
  "sellPrice",
  "acquisitionOwner",
  "salesOwner",
] as const;
type PanelField = (typeof panelFields)[number];

/** Which field the server's refusal is about, when it is about one. */
function fieldOfMessage(message: string): PanelField | null {
  if (/supplier contract/i.test(message)) return "acquisitionContract";
  if (/client contract/i.test(message)) return "salesContract";
  if (/price we pay/i.test(message)) return "buyPrice";
  if (/price the client pays/i.test(message)) return "sellPrice";
  if (/which client/i.test(message)) return "client";
  if (/due date/i.test(message)) return "blockExpiry";
  if (/option needs a date|option's new date/i.test(message)) return "optionExpiry";
  if (/takes over with the supplier/i.test(message)) return "acquisitionOwner";
  if (/takes over with the client/i.test(message)) return "salesOwner";
  return null;
}

/** A problem with one field, said right under it. */
function FieldProblem({ message }: { message?: string }) {
  if (!message) return null;
  return (
    <p role="alert" className="mt-1.5 flex items-start gap-1.5 text-xs font-medium text-[#c03654]">
      <span className="mt-px inline-flex h-3.5 w-3.5 shrink-0 items-center justify-center rounded-full bg-[#c03654] text-[9px] font-bold text-white">
        !
      </span>
      {message}
    </p>
  );
}

/** The action that records each status, for opening the panel on what the nights already are. */
const statusAction: {
  acquisition: Partial<Record<AcquisitionState, InventoryAction>>;
  sales: Partial<Record<SalesState, InventoryAction>>;
} = {
  acquisition: { IN_PROGRESS: "START_NEGOTIATION", OPTION: "TAKE_OPTION", BOUGHT: "BUY", RELEASED: "RELEASE" },
  sales: { BLOCKED: "BLOCK", SOLD: "SELL", CANCELLED: "CANCEL_SALE" },
};

/**
 * The contract nights are bought or sold under (doc §7.1): this hotel's or
 * this client's, for this event — or a new one, added right here with its
 * name, total and PDF link. Its payment and cancellation terms follow on its
 * own page; until then it is flagged.
 */
function ContractPicker({
  party,
  eventId,
  propertyId,
  clientId,
  value,
  onChange,
  required,
  varies,
}: {
  party: "SUPPLIER" | "CLIENT";
  eventId: string;
  propertyId?: string | null;
  clientId?: string | null;
  value: string;
  onChange: (id: string) => void;
  required: boolean;
  varies: boolean;
}) {
  const utils = api.useUtils();
  const contracts = api.finance.contracts.useQuery({ eventId, party });
  const [adding, setAdding] = useState(false);
  const [name, setName] = useState("");
  const [total, setTotal] = useState("");
  const [currency, setCurrency] = useState("USD");
  const [link, setLink] = useState("");
  const create = api.finance.createContract.useMutation({
    onSuccess: (contract) => {
      void utils.finance.invalidate();
      onChange(contract.id);
      setAdding(false);
      setName("");
      setTotal("");
      setLink("");
    },
  });
  const owner = party === "SUPPLIER" ? propertyId : clientId;
  const options = (contracts.data ?? []).filter((contract) =>
    party === "SUPPLIER" ? contract.propertyId === owner : contract.clientId === owner,
  );
  const label = party === "SUPPLIER" ? "Supplier contract" : "Client contract";
  const chosen = options.find((contract) => contract.id === value);

  if (!owner) {
    return (
      <Field label={label}>
        <p className="text-ink-500 text-xs font-light">
          {party === "SUPPLIER" ? "Select rooms of one hotel to choose its contract." : "Choose the client first."}
        </p>
      </Field>
    );
  }
  return (
    <Field
      label={required ? `${label} — required` : label}
      hint={
        chosen && chosen.missing.length
          ? `This contract is still missing ${chosen.missing.join(", ")}.`
          : varies
            ? "These nights are under different contracts — leave it to keep each night's own."
            : undefined
      }
    >
      {adding ? (
        <div className="border-ink-200/60 space-y-2 rounded-lg border p-3">
          <Input value={name} onChange={(e) => setName(e.target.value)} placeholder="Contract name, like Group Sales Agreement" autoFocus />
          <div className="flex gap-2">
            <div className="min-w-0 flex-1">
              <Input value={total} onChange={(e) => setTotal(e.target.value)} inputMode="decimal" placeholder="Total of the contract" aria-label="Total" />
            </div>
            <Select value={currency} onChange={(e) => setCurrency(e.target.value)} className="w-24" aria-label="Currency">
              {CURRENCIES.map((code) => (
                <option key={code}>{code}</option>
              ))}
            </Select>
          </div>
          <Input value={link} onChange={(e) => setLink(e.target.value)} placeholder="Signed PDF — Google Drive link (can come later)" />
          {create.error && <FormError message={create.error.message} />}
          <div className="flex gap-2">
            <Button
              type="button"
              disabled={!name.trim() || create.isPending}
              onClick={() => {
                const cents = total.trim() ? Math.round(Number(total.replace(/[’'\s,]/g, "")) * 100) : null;
                create.mutate({
                  party,
                  eventId,
                  ...(party === "SUPPLIER" ? { propertyId: owner } : { clientId: owner }),
                  name,
                  totalCents: cents !== null && Number.isFinite(cents) ? cents : null,
                  currency,
                  documentUrl: link,
                });
              }}
            >
              {create.isPending ? "Adding…" : "Add contract"}
            </Button>
            <Button type="button" variant="ghost" onClick={() => setAdding(false)}>
              Cancel
            </Button>
          </div>
          <p className="text-ink-500 text-xs font-light">Its payment and cancellation terms are added on the contract's page.</p>
        </div>
      ) : (
        <Select
          value={value}
          onChange={(e) => (e.target.value === "__new__" ? setAdding(true) : onChange(e.target.value))}
        >
          <option value="">{varies ? "Varies — keep each night's own" : options.length ? "Choose…" : "None yet"}</option>
          {options.map((contract) => (
            <option key={contract.id} value={contract.id}>
              {contract.name}
              {contract.missing.length ? " — terms missing" : ""}
            </option>
          ))}
          <option value="__new__">+ New contract…</option>
        </Select>
      )}
    </Field>
  );
}
