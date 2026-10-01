import { TRPCError } from "@trpc/server";
import { z } from "zod";
import type { Prisma } from "generated/prisma";

import { addDays, dayKey, eachNight, nightsBetween } from "~/lib/dates";
import { formatDay, formatMoney } from "~/lib/format";
import {
  acquisitionLabels,
  acquisitionTarget,
  actionLabels,
  allowedAcquisitionMoves,
  allowedSalesMoves,
  salesLabels,
  needsBuyPrice,
  needsSellPrice,
  salesTarget,
  type InventoryAction,
} from "~/lib/inventory";
import { positionOf } from "~/lib/position";
import type { BlockNight } from "~/lib/stock-blocks";
import { categoryContractStatusLabels } from "~/lib/scouting";
import { createTRPCRouter, protectedProcedure } from "~/server/api/trpc";
import {
  axisOf,
  describeRoom,
  flatten,
  type LoadedNight,
  type NightSnapshot,
  nightInclude,
  snapshotNight,
  snapshotToFields,
} from "~/server/inventory";

/**
 * Phase 2 — acquisition and sales at the grain the business actually operates
 * at: one room slot on one calendar date (doc §4).
 *
 * Two things about this router are the whole point:
 *
 *  - **Nothing here is single-record.** Every mutation applies a transition to a
 *    *rectangle* — a set of slots crossed with a date range — atomically. It
 *    applies wholly or it fails wholly, with a per-night explanation of what
 *    blocked it (doc §4.8).
 *  - **Nothing here changes state silently.** Every applied change appends a
 *    ledger entry (invariant §4.5.8), and an expired deadline is flagged rather
 *    than acted on (doc §2.4).
 */

const ACTIONS = Object.keys(actionLabels) as [InventoryAction, ...InventoryAction[]];

/** Everything an action might need. Which of these are required is per action. */
/**
 * Everything an action might need. Which of these are required is per action.
 * A detail left out keeps what each night already has; `null` clears it on
 * purpose (doc §4.8) — so adding a note never wipes a price.
 */
const attributes = z.object({
  supplierRef: z.string().nullable().optional(),
  optionExpiry: z.date().optional(),
  buyPriceCents: z.number().int().min(0).nullable().optional(),
  buyCurrency: z.string().length(3).optional(),
  acquisitionOwnerId: z.string().nullable().optional(),
  acquisitionNotes: z.string().nullable().optional(),

  clientId: z.string().optional(),
  clientRef: z.string().nullable().optional(),
  blockExpiry: z.date().optional(),
  dueDate: z.date().nullable().optional(),
  sellPriceCents: z.number().int().min(0).nullable().optional(),
  sellCurrency: z.string().length(3).optional(),
  salesOwnerId: z.string().nullable().optional(),
  salesNotes: z.string().nullable().optional(),
  /**
   * The client's sales request these nights belong to (doc §4.11). Left out,
   * nights already tied to a request stay tied to it.
   */
  salesRequestId: z.string().optional(),
  /**
   * The signed contracts the nights fall under (doc §7.1): with the supplier
   * when buying, with the client when selling. Left out, nights keep theirs.
   */
  acquisitionContractId: z.string().optional(),
  salesContractId: z.string().optional(),
});

/**
 * Refuses the operation, naming exactly which nights stopped it. The legacy
 * add-on failed the entire dataset on one bad row and highlighted it red; we
 * refuse the operation only, and explain it (doc §11.2, §4.8).
 */
function refuse(problems: Problem[]): never {
  const lines = collapse(problems);
  const shown = lines.slice(0, 12);
  const rest = lines.length - shown.length;
  throw new TRPCError({
    code: "BAD_REQUEST",
    message: [
      "Nothing was changed. These nights would break a rule:",
      ...shown,
      ...(rest > 0 ? [`…and ${rest} more.`] : []),
    ].join("\n"),
  });
}

/** One night, one reason it cannot be changed. */
type Problem = { room: string; date: Date; reason: string };

/**
 * Twenty-one identical lines for one room is a wall, not an explanation. Runs
 * of consecutive nights that fail for the same reason collapse into a single
 * line naming the range — the same per-night truth, said once.
 */
function collapse(problems: Problem[]): string[] {
  const groups = new Map<string, Problem[]>();
  for (const problem of problems) {
    const key = `${problem.room}|${problem.reason}`;
    const list = groups.get(key);
    if (list) list.push(problem);
    else groups.set(key, [problem]);
  }

  const lines: string[] = [];
  for (const group of groups.values()) {
    const dates = group
      .map((problem) => problem.date)
      .sort((a, b) => a.getTime() - b.getTime());

    let runStart = dates[0]!;
    let runEnd = dates[0]!;
    const flush = () => {
      const nights = nightsBetween(runStart, runEnd) + 1;
      const when =
        nights === 1
          ? formatDay(runStart)
          : `${formatDay(runStart)} – ${formatDay(runEnd)} (${nights} nights)`;
      lines.push(`${group[0]!.room} · ${when} — ${group[0]!.reason}`);
    };

    for (const date of dates.slice(1)) {
      if (nightsBetween(runEnd, date) === 1) {
        runEnd = date;
      } else {
        flush();
        runStart = date;
        runEnd = date;
      }
    }
    flush();
  }

  // Rooms are read in numeric order on the stock sheet, so they are listed in
  // that order here too.
  return lines.sort((a, b) =>
    a.localeCompare(b, undefined, { numeric: true }),
  );
}

/** A night just outside the sheet's window, as much as is needed to tell whether a stay continues. */
type EdgeNight = Omit<BlockNight, "severity">;

/**
 * Adds the nights of an extension that are not in inventory yet (§5.4), as
 * "nothing started" — the same thing bringing rooms in does (§3.6), and under
 * the same rule: only a room type this event has contracted. Recorded as its
 * own ledger entry, so it can be undone like any other addition.
 */
async function addMissingNights(
  tx: Prisma.TransactionClient,
  input: {
    eventId: string;
    slotIds: string[];
    nights: Date[];
    present: { slotId: string; date: Date }[];
    actorId: string;
  },
) {
  const have = new Set(input.present.map((night) => `${night.slotId}|${dayKey(night.date)}`));
  const slots = await tx.roomSlot.findMany({
    where: { id: { in: input.slotIds } },
    include: { category: { include: { property: { select: { id: true, name: true } } } } },
  });

  const missing = slots.flatMap((slot) =>
    input.nights
      .filter((date) => !have.has(`${slot.id}|${dayKey(date)}`))
      .map((date) => ({ slot, date })),
  );
  if (missing.length === 0) return 0;

  // §3.6 — inventory only comes from a contracted room category.
  for (const category of new Map(missing.map(({ slot }) => [slot.category.id, slot.category])).values()) {
    const entry = await tx.scoutingEntry.findUnique({
      where: { eventId_propertyId: { eventId: input.eventId, propertyId: category.propertyId } },
    });
    const contract = entry
      ? await tx.categoryContract.findUnique({
          where: { scoutingEntryId_categoryId: { scoutingEntryId: entry.id, categoryId: category.id } },
        })
      : null;
    if (contract?.status !== "CONTRACTED") {
      throw new TRPCError({
        code: "BAD_REQUEST",
        message: `Nothing was changed. ${category.property.name} — ${category.name} is not marked Contracted for this event, so its rooms cannot be extended into new nights. Mark it Contracted first.`,
      });
    }
  }

  await tx.roomNight.createMany({
    data: missing.map(({ slot, date }) => ({ slotId: slot.id, eventId: input.eventId, date })),
    skipDuplicates: true,
  });
  const created = await tx.roomNight.findMany({
    where: {
      eventId: input.eventId,
      OR: missing.map(({ slot, date }) => ({ slotId: slot.id, date })),
    },
  });

  const first = slots[0]!;
  const numbers = slots.map((slot) => slot.slotNumber).sort((a, b) => a - b);
  const dates = missing.map(({ date }) => date.getTime());
  const from = new Date(Math.min(...dates));
  const to = addDays(new Date(Math.max(...dates)), 1);
  const roomsText =
    numbers.length === 1 ? `#${numbers[0]}` : `${numbers.length} rooms (#${numbers[0]}–#${numbers.at(-1)})`;

  await tx.ledgerEntry.create({
    data: {
      eventId: input.eventId,
      actorId: input.actorId,
      axis: "INVENTORY",
      toState: "NONE",
      nightCount: created.length,
      summary: `Extended ${first.category.property.name} ${first.category.name} ${roomsText} into ${formatDay(from)} – ${formatDay(to)} (${created.length} room-nights added, nothing contracted).`,
      beforeSnapshot: created.map((night) => snapshotNight(night, false)),
      nights: { connect: created.map((night) => ({ id: night.id })) },
    },
  });
  return created.length;
}

/** What one change to inventory says: which nights, what to do, and with what (doc §4.8). */
export const changeInput = attributes.extend({
  eventId: z.string(),
  slotIds: z.array(z.string()).min(1, "Pick at least one room"),
  checkIn: z.date(),
  checkOut: z.date(),
  action: z.enum(ACTIONS),
  reason: z.string().optional(),
  /**
   * Extend from the sheet (§5.4): nights in the selection that are not
   * in inventory yet are added first, as "nothing started", then the
   * change applies to all of them — one step, all or nothing.
   */
  addMissing: z.boolean().optional(),
});

export type ChangeInput = z.infer<typeof changeInput>;

/**
 * Applies one change to a rectangle of room-nights, inside the caller's
 * transaction: every rule checked night by night, all or nothing, and a
 * ledger entry written (doc §4.8, §4.5.8). The stock sheet and a sales
 * request (doc §4.11) both change inventory through here and nowhere else, so
 * neither can apply a rule the other does not.
 */
export async function applyInventoryChange(tx: Prisma.TransactionClient, actorId: string, input: ChangeInput) {
      const { action, eventId, slotIds, checkIn, checkOut, reason } = input;

      const nightCount = nightsBetween(checkIn, checkOut);
      if (nightCount === 0) {
        throw new TRPCError({
          code: "BAD_REQUEST",
          message:
            "Check-out must be after check-in. A stay from 10-Jul to 11-Jul is one night; check-out day is never a night.",
        });
      }

      const inRange = {
        eventId,
        slotId: { in: slotIds },
        date: { gte: checkIn, lt: checkOut },
      };
      const expected = slotIds.length * nightCount;
      const present = await tx.roomNight.findMany({
        where: inRange,
        select: { slotId: true, date: true },
      });

      // Extending: add whatever part of the selection is not in inventory yet.
      let added = 0;
      if (present.length !== expected) {
        if (!input.addMissing) {
          throw new TRPCError({
            code: "BAD_REQUEST",
            message: `Nothing was changed. ${expected - present.length} of the ${expected} room-nights you selected are not in this event's inventory yet. Bring them in first.`,
          });
        }
        added = await addMissingNights(tx, {
          eventId,
          slotIds,
          nights: eachNight(checkIn, checkOut),
          present,
          actorId: actorId,
        });
      }

      const nights = await tx.roomNight.findMany({
        where: inRange,
        include: nightInclude,
        orderBy: [{ slotId: "asc" }, { date: "asc" }],
      });

      const problems: Problem[] = [];
      const client = input.clientId
        ? await tx.client.findUnique({ where: { id: input.clientId } })
        : null;
      if (input.clientId && !client) {
        throw new TRPCError({ code: "BAD_REQUEST", message: "No such client." });
      }
      if (input.salesRequestId) {
        if (action !== "REQUEST" && action !== "BLOCK" && action !== "SELL") {
          throw new TRPCError({ code: "BAD_REQUEST", message: "Only a request, a block or a sale is recorded against a sales request." });
        }
        const salesRequest = await tx.salesRequest.findUnique({
          where: { id: input.salesRequestId },
          select: { clientId: true, eventId: true },
        });
        // A client's nights only ever belong to that client's own request, for this event.
        if (!salesRequest || salesRequest.clientId !== input.clientId || salesRequest.eventId !== eventId) {
          throw new TRPCError({
            code: "BAD_REQUEST",
            message: "Nothing was changed. That sales request is not this client's, for this event.",
          });
        }
      }

      const need = (value: unknown, message: string) => {
        if (value === undefined || value === null || value === "") {
          throw new TRPCError({ code: "BAD_REQUEST", message });
        }
      };

      // --- Per-action validation ------------------------------------------

      const acquisitionTo = acquisitionTarget[action];
      const salesTo = salesTarget[action];

      if (action === "TAKE_OPTION") {
        // Invariant §4.5.4 — an option without a deadline is invalid.
        need(
          input.optionExpiry,
          "An option needs a date it runs to. Without one it is invisible to every deadline report.",
        );
      }
      if (action === "BLOCK") {
        need(input.clientId, "Say which client is blocking these nights.");
        // Invariant §4.5.4, and the change from the sheet recorded in §4.2:
        // a block with no expiry is inventory frozen for free.
        need(
          input.blockExpiry,
          "Give the client's due date. A block without one is inventory frozen for free, and invisible to every deadline report.",
        );
      }
      if (action === "SELL" || action === "REQUEST" || action === "WITHDRAW_REQUEST") {
        need(input.clientId, "Say which client this is for.");
      }
      if (action === "EXTEND_OPTION") need(input.optionExpiry, "Give the option's new date.");
      if (action === "EXTEND_BLOCK") need(input.blockExpiry, "Give the new due date.");
      if (action === "REPRICE_BUY") {
        need(input.buyPriceCents, "Give the price we pay per night.");
        need(input.buyCurrency, "Say which currency that is in.");
      }
      if (action === "REPRICE_SELL") {
        need(input.sellPriceCents, "Give the price the client pays per night.");
        need(input.sellCurrency, "Say which currency that is in.");
      }
      if (action === "REASSIGN_ACQUISITION_OWNER") {
        need(input.acquisitionOwnerId, "Pick the rep who takes over with the supplier.");
      }
      if (action === "REASSIGN_SALES_OWNER") {
        need(input.salesOwnerId, "Pick the rep who takes over with the client.");
      }

      // A night bought, blocked or sold without its price is a payment
      // nobody can plan for (doc §4.1, §4.2). Left empty is fine only where
      // every night already carries one — for the same client, on the sales side.
      if (needsBuyPrice.includes(action)) {
        const priced =
          input.buyPriceCents != null ||
          (input.buyPriceCents === undefined && nights.every((night) => night.buyPriceCents !== null));
        if (!priced) {
          throw new TRPCError({
            code: "BAD_REQUEST",
            message: "Give the price we pay per night. A night marked bought needs its price, so what we owe the supplier is known.",
          });
        }
      }
      if (needsSellPrice.includes(action)) {
        const priced =
          input.sellPriceCents != null ||
          (input.sellPriceCents === undefined &&
            nights.every((night) => night.sellPriceCents !== null && night.clientId === input.clientId));
        if (!priced) {
          throw new TRPCError({
            code: "BAD_REQUEST",
            message: `Give the price the client pays per night. A night ${action === "BLOCK" ? "blocked" : "sold"} for a client needs its agreed price.`,
          });
        }
      }
      // Buying and selling happen under a signed contract (doc §7.1): one with
      // the hotel when buying, one with the client when selling — each for this
      // event and that very hotel or client. Left empty is fine only where
      // every night already carries one (the client's own, on the sales side).
      if (action === "BUY" && !input.acquisitionContractId && nights.some((night) => !night.acquisitionContractId)) {
        throw new TRPCError({
          code: "BAD_REQUEST",
          message: "Choose the supplier contract these nights are bought under — or add it first.",
        });
      }
      if (
        action === "SELL" &&
        !input.salesContractId &&
        nights.some((night) => !night.salesContractId || night.clientId !== input.clientId)
      ) {
        throw new TRPCError({
          code: "BAD_REQUEST",
          message: "Choose the client contract these nights are sold under — or add it first.",
        });
      }
      if (input.acquisitionContractId) {
        const contract = await tx.contract.findUnique({ where: { id: input.acquisitionContractId } });
        const hotels = new Set(nights.map((night) => night.slot.category.property.id));
        if (!contract || contract.party !== "SUPPLIER" || contract.eventId !== eventId || hotels.size !== 1 || !hotels.has(contract.propertyId ?? "")) {
          throw new TRPCError({
            code: "BAD_REQUEST",
            message: "Nothing was changed. That supplier contract is not with this hotel, for this event.",
          });
        }
      }
      if (input.salesContractId) {
        const contract = await tx.contract.findUnique({ where: { id: input.salesContractId } });
        const holder = input.clientId ?? (new Set(nights.map((night) => night.clientId)).size === 1 ? nights[0]?.clientId : null);
        if (!contract || contract.party !== "CLIENT" || contract.eventId !== eventId || contract.clientId !== holder) {
          throw new TRPCError({
            code: "BAD_REQUEST",
            message: "Nothing was changed. That client contract is not this client's, for this event.",
          });
        }
      }

      if (action === "UPDATE_SUPPLIER_DETAILS" || action === "UPDATE_CLIENT_DETAILS") {
        const keys =
          action === "UPDATE_SUPPLIER_DETAILS"
            ? (["supplierRef", "buyPriceCents", "acquisitionOwnerId", "acquisitionNotes", "acquisitionContractId"] as const)
            : (["clientRef", "dueDate", "sellPriceCents", "salesOwnerId", "salesNotes", "salesContractId"] as const);
        if (keys.every((key) => input[key] === undefined)) {
          throw new TRPCError({ code: "BAD_REQUEST", message: "Nothing to change — fill in what should change. Everything left empty stays as it is." });
        }
        if (input.buyPriceCents === null) {
          throw new TRPCError({ code: "BAD_REQUEST", message: "A price cannot be taken off here. Give the new price instead." });
        }
        if (action === "UPDATE_CLIENT_DETAILS" && input.sellPriceCents === null) {
          throw new TRPCError({ code: "BAD_REQUEST", message: "A price cannot be taken off here. Give the new price instead." });
        }
      }

      for (const night of nights) {
        const where = describeRoom(night);
        const fail = (reason: string) =>
          problems.push({ room: where, date: night.date, reason });

        if (acquisitionTo) {
          const from = night.acquisitionState;
          if (
            from !== acquisitionTo &&
            !allowedAcquisitionMoves[from].includes(acquisitionTo)
          ) {
            fail(
              `cannot go from ${acquisitionLabels[from].toLowerCase()} to ${acquisitionLabels[acquisitionTo].toLowerCase()}.`,
            );
          }
        }

        if (salesTo) {
          const from = night.salesState;
          if (from !== salesTo && !allowedSalesMoves[from].includes(salesTo)) {
            fail(
              `cannot go from ${salesLabels[from].toLowerCase()} to ${salesLabels[salesTo].toLowerCase()}.`,
            );
          }
          // Invariant §4.5.1 — at most one hard hold per room-night.
          if (
            (salesTo === "BLOCKED" || salesTo === "SOLD") &&
            (night.salesState === "BLOCKED" || night.salesState === "SOLD") &&
            night.clientId !== input.clientId
          ) {
            fail(
              `already ${salesLabels[night.salesState].toLowerCase()} to ${night.client?.name ?? "another client"}. A night can carry only one client hold.`,
            );
          }
        }

        if (action === "RELEASE_HOLD" && night.salesState === "NONE") {
          fail("no client hold to release.");
        }
        if (action === "CANCEL_SALE" && night.salesState !== "SOLD") {
          fail("not sold, so there is no sale to cancel.");
        }
        if (action === "EXTEND_OPTION" && night.acquisitionState !== "OPTION") {
          fail(
            `${acquisitionLabels[night.acquisitionState].toLowerCase()}, so there is no option to extend.`,
          );
        }
        if (action === "EXTEND_BLOCK" && night.salesState !== "BLOCKED") {
          fail(
            `${salesLabels[night.salesState].toLowerCase()}, so there is no block to extend.`,
          );
        }
        if (
          (action === "REPRICE_SELL" || action === "UPDATE_CLIENT_DETAILS") &&
          night.salesState !== "BLOCKED" &&
          night.salesState !== "SOLD"
        ) {
          fail(
            action === "REPRICE_SELL"
              ? "no client holds it, so there is nothing to price."
              : "no client holds it, so there are no client details to change.",
          );
        }
        if (
          action === "WITHDRAW_REQUEST" &&
          !night.requests.some((request) => request.clientId === input.clientId)
        ) {
          fail(`${client?.name ?? "that client"} has no request on this night.`);
        }
      }

      if (problems.length) refuse(problems);

      // --- Apply ------------------------------------------------------------

      const ids = nights.map((night) => night.id);
      const axis = axisOf(action);
      // A bulk operation rarely starts from one state, so the ledger records
      // every state these nights were actually in.
      const priorStates = [
        ...new Set(
          nights.map((night) =>
            axis === "ACQUISITION"
              ? acquisitionLabels[night.acquisitionState]
              : salesLabels[night.salesState],
          ),
        ),
      ].join(", ");

      const data = buildUpdate(action, input);
      const period = `${formatDay(checkIn)} – ${formatDay(checkOut)}`;
      const rooms = `${slotIds.length} ${slotIds.length === 1 ? "room" : "rooms"}`;

      // A request is a claim on a *different* table (`RoomNightRequest`), not
      // a field on the night itself — nothing here to snapshot, so undo isn't
      // offered for these two actions rather than only half-restoring state.
      const isRequestAction = action === "REQUEST" || action === "WITHDRAW_REQUEST";
      const beforeSnapshot: NightSnapshot[] | null = isRequestAction
        ? null
        : nights.map((night) => snapshotNight(night));

      // A currency with no amount behind it is noise, so it only travels with
      // a price (invariant §4.5.9).
      const requestData = {
        ...(input.salesRequestId !== undefined && { salesRequestId: input.salesRequestId }),
        clientRef: keepText(input.clientRef),
        ...keepPrice(input.sellPriceCents, input.sellCurrency, "sellPriceCents", "sellCurrency"),
        notes: keepText(input.salesNotes),
        ownerId: input.salesOwnerId,
      };

      {
        if (action === "REQUEST") {
          // A request is a claim, not a hold — many clients may hold one on the
          // same night, and asking twice is the same claim (doc §4.3).
          await Promise.all(
            ids.map((roomNightId) =>
              tx.roomNightRequest.upsert({
                where: {
                  roomNightId_clientId: { roomNightId, clientId: input.clientId! },
                },
                update: requestData,
                create: {
                  roomNightId,
                  clientId: input.clientId!,
                  ...requestData,
                  clientRef: requestData.clientRef ?? null,
                  notes: requestData.notes ?? null,
                  ownerId: requestData.ownerId ?? null,
                },
              }),
            ),
          );
        } else if (action === "WITHDRAW_REQUEST") {
          await tx.roomNightRequest.deleteMany({
            where: { roomNightId: { in: ids }, clientId: input.clientId! },
          });
        } else {
          await tx.roomNight.updateMany({ where: { id: { in: ids } }, data });
          // A night passing to another client does not keep the last client's
          // reference, price, notes or rep: what was not given is cleared there.
          if (action === "BLOCK" || action === "SELL") {
            const passed = nights.filter((night) => night.clientId !== input.clientId).map((night) => night.id);
            const reset = {
              ...(input.salesContractId === undefined && { salesContractId: null }),
              ...(input.clientRef === undefined && { clientRef: null }),
              ...(input.dueDate === undefined && { dueDate: null }),
              ...(input.sellPriceCents === undefined && { sellPriceCents: null, sellCurrency: null }),
              ...(input.salesOwnerId === undefined && { salesOwnerId: null }),
              ...(input.salesNotes === undefined && { salesNotes: null }),
            };
            if (passed.length && Object.keys(reset).length) {
              await tx.roomNight.updateMany({ where: { id: { in: passed } }, data: reset });
            }
          }
          // A night that passes to another client — a cancelled sale taken by
          // someone else — cannot stay tied to the first client's request.
          if ((action === "BLOCK" || action === "SELL") && input.salesRequestId === undefined) {
            await tx.roomNight.updateMany({
              where: { id: { in: ids }, salesRequest: { clientId: { not: input.clientId } } },
              data: { salesRequestId: null },
            });
          }
        }

        // What the change did, field by field — so an overwrite says what it overwrote.
        const after = isRequestAction
          ? []
          : await tx.roomNight.findMany({ where: { id: { in: ids } }, include: nightInclude });
        const details = isRequestAction ? null : describeChanges(nights, after);

        await tx.ledgerEntry.create({
          data: {
            eventId,
            actorId: actorId,
            axis,
            details,
            fromState: priorStates,
            toState: acquisitionTo
              ? acquisitionLabels[acquisitionTo]
              : salesTo
                ? salesLabels[salesTo]
                : null,
            nightCount: ids.length,
            summary: `${actionLabels[action]} — ${rooms} × ${nightCount} ${nightCount === 1 ? "night" : "nights"}, ${period}${client ? `, ${client.name}` : ""}.`,
            reason: reason?.trim() || null,
            undoable: !isRequestAction,
            beforeSnapshot: beforeSnapshot ?? undefined,
            nights: { connect: ids.map((id) => ({ id })) },
          },
        });
      }

      return { nights: ids.length, rooms: slotIds.length, added };
}

export const inventoryRouter = createTRPCRouter({
  /**
   * §3.6 — the only bridge from Phase 1 to Phase 2. Materialises a category's
   * slots over a date range at acquisition state `NONE`. **Nothing is
   * contracted by this act**: it says "these rooms exist and belong to this
   * event", not "we have them".
   */
  materialise: protectedProcedure
    .input(
      z.object({
        eventId: z.string(),
        categoryId: z.string(),
        slotFrom: z.number().int().min(1),
        slotTo: z.number().int().min(1),
        checkIn: z.date(),
        checkOut: z.date(),
      }),
    )
    .mutation(async ({ ctx, input }) => {
      if (input.slotTo < input.slotFrom) {
        throw new TRPCError({
          code: "BAD_REQUEST",
          message: "The last room number must not come before the first.",
        });
      }

      // Invariant §4.5.7 — dates are closed-open.
      const nights = eachNight(input.checkIn, input.checkOut);
      if (nights.length === 0) {
        throw new TRPCError({
          code: "BAD_REQUEST",
          message:
            "Check-out must be after check-in. A stay from 10-Jul to 11-Jul is one night; check-out day is never a night.",
        });
      }

      const category = await ctx.db.roomCategory.findUnique({
        where: { id: input.categoryId },
        include: { property: { select: { id: true, name: true } } },
      });
      if (!category) {
        throw new TRPCError({ code: "NOT_FOUND", message: "No such category." });
      }

      // Invariant §4.5.3 — slot numbers may not exceed the category's count.
      if (input.slotTo > category.unitCount) {
        throw new TRPCError({
          code: "BAD_REQUEST",
          message: `${category.property.name} has ${category.unitCount} ${category.unitCount === 1 ? "room" : "rooms"} of type "${category.name}", so room #${input.slotTo} does not exist. Raise the count on the property first if it should.`,
        });
      }

      // §3.6 — inventory comes from a room category this event has
      // contracted. The property's own status is not the gate any more —
      // one hotel routinely has some categories signed and others still
      // being negotiated (doc §3.5).
      const entry = await ctx.db.scoutingEntry.findUnique({
        where: {
          eventId_propertyId: {
            eventId: input.eventId,
            propertyId: category.propertyId,
          },
        },
      });
      if (!entry) {
        throw new TRPCError({
          code: "BAD_REQUEST",
          message: `${category.property.name} is not on this event's scouting list.`,
        });
      }

      const contract = await ctx.db.categoryContract.findUnique({
        where: {
          scoutingEntryId_categoryId: {
            scoutingEntryId: entry.id,
            categoryId: category.id,
          },
        },
      });
      if ((contract?.status ?? "IN_NEGOTIATION") !== "CONTRACTED") {
        const label = categoryContractStatusLabels[
          contract?.status ?? "IN_NEGOTIATION"
        ].toLowerCase();
        throw new TRPCError({
          code: "BAD_REQUEST",
          message: `${category.property.name} — ${category.name} is marked "${label}" on this event's scouting list. Only a contracted room category becomes inventory — mark it Contracted first.`,
        });
      }

      const slotNumbers = Array.from(
        { length: input.slotTo - input.slotFrom + 1 },
        (_, i) => input.slotFrom + i,
      );

      return ctx.db.$transaction(async (tx) => {
        // Slots are a stable identity, reused across events (doc §2.1), so an
        // existing one is kept rather than replaced.
        const slots = await Promise.all(
          slotNumbers.map((slotNumber) =>
            tx.roomSlot.upsert({
              where: {
                categoryId_slotNumber: { categoryId: category.id, slotNumber },
              },
              update: {},
              create: { categoryId: category.id, slotNumber },
            }),
          ),
        );

        // Recorded before creating anything, so undo can tell "this entry
        // brought it into being" apart from "this was already here" — a
        // re-materialised overlap must never let undo delete a night some
        // earlier materialise owns.
        const alreadyPresent = await tx.roomNight.findMany({
          where: {
            eventId: input.eventId,
            slotId: { in: slots.map((slot) => slot.id) },
            date: { gte: input.checkIn, lt: input.checkOut },
          },
          select: { slotId: true, date: true },
        });
        const alreadyPresentKeys = new Set(
          alreadyPresent.map((night) => `${night.slotId}|${dayKey(night.date)}`),
        );

        // `skipDuplicates` leans on the `(slot, date)` uniqueness constraint
        // (invariant §4.5.2): re-materialising an overlapping range adds the
        // missing nights and leaves the existing ones — and their commercial
        // position — untouched.
        const created = await tx.roomNight.createMany({
          data: slots.flatMap((slot) =>
            nights.map((date) => ({
              slotId: slot.id,
              eventId: input.eventId,
              date,
            })),
          ),
          skipDuplicates: true,
        });

        const fresh = await tx.roomNight.findMany({
          where: {
            eventId: input.eventId,
            slotId: { in: slots.map((slot) => slot.id) },
            date: { gte: input.checkIn, lt: input.checkOut },
          },
        });
        const newlyCreated = fresh.filter(
          (night) => !alreadyPresentKeys.has(`${night.slotId}|${dayKey(night.date)}`),
        );

        await tx.ledgerEntry.create({
          data: {
            eventId: input.eventId,
            actorId: ctx.session.user.id,
            axis: "INVENTORY",
            toState: "NONE",
            nightCount: created.count,
            summary: `Brought ${category.property.name} ${category.name} #${input.slotFrom}–#${input.slotTo} into inventory for ${formatDay(input.checkIn)} – ${formatDay(input.checkOut)} (${created.count} room-nights, nothing contracted).`,
            beforeSnapshot: newlyCreated.map((night) => snapshotNight(night, false)),
            nights: { connect: fresh.map((night) => ({ id: night.id })) },
          },
        });

        return {
          created: created.count,
          alreadyThere: slots.length * nights.length - created.count,
          slots: slots.length,
          nights: nights.length,
        };
      });
    }),

  /**
   * The properties, categories and slots this event has inventory in — what the
   * bulk-action picker offers as the rows of a rectangle.
   */
  structure: protectedProcedure
    .input(z.object({ eventId: z.string() }))
    .query(async ({ ctx, input }) => {
      const slots = await ctx.db.roomSlot.findMany({
        where: { roomNights: { some: { eventId: input.eventId } } },
        include: {
          category: {
            include: { property: { select: { id: true, name: true } } },
          },
          _count: {
            select: { roomNights: { where: { eventId: input.eventId } } },
          },
        },
        orderBy: [{ categoryId: "asc" }, { slotNumber: "asc" }],
      });

      // The nights a category actually covers. A form that defaults to the
      // event's own dates asks for nights that may not be in inventory, so the
      // first attempt always fails; this makes the default the truth.
      const spans = await ctx.db.roomNight.groupBy({
        by: ["slotId"],
        where: { eventId: input.eventId },
        _min: { date: true },
        _max: { date: true },
      });
      const spanBySlot = new Map(spans.map((span) => [span.slotId, span]));

      const properties = new Map<
        string,
        {
          id: string;
          name: string;
          categories: {
            id: string;
            name: string;
            sortOrder: number;
            unitCount: number;
            /** The first night this category has inventory on. */
            firstNight: Date | null;
            /** The day after its last night, ready to use as a check-out. */
            lastCheckOut: Date | null;
            slots: { id: string; slotNumber: number; nightCount: number }[];
          }[];
        }
      >();

      for (const slot of slots) {
        const property = slot.category.property;
        const entry = properties.get(property.id) ?? {
          id: property.id,
          name: property.name,
          categories: [],
        };
        let category = entry.categories.find((c) => c.id === slot.categoryId);
        if (!category) {
          category = {
            id: slot.category.id,
            name: slot.category.name,
            sortOrder: slot.category.sortOrder,
            unitCount: slot.category.unitCount,
            firstNight: null,
            lastCheckOut: null,
            slots: [],
          };
          entry.categories.push(category);
        }
        category.slots.push({
          id: slot.id,
          slotNumber: slot.slotNumber,
          nightCount: slot._count.roomNights,
        });

        const span = spanBySlot.get(slot.id);
        if (span?._min.date && span._max.date) {
          if (!category.firstNight || span._min.date < category.firstNight) {
            category.firstNight = span._min.date;
          }
          const checkOut = addDays(span._max.date, 1);
          if (!category.lastCheckOut || checkOut > category.lastCheckOut) {
            category.lastCheckOut = checkOut;
          }
        }
        properties.set(property.id, entry);
      }

      return [...properties.values()]
        .map((property) => ({
          ...property,
          categories: property.categories.sort(
            (a, b) => a.sortOrder - b.sortOrder || a.name.localeCompare(b.name),
          ),
        }))
        .sort((a, b) => a.name.localeCompare(b.name));
    }),

  /**
   * Whether any night in a rectangle already carries acquisition- or
   * sales-side data, so the form can ask "an entry already exists for this
   * period — update it?" before a bulk action quietly overwrites it (doc §4).
   */
  existingActivity: protectedProcedure
    .input(
      z.object({
        eventId: z.string(),
        slotIds: z.array(z.string()).min(1),
        checkIn: z.date(),
        checkOut: z.date(),
      }),
    )
    .query(async ({ ctx, input }) => {
      const nights = await ctx.db.roomNight.findMany({
        where: {
          eventId: input.eventId,
          slotId: { in: input.slotIds },
          date: { gte: input.checkIn, lt: input.checkOut },
        },
        select: { acquisitionState: true, salesState: true },
      });

      return {
        acquisitionActive: nights.filter((n) => n.acquisitionState !== "NONE")
          .length,
        salesActive: nights.filter((n) => n.salesState !== "NONE").length,
      };
    }),

  /**
   * Room categories this event has contracted but not yet fully turned into
   * inventory — grouped by property. Contracted is a per-category fact now,
   * so a property can appear with only some of its categories listed
   * (doc §3.5, §3.6).
   */
  materialisable: protectedProcedure
    .input(z.object({ eventId: z.string() }))
    .query(async ({ ctx, input }) => {
      const contracts = await ctx.db.categoryContract.findMany({
        where: { status: "CONTRACTED", scoutingEntry: { eventId: input.eventId } },
        include: {
          category: { select: { id: true, name: true, unitCount: true } },
          scoutingEntry: {
            select: { property: { select: { id: true, name: true } } },
          },
        },
      });

      const properties = new Map<
        string,
        { id: string; name: string; categories: { id: string; name: string; unitCount: number }[] }
      >();
      for (const contract of contracts) {
        const property = contract.scoutingEntry.property;
        const entry = properties.get(property.id) ?? {
          id: property.id,
          name: property.name,
          categories: [],
        };
        entry.categories.push(contract.category);
        properties.set(property.id, entry);
      }

      return [...properties.values()].sort((a, b) => a.name.localeCompare(b.name));
    }),

  /** The audit trail: who changed what, when, and why (doc §4.7). */
  ledger: protectedProcedure
    .input(z.object({ eventId: z.string(), limit: z.number().min(1).max(200).default(50) }))
    .query(async ({ ctx, input }) => {
      const entries = await ctx.db.ledgerEntry.findMany({
        where: { eventId: input.eventId },
        orderBy: { createdAt: "desc" },
        take: input.limit,
        select: {
          id: true,
          createdAt: true,
          summary: true,
          reason: true,
          details: true,
          fromState: true,
          nightCount: true,
          undoable: true,
          undoneAt: true,
          actor: { select: { name: true, email: true } },
        },
      });
      // An entry already undone offers no second undo.
      return entries.map(({ undoneAt, ...entry }) => ({
        ...entry,
        undoable: entry.undoable && !undoneAt,
        undone: Boolean(undoneAt),
      }));
    }),

  /**
   * §4.8 — the core mutation. Applies one transition to a rectangle of slots ×
   * nights, atomically, refusing the whole operation and naming the nights that
   * would break an invariant.
   */
  /** Extend rooms into nights they do not have yet, and nothing more (§5.4). */
  addNights: protectedProcedure
    .input(
      z.object({
        eventId: z.string(),
        slotIds: z.array(z.string()).min(1, "Pick at least one room"),
        checkIn: z.date(),
        checkOut: z.date(),
      }),
    )
    .mutation(async ({ ctx, input }) =>
      ctx.db.$transaction(async (tx) => {
        const present = await tx.roomNight.findMany({
          where: {
            eventId: input.eventId,
            slotId: { in: input.slotIds },
            date: { gte: input.checkIn, lt: input.checkOut },
          },
          select: { slotId: true, date: true },
        });
        const added = await addMissingNights(tx, {
          eventId: input.eventId,
          slotIds: input.slotIds,
          nights: eachNight(input.checkIn, input.checkOut),
          present,
          actorId: ctx.session.user.id,
        });
        return { added };
      }),
    ),

  applyChange: protectedProcedure
    .input(changeInput)
    .mutation(({ ctx, input }) =>
      // One transaction from start to finish, so a change that is refused
      // leaves no half-added nights behind.
      ctx.db.$transaction((tx) => applyInventoryChange(tx, ctx.session.user.id, input), { timeout: 30_000 }),
    ),

  /**
   * The date-grid: every matching room-night as a cell, keyed by slot and
   * date, with its `position` already computed via `positionOf` — so there
   * is exactly one place that decides what a room-night means (doc §4, the
   * Inventory tab overhaul).
   */
  grid: protectedProcedure
    .input(
      z.object({
        eventId: z.string(),
        propertyId: z.string().optional(),
        categoryId: z.string().optional(),
        clientId: z.string().optional(),
        acquisitionState: z
          .enum(["NONE", "IN_PROGRESS", "OPTION", "BOUGHT", "RELEASED"])
          .optional(),
        // `REQUESTED` is never stored on a night (doc §4.3) — see `stockSheet`.
        salesState: z.enum(["NONE", "BLOCKED", "SOLD", "CANCELLED"]).optional(),
        minStars: z.number().int().min(1).max(5).optional(),
        checkIn: z.date(),
        checkOut: z.date(),
      }),
    )
    .query(async ({ ctx, input }) => {
      const nights = await ctx.db.roomNight.findMany({
        where: {
          eventId: input.eventId,
          date: { gte: input.checkIn, lt: input.checkOut },
          slot: {
            categoryId: input.categoryId,
            category: {
              propertyId: input.propertyId,
              property: input.minStars
                ? { stars: { gte: input.minStars } }
                : undefined,
            },
          },
          acquisitionState: input.acquisitionState,
          salesState: input.salesState,
          ...(input.clientId
            ? {
                OR: [
                  { clientId: input.clientId },
                  { requests: { some: { clientId: input.clientId } } },
                ],
              }
            : {}),
        },
        include: {
          ...nightInclude,
          slot: {
            include: {
              category: {
                include: {
                  property: { select: { id: true, name: true, stars: true } },
                },
              },
            },
          },
        },
        orderBy: [{ slotId: "asc" }, { date: "asc" }],
      });

      // Only the hotels, categories and rooms with a night that actually
      // matches the filters above — "hide hotels with a status" falls out of
      // the same filter rather than a second one.
      const properties = new Map<
        string,
        {
          id: string;
          name: string;
          stars: number | null;
          categories: Map<
            string,
            {
              id: string;
              name: string;
              sortOrder: number;
              slots: Map<string, { id: string; slotNumber: number }>;
            }
          >;
        }
      >();

      for (const night of nights) {
        const propertyRow = night.slot.category.property;
        let property = properties.get(propertyRow.id);
        if (!property) {
          property = {
            id: propertyRow.id,
            name: propertyRow.name,
            stars: propertyRow.stars,
            categories: new Map(),
          };
          properties.set(propertyRow.id, property);
        }
        let category = property.categories.get(night.slot.categoryId);
        if (!category) {
          category = {
            id: night.slot.categoryId,
            name: night.slot.category.name,
            sortOrder: night.slot.category.sortOrder,
            slots: new Map(),
          };
          property.categories.set(night.slot.categoryId, category);
        }
        if (!category.slots.has(night.slotId)) {
          category.slots.set(night.slotId, {
            id: night.slotId,
            slotNumber: night.slot.slotNumber,
          });
        }
      }

      const cells: Record<string, ReturnType<typeof flatten> & { position: ReturnType<typeof positionOf> }> = {};
      for (const night of nights) {
        const record = flatten(night);
        cells[`${record.slotId}|${dayKey(night.date)}`] = {
          ...record,
          position: positionOf({
            acquisitionState: record.acquisitionState,
            optionExpiry: record.optionExpiry,
            salesState: record.salesState,
            blockExpiry: record.blockExpiry,
            dueDate: record.dueDate,
            clientName: record.clientName,
            requestedBy: record.requestedBy.map((r) => r.name),
          }),
        };
      }

      // The night either side of the window, per room, so the sheet can tell a
      // stay that really begins on the first day shown from one that only
      // appears to because the window cuts it off (doc §5.4).
      const slotIds = [...new Set(nights.map((night) => night.slotId))];
      const edgeNights = slotIds.length
        ? await ctx.db.roomNight.findMany({
            where: {
              eventId: input.eventId,
              slotId: { in: slotIds },
              date: { in: [addDays(input.checkIn, -1), input.checkOut] },
            },
            include: nightInclude,
          })
        : [];
      const edges = { before: {} as Record<string, EdgeNight>, after: {} as Record<string, EdgeNight> };
      for (const night of edgeNights) {
        const record = flatten(night);
        const position = positionOf({
          acquisitionState: record.acquisitionState,
          optionExpiry: record.optionExpiry,
          salesState: record.salesState,
          blockExpiry: record.blockExpiry,
          dueDate: record.dueDate,
          clientName: record.clientName,
          requestedBy: record.requestedBy.map((r) => r.name),
        });
        const side = night.date < input.checkIn ? edges.before : edges.after;
        side[night.slotId] = {
          sales: position.sales,
          acquisition: position.acquisition,
          clientName: record.clientName,
          requestedBy: record.requestedBy.map((r) => r.name),
        };
      }

      return {
        edges,
        dates: eachNight(input.checkIn, input.checkOut),
        properties: [...properties.values()]
          .map((property) => ({
            ...property,
            categories: [...property.categories.values()]
              .map((category) => ({
                ...category,
                slots: [...category.slots.values()].sort(
                  (a, b) => a.slotNumber - b.slotNumber,
                ),
              }))
              // Same order the property form lists categories in — a hotel's
              // rooms first, whatever was added after (like a meeting room)
              // last — rather than alphabetical, where "Meeting Room" sorts
              // ahead of "ROH" by letter alone.
              .sort((a, b) => a.sortOrder - b.sortOrder || a.name.localeCompare(b.name)),
          }))
          .sort((a, b) => a.name.localeCompare(b.name)),
        cells,
      };
    }),

  /**
   * Undoes a mistaken `materialise` — the only way a room-night ever leaves
   * inventory. Refused unless every night in the rectangle is still
   * completely untouched (`NONE`/`NONE`): once anything real has happened,
   * the right move is to release or cancel it properly, which keeps the
   * record rather than erasing it.
   */
  remove: protectedProcedure
    .input(
      z.object({
        eventId: z.string(),
        slotIds: z.array(z.string()).min(1, "Pick at least one room"),
        checkIn: z.date(),
        checkOut: z.date(),
        reason: z.string().optional(),
      }),
    )
    .mutation(async ({ ctx, input }) => {
      const { eventId, slotIds, checkIn, checkOut, reason } = input;

      const nightCount = nightsBetween(checkIn, checkOut);
      if (nightCount === 0) {
        throw new TRPCError({
          code: "BAD_REQUEST",
          message:
            "Check-out must be after check-in. A stay from 10-Jul to 11-Jul is one night; check-out day is never a night.",
        });
      }

      const nights = await ctx.db.roomNight.findMany({
        where: {
          eventId,
          slotId: { in: slotIds },
          date: { gte: checkIn, lt: checkOut },
        },
        include: nightInclude,
        orderBy: [{ slotId: "asc" }, { date: "asc" }],
      });

      const expected = slotIds.length * nightCount;
      if (nights.length !== expected) {
        throw new TRPCError({
          code: "BAD_REQUEST",
          message: `Nothing was removed. ${expected - nights.length} of the ${expected} room-nights you selected are not in this event's inventory.`,
        });
      }

      const problems: Problem[] = [];
      for (const night of nights) {
        if (night.acquisitionState !== "NONE" || night.salesState !== "NONE") {
          problems.push({
            room: describeRoom(night),
            date: night.date,
            reason: `already ${acquisitionLabels[night.acquisitionState].toLowerCase()} / ${salesLabels[night.salesState].toLowerCase()} — release or cancel it instead of removing it.`,
          });
        }
      }
      if (problems.length) refuse(problems);

      const ids = nights.map((night) => night.id);
      const period = `${formatDay(checkIn)} – ${formatDay(checkOut)}`;
      const rooms = `${slotIds.length} ${slotIds.length === 1 ? "room" : "rooms"}`;

      await ctx.db.$transaction(async (tx) => {
        // Written before the delete, so the ledger's own summary/nightCount
        // stay readable as history even once the join to these nights is gone.
        await tx.ledgerEntry.create({
          data: {
            eventId,
            actorId: ctx.session.user.id,
            axis: "INVENTORY",
            fromState: "Nothing started",
            toState: null,
            nightCount: ids.length,
            summary: `Removed from inventory — ${rooms} × ${nightCount} ${nightCount === 1 ? "night" : "nights"}, ${period}. Never contracted; brought in by mistake.`,
            reason: reason?.trim() || null,
            // Every one of these nights is NONE/NONE (checked above), so
            // undoing a removal is just re-materialising them exactly as
            // they were.
            beforeSnapshot: nights.map((night) => snapshotNight(night)),
            nights: { connect: ids.map((id) => ({ id })) },
          },
        });
        await tx.roomNight.deleteMany({ where: { id: { in: ids } } });
      });

      return { removed: ids.length, rooms: slotIds.length };
    }),

  /**
   * Restores a ledger entry's affected nights to exactly how they were
   * before it ran — a real fix for "I did the wrong thing", not just the
   * narrow "untouched `materialise`" case `remove` covers. Refused, not
   * guessed around, the moment anything else has touched the same nights
   * since (doc §4.7).
   */
  undo: protectedProcedure
    .input(z.object({ ledgerEntryId: z.string() }))
    .mutation(async ({ ctx, input }) => {
      const entry = await ctx.db.ledgerEntry.findUnique({
        where: { id: input.ledgerEntryId },
      });
      if (!entry) {
        throw new TRPCError({ code: "NOT_FOUND", message: "No such change." });
      }
      if (!entry.undoable || !entry.beforeSnapshot) {
        throw new TRPCError({
          code: "BAD_REQUEST",
          message: "This change cannot be undone.",
        });
      }
      if (entry.undoneAt) {
        throw new TRPCError({
          code: "BAD_REQUEST",
          message: "This change has already been undone.",
        });
      }

      const snapshot = entry.beforeSnapshot as unknown as NightSnapshot[];
      const nightIds = snapshot.map((s) => s.nightId);

      // Only later changes still in force stand in the way: one that has
      // itself been undone, or the record of an undo, does not — so undoing
      // the latest change and then the one before it works (§4.7).
      const later = await ctx.db.ledgerEntry.findMany({
        where: {
          eventId: entry.eventId,
          createdAt: { gt: entry.createdAt },
          undoneAt: null,
          isUndo: false,
          nights: { some: { id: { in: nightIds } } },
        },
        include: {
          nights: { where: { id: { in: nightIds } }, include: nightInclude },
        },
        orderBy: { createdAt: "asc" },
      });
      if (later.length > 0) {
        const problems: Problem[] = later.flatMap((laterEntry) =>
          laterEntry.nights.map((night) => ({
            room: describeRoom(night),
            date: night.date,
            reason: `changed again since — "${laterEntry.summary}" — undo that first, or fix it by hand.`,
          })),
        );
        refuse(problems);
      }

      await ctx.db.$transaction(async (tx) => {
        const stillExisting: string[] = [];
        for (const s of snapshot) {
          if (!s.existed) {
            await tx.roomNight.deleteMany({ where: { id: s.nightId } });
            continue;
          }
          const current = await tx.roomNight.findUnique({
            where: { id: s.nightId },
            select: { id: true },
          });
          if (current) {
            await tx.roomNight.update({
              where: { id: s.nightId },
              data: snapshotToFields(s),
            });
          } else {
            // Already deleted by a since-severed `remove` — recreate it
            // with the same id rather than error, so undo still works.
            await tx.roomNight.create({
              data: {
                id: s.nightId,
                eventId: entry.eventId,
                slotId: s.slotId,
                date: new Date(s.date),
                ...snapshotToFields(s),
              },
            });
          }
          stillExisting.push(s.nightId);
        }

        await tx.ledgerEntry.update({
          where: { id: entry.id },
          data: { undoneAt: new Date() },
        });
        await tx.ledgerEntry.create({
          data: {
            eventId: entry.eventId,
            actorId: ctx.session.user.id,
            axis: entry.axis,
            undoable: false,
            isUndo: true,
            nightCount: snapshot.length,
            summary: `Undid: ${entry.summary}`,
            nights: { connect: stillExisting.map((id) => ({ id })) },
          },
        });
      });

      return { undone: snapshot.length };
    }),
});

/**
 * What each action writes. Attribute-only actions touch nothing but their own
 * fields, so a re-price never quietly moves a state.
 */
/** Left out keeps what the night has; empty or null clears it on purpose (doc §4.8). */
function keepText(value: string | null | undefined) {
  if (value === undefined) return undefined;
  return value?.trim() || null;
}

/** A price and its currency travel together (invariant §4.5.9): given, cleared, or left as they are. */
function keepPrice<C extends string, K extends string>(
  cents: number | null | undefined,
  currency: string | undefined,
  centsKey: C,
  currencyKey: K,
): Partial<Record<C, number | null> & Record<K, string | null>> {
  if (cents === undefined) return {};
  return { [centsKey]: cents, [currencyKey]: cents === null ? null : (currency ?? null) } as Partial<
    Record<C, number | null> & Record<K, string | null>
  >;
}

/**
 * One line per field and value that a change altered — "Sell price: US$ 450.00
 * → US$ 480.00 (21 room-nights)" — for the ledger (doc §4.7). The status itself
 * is already in the entry's from/to; these are the details beside it.
 */
function describeChanges(before: LoadedNight[], after: LoadedNight[]) {
  const person = (user: { name: string | null; email: string | null } | null) => user?.name ?? user?.email ?? null;
  const money = (cents: number | null, currency: string | null) =>
    cents === null ? null : currency ? formatMoney(cents, currency) : String(cents / 100);
  const note = (text: string | null) => (text ? `“${text.length > 60 ? `${text.slice(0, 57)}…` : text}”` : null);
  const date = (value: Date | null) => (value ? formatDay(value) : null);
  const fields: { label: string; read: (night: LoadedNight) => string | null }[] = [
    { label: "Supplier reference", read: (night) => night.supplierRef },
    { label: "Option runs to", read: (night) => date(night.optionExpiry) },
    { label: "Buy price", read: (night) => money(night.buyPriceCents, night.buyCurrency) },
    { label: "Supplier notes", read: (night) => note(night.acquisitionNotes) },
    { label: "Supplier-side rep", read: (night) => person(night.acquisitionOwner) },
    { label: "Supplier contract", read: (night) => night.acquisitionContract?.name ?? null },
    { label: "Client", read: (night) => night.client?.name ?? null },
    { label: "Client reference", read: (night) => night.clientRef },
    { label: "Due date", read: (night) => date(night.blockExpiry) },
    { label: "Payment due", read: (night) => date(night.dueDate) },
    { label: "Sell price", read: (night) => money(night.sellPriceCents, night.sellCurrency) },
    { label: "Client notes", read: (night) => note(night.salesNotes) },
    { label: "Client-side rep", read: (night) => person(night.salesOwner) },
    { label: "Client contract", read: (night) => night.salesContract?.name ?? null },
  ];
  const was = new Map(before.map((night) => [night.id, night]));
  const counts = new Map<string, { order: number; line: string; count: number }>();
  for (const night of after) {
    const old = was.get(night.id);
    if (!old) continue;
    fields.forEach((field, order) => {
      const from = field.read(old);
      const to = field.read(night);
      if (from === to) return;
      const line = `${field.label}: ${from ?? "—"} → ${to ?? "—"}`;
      const entry = counts.get(line) ?? { order, line, count: 0 };
      entry.count += 1;
      counts.set(line, entry);
    });
  }
  if (counts.size === 0) return null;
  const lines = [...counts.values()]
    .sort((a, b) => a.order - b.order || b.count - a.count)
    .map((entry) => `${entry.line} (${entry.count} room-night${entry.count === 1 ? "" : "s"})`);
  const shown = lines.slice(0, 15);
  return [...shown, ...(lines.length > shown.length ? [`…and ${lines.length - shown.length} more changes`] : [])].join("\n");
}

function buildUpdate(
  action: InventoryAction,
  input: z.infer<typeof attributes>,
) {
  const acquisitionTo = acquisitionTarget[action];
  const salesTo = salesTarget[action];

  switch (action) {
    case "START_NEGOTIATION":
    case "TAKE_OPTION":
    case "BUY":
      return {
        acquisitionState: acquisitionTo,
        // Only an option carries an expiry; buying clears the clock.
        optionExpiry: acquisitionTo === "OPTION" ? input.optionExpiry : null,
        // The rest keeps what each night has unless given (doc §4.8).
        supplierRef: keepText(input.supplierRef),
        ...keepPrice(input.buyPriceCents, input.buyCurrency, "buyPriceCents", "buyCurrency"),
        acquisitionOwnerId: input.acquisitionOwnerId,
        acquisitionNotes: keepText(input.acquisitionNotes),
        acquisitionContractId: input.acquisitionContractId,
      };

    case "UPDATE_SUPPLIER_DETAILS":
      return {
        supplierRef: keepText(input.supplierRef),
        ...keepPrice(input.buyPriceCents, input.buyCurrency, "buyPriceCents", "buyCurrency"),
        acquisitionOwnerId: input.acquisitionOwnerId,
        acquisitionNotes: keepText(input.acquisitionNotes),
        acquisitionContractId: input.acquisitionContractId,
      };

    case "UPDATE_CLIENT_DETAILS":
      return {
        clientRef: keepText(input.clientRef),
        dueDate: input.dueDate,
        ...keepPrice(input.sellPriceCents, input.sellCurrency, "sellPriceCents", "sellCurrency"),
        salesOwnerId: input.salesOwnerId,
        salesNotes: keepText(input.salesNotes),
        salesContractId: input.salesContractId,
      };

    case "ABANDON":
      // Back to nothing started: the supplier relationship is gone, so the
      // details of it go with it. The ledger keeps what it was.
      return {
        acquisitionState: "NONE" as const,
        acquisitionContractId: null,
        supplierRef: null,
        optionExpiry: null,
        buyPriceCents: null,
        buyCurrency: null,
        acquisitionNotes: input.acquisitionNotes?.trim() || null,
      };

    case "RELEASE":
      // Handed back, but the price and the reference stay — releasing must
      // never erase history (doc §11.3).
      return {
        acquisitionState: "RELEASED" as const,
        optionExpiry: null,
        acquisitionNotes: input.acquisitionNotes?.trim() || null,
      };

    case "BLOCK":
    case "SELL":
      return {
        salesState: salesTo,
        clientId: input.clientId,
        // Only a block carries an expiry; signing clears the clock.
        blockExpiry: salesTo === "BLOCKED" ? input.blockExpiry : null,
        // The rest keeps what each night has unless given (doc §4.8); a night
        // passing to another client is cleared of the last one's after this.
        clientRef: keepText(input.clientRef),
        // A sale has no decision left to chase (doc §4.2).
        dueDate: salesTo === "SOLD" ? null : input.dueDate,
        ...keepPrice(input.sellPriceCents, input.sellCurrency, "sellPriceCents", "sellCurrency"),
        salesOwnerId: input.salesOwnerId,
        salesNotes: keepText(input.salesNotes),
        ...(input.salesRequestId !== undefined && { salesRequestId: input.salesRequestId }),
        salesContractId: input.salesContractId,
      };

    case "RELEASE_HOLD":
      // The hold is gone, so it belongs to no request any more.
      return {
        salesState: "NONE" as const,
        clientId: null,
        salesRequestId: null,
        salesContractId: null,
        clientRef: null,
        blockExpiry: null,
        dueDate: null,
        sellPriceCents: null,
        sellCurrency: null,
        salesNotes: input.salesNotes?.trim() || null,
      };

    case "CANCEL_SALE":
      // The client stays on the record: a cancelled sale is history we keep,
      // and it stops counting as sold (doc §4.2, §11.3).
      return {
        salesState: "CANCELLED" as const,
        blockExpiry: null,
        salesNotes: input.salesNotes?.trim() || null,
      };

    case "EXTEND_OPTION":
      return { optionExpiry: input.optionExpiry };
    case "EXTEND_BLOCK":
      return { blockExpiry: input.blockExpiry };
    case "REPRICE_BUY":
      return {
        buyPriceCents: input.buyPriceCents,
        buyCurrency: input.buyCurrency,
      };
    case "REPRICE_SELL":
      return {
        sellPriceCents: input.sellPriceCents,
        sellCurrency: input.sellCurrency,
      };
    case "REASSIGN_ACQUISITION_OWNER":
      return { acquisitionOwnerId: input.acquisitionOwnerId };
    case "REASSIGN_SALES_OWNER":
      return { salesOwnerId: input.salesOwnerId };

    default:
      // REQUEST and WITHDRAW_REQUEST do not touch the room-night row.
      return {};
  }
}
