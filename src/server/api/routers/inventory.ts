import { TRPCError } from "@trpc/server";
import { z } from "zod";

import { addDays, eachNight, nightsBetween } from "~/lib/dates";
import { formatDay } from "~/lib/format";
import {
  acquisitionLabels,
  acquisitionTarget,
  actionLabels,
  allowedAcquisitionMoves,
  allowedSalesMoves,
  salesLabels,
  salesTarget,
  type InventoryAction,
} from "~/lib/inventory";
import { toStayRows } from "~/lib/stay-rows";
import { createTRPCRouter, protectedProcedure } from "~/server/api/trpc";
import { axisOf, describeRoom, flatten, nightInclude } from "~/server/inventory";

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
const attributes = z.object({
  supplierRef: z.string().optional(),
  optionExpiry: z.date().optional(),
  buyPriceCents: z.number().int().min(0).optional(),
  buyCurrency: z.string().length(3).optional(),
  acquisitionOwnerId: z.string().optional(),
  acquisitionNotes: z.string().optional(),

  clientId: z.string().optional(),
  clientRef: z.string().optional(),
  blockExpiry: z.date().optional(),
  dueDate: z.date().optional(),
  sellPriceCents: z.number().int().min(0).optional(),
  sellCurrency: z.string().length(3).optional(),
  salesOwnerId: z.string().optional(),
  salesNotes: z.string().optional(),
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

      // §3.6 — inventory comes from a property this event has contracted.
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
      if (entry.status !== "CONTRACTED") {
        throw new TRPCError({
          code: "BAD_REQUEST",
          message: `${category.property.name} is marked "${entry.status.toLowerCase()}" on this event's scouting list. Only a contracted property becomes inventory — move it to Contracted first.`,
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
          select: { id: true },
        });

        await tx.ledgerEntry.create({
          data: {
            eventId: input.eventId,
            actorId: ctx.session.user.id,
            axis: "INVENTORY",
            toState: "NONE",
            nightCount: created.count,
            summary: `Brought ${category.property.name} ${category.name} #${input.slotFrom}–#${input.slotTo} into inventory for ${formatDay(input.checkIn)} – ${formatDay(input.checkOut)} (${created.count} room-nights, nothing contracted).`,
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

  /** What this event holds, as the derived stay rows of §5.4. */
  stockSheet: protectedProcedure
    .input(
      z.object({
        eventId: z.string(),
        propertyId: z.string().optional(),
        categoryId: z.string().optional(),
        clientId: z.string().optional(),
        minSeverity: z.number().int().min(0).max(4).optional(),
      }),
    )
    .query(async ({ ctx, input }) => {
      const nights = await ctx.db.roomNight.findMany({
        where: {
          eventId: input.eventId,
          slot: {
            categoryId: input.categoryId,
            category: { propertyId: input.propertyId },
          },
          ...(input.clientId
            ? {
                OR: [
                  { clientId: input.clientId },
                  { requests: { some: { clientId: input.clientId } } },
                ],
              }
            : {}),
        },
        include: nightInclude,
        orderBy: [{ slotId: "asc" }, { date: "asc" }],
      });

      const rows = toStayRows(nights.map(flatten));

      // Counted before the severity filter, so a rep can see what a stricter
      // filter would surface without having to apply it first.
      const severityCounts: Record<number, number> = { 0: 0, 1: 0, 2: 0, 3: 0, 4: 0 };
      for (const row of rows) severityCounts[row.position.severity]!++;

      return {
        rows:
          input.minSeverity === undefined
            ? rows
            : rows.filter((row) => row.position.severity >= input.minSeverity!),
        severityCounts,
      };
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
            indicativePriceCents: number | null;
            currency: string;
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
            indicativePriceCents: slot.category.indicativePriceCents,
            currency: slot.category.currency,
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

  /** Properties this event has contracted but not yet turned into inventory. */
  materialisable: protectedProcedure
    .input(z.object({ eventId: z.string() }))
    .query(async ({ ctx, input }) => {
      const entries = await ctx.db.scoutingEntry.findMany({
        where: { eventId: input.eventId, status: "CONTRACTED" },
        include: {
          property: {
            select: {
              id: true,
              name: true,
              categories: {
                orderBy: { sortOrder: "asc" },
                select: {
                  id: true,
                  name: true,
                  unitCount: true,
                  indicativePriceCents: true,
                  currency: true,
                },
              },
            },
          },
        },
        orderBy: { property: { name: "asc" } },
      });

      return entries.map((entry) => entry.property);
    }),

  /** The audit trail: who changed what, when, and why (doc §4.7). */
  ledger: protectedProcedure
    .input(z.object({ eventId: z.string(), limit: z.number().min(1).max(200).default(50) }))
    .query(({ ctx, input }) =>
      ctx.db.ledgerEntry.findMany({
        where: { eventId: input.eventId },
        orderBy: { createdAt: "desc" },
        take: input.limit,
        include: { actor: { select: { name: true, email: true } } },
      }),
    ),

  /**
   * §4.8 — the core mutation. Applies one transition to a rectangle of slots ×
   * nights, atomically, refusing the whole operation and naming the nights that
   * would break an invariant.
   */
  applyChange: protectedProcedure
    .input(
      attributes.extend({
        eventId: z.string(),
        slotIds: z.array(z.string()).min(1, "Pick at least one room"),
        checkIn: z.date(),
        checkOut: z.date(),
        action: z.enum(ACTIONS),
        reason: z.string().optional(),
      }),
    )
    .mutation(async ({ ctx, input }) => {
      const { action, eventId, slotIds, checkIn, checkOut, reason } = input;

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
          message: `Nothing was changed. ${expected - nights.length} of the ${expected} room-nights you selected are not in this event's inventory yet. Bring them in first.`,
        });
      }

      const problems: Problem[] = [];
      const client = input.clientId
        ? await ctx.db.client.findUnique({ where: { id: input.clientId } })
        : null;
      if (input.clientId && !client) {
        throw new TRPCError({ code: "BAD_REQUEST", message: "No such client." });
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
          "A block needs a date it runs to. A block with no deadline is inventory frozen for free, and invisible to every deadline report.",
        );
      }
      if (action === "SELL" || action === "REQUEST" || action === "WITHDRAW_REQUEST") {
        need(input.clientId, "Say which client this is for.");
      }
      if (action === "EXTEND_OPTION") need(input.optionExpiry, "Give the option's new date.");
      if (action === "EXTEND_BLOCK") need(input.blockExpiry, "Give the block's new date.");
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
          action === "REPRICE_SELL" &&
          night.salesState !== "BLOCKED" &&
          night.salesState !== "SOLD"
        ) {
          fail("no client holds it, so there is nothing to price.");
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

      // A currency with no amount behind it is noise, so it only travels with
      // a price (invariant §4.5.9).
      const requestData = {
        clientRef: input.clientRef?.trim() || null,
        sellPriceCents: input.sellPriceCents ?? null,
        sellCurrency: input.sellPriceCents ? (input.sellCurrency ?? null) : null,
        notes: input.salesNotes?.trim() || null,
        ownerId: input.salesOwnerId ?? null,
      };

      await ctx.db.$transaction(async (tx) => {
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
                create: { roomNightId, clientId: input.clientId!, ...requestData },
              }),
            ),
          );
        } else if (action === "WITHDRAW_REQUEST") {
          await tx.roomNightRequest.deleteMany({
            where: { roomNightId: { in: ids }, clientId: input.clientId! },
          });
        } else {
          await tx.roomNight.updateMany({ where: { id: { in: ids } }, data });
        }

        await tx.ledgerEntry.create({
          data: {
            eventId,
            actorId: ctx.session.user.id,
            axis,
            fromState: priorStates,
            toState: acquisitionTo
              ? acquisitionLabels[acquisitionTo]
              : salesTo
                ? salesLabels[salesTo]
                : null,
            nightCount: ids.length,
            summary: `${actionLabels[action]} — ${rooms} × ${nightCount} ${nightCount === 1 ? "night" : "nights"}, ${period}${client ? `, ${client.name}` : ""}.`,
            reason: reason?.trim() || null,
            nights: { connect: ids.map((id) => ({ id })) },
          },
        });
      });

      return { nights: ids.length, rooms: slotIds.length };
    }),
});

/**
 * What each action writes. Attribute-only actions touch nothing but their own
 * fields, so a re-price never quietly moves a state.
 */
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
        supplierRef: input.supplierRef?.trim() || null,
        // Only an option carries an expiry; buying clears the clock.
        optionExpiry: acquisitionTo === "OPTION" ? input.optionExpiry : null,
        buyPriceCents: input.buyPriceCents ?? null,
        buyCurrency: input.buyPriceCents ? (input.buyCurrency ?? null) : null,
        acquisitionOwnerId: input.acquisitionOwnerId ?? null,
        acquisitionNotes: input.acquisitionNotes?.trim() || null,
      };

    case "ABANDON":
      // Back to nothing started: the supplier relationship is gone, so the
      // details of it go with it. The ledger keeps what it was.
      return {
        acquisitionState: "NONE" as const,
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
        clientRef: input.clientRef?.trim() || null,
        // Only a block carries an expiry; signing clears the clock.
        blockExpiry: salesTo === "BLOCKED" ? input.blockExpiry : null,
        dueDate: input.dueDate ?? null,
        sellPriceCents: input.sellPriceCents ?? null,
        sellCurrency: input.sellPriceCents ? (input.sellCurrency ?? null) : null,
        salesOwnerId: input.salesOwnerId ?? null,
        salesNotes: input.salesNotes?.trim() || null,
      };

    case "RELEASE_HOLD":
      return {
        salesState: "NONE" as const,
        clientId: null,
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
