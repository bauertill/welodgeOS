import { SalesRequestStage, type Prisma } from "generated/prisma";
import { TRPCError } from "@trpc/server";
import { randomBytes } from "crypto";
import { z } from "zod";

import { addDays, nightsBetween, parseDay, today } from "~/lib/dates";
import { formatDate, formatMoney, formatRange } from "~/lib/format";
import {
  clientContractingKeys,
  contractingFields,
  interestFields,
  isClosed,
  openStages,
  salesStageLabels,
} from "~/lib/sales";
import { createTRPCRouter, protectedProcedure, publicProcedure } from "~/server/api/trpc";
import { applyByPeriod, applyInventoryChange, checkPeriods } from "~/server/api/routers/inventory";
import { diffFields, logAudit } from "~/server/audit";
import { snapshotNight } from "~/server/inventory";

/**
 * Sales requests (doc §4.11): a client's interest in accommodation, followed
 * from the first enquiry until it is signed, released, lost, or never
 * answered — with who to chase and when, and the contracting details the
 * lawyers need.
 */

const text = z.string().max(20000).optional();
/** "2028-07-10", or "" to clear it. */
const day = z
  .string()
  .regex(/^(\d{4}-\d{2}-\d{2})?$/, "That date does not look right")
  .optional();

const textKeys = [...interestFields, ...contractingFields].map((field) => field.key);
const textShape = Object.fromEntries(textKeys.map((key) => [key, text])) as Record<
  (typeof textKeys)[number],
  typeof text
>;

const requestInput = z.object({
  ...textShape,
  contactId: z.string().nullable().optional(),
  eventId: z.string().nullable().optional(),
  ownerId: z.string().nullable().optional(),
  followUpOn: day,
  nextStep: text,
  proposalSentOn: day,
  blockedUntil: day,
  valueCents: z.number().int().min(0).nullable().optional(),
  valueCurrency: z.string().length(3).nullable().optional(),
});

const blank = (value: string) => (value.trim() ? value.trim() : null);
const toDate = (value: string) => (value ? parseDay(value) : null);

/** Only what was sent is changed; left out means unchanged. */
function dataFrom(input: z.infer<typeof requestInput>) {
  const data: Prisma.SalesRequestUncheckedUpdateInput = {};
  for (const key of [...textKeys, "nextStep"] as const) {
    const value = input[key];
    if (value !== undefined) data[key] = blank(value);
  }
  for (const key of ["contactId", "eventId", "ownerId"] as const) {
    if (input[key] !== undefined) data[key] = input[key] || null;
  }
  for (const key of ["followUpOn", "proposalSentOn", "blockedUntil"] as const) {
    const value = input[key];
    if (value !== undefined) data[key] = toDate(value);
  }
  if (input.valueCents !== undefined) {
    data.valueCents = input.valueCents;
    // A currency with no amount behind it is noise (§4.5).
    data.valueCurrency = input.valueCents === null ? null : (input.valueCurrency ?? "EUR");
  }
  return data;
}

const person = { select: { id: true, name: true, email: true, image: true } } as const;
const include = {
  client: { select: { id: true, name: true, shortName: true } },
  contact: { select: { id: true, name: true, title: true, email: true } },
  event: { select: { id: true, name: true } },
  owner: person,
} satisfies Prisma.SalesRequestInclude;

type Loaded = Prisma.SalesRequestGetPayload<{ include: typeof include }>;

/** How a request reads in its history — words and dates, not stored codes. */
function readable(request: Loaded) {
  const date = (value: Date | null) => (value ? formatDate(value) : null);
  return {
    ...request,
    stage: salesStageLabels[request.stage],
    contact: request.contact?.name ?? null,
    event: request.event?.name ?? null,
    owner: request.owner?.name ?? request.owner?.email ?? null,
    followUpOn: date(request.followUpOn),
    proposalSentOn: date(request.proposalSentOn),
    blockedUntil: date(request.blockedUntil),
    closedOn: date(request.closedOn),
    value:
      request.valueCents !== null && request.valueCurrency
        ? formatMoney(request.valueCents, request.valueCurrency)
        : null,
  };
}

const historyFields = [
  { key: "stage", label: "Stage" },
  { key: "owner", label: "Account manager" },
  { key: "contact", label: "Contact" },
  { key: "event", label: "Event" },
  { key: "followUpOn", label: "Follow up on" },
  { key: "nextStep", label: "Next step" },
  { key: "proposalSentOn", label: "Proposal sent on" },
  { key: "blockedUntil", label: "Deadline" },
  { key: "value", label: "Value" },
  ...interestFields.map(({ key, label }) => ({ key, label })),
  ...contractingFields.map(({ key, label }) => ({ key, label })),
] as { key: keyof ReturnType<typeof readable>; label: string }[];

async function checkContact(db: Prisma.TransactionClient, contactId: string | null | undefined, clientId: string) {
  if (!contactId) return;
  const contact = await db.clientContact.findUnique({ where: { id: contactId }, select: { clientId: true } });
  if (contact?.clientId !== clientId) {
    throw new TRPCError({ code: "BAD_REQUEST", message: "That contact does not work at this client." });
  }
}

/** "2028-07-10", required. */
const dayRequired = z.string().regex(/^\d{4}-\d{2}-\d{2}$/, "Give the date");

const roomVerbs = { REQUEST: "Rooms requested", BLOCK: "Rooms blocked", SELL: "Rooms sold" } as const;
const changeVerbs = {
  BLOCK: "Requested rooms blocked",
  SELL: "Rooms sold",
  WITHDRAW_REQUEST: "Request for rooms withdrawn",
  EXTEND_BLOCK: "Block extended",
  RELEASE_HOLD: "Block released",
  CANCEL_SALE: "Sale cancelled",
} as const;

/**
 * Every room of a category over a stay, and whether it could go to this
 * client: in inventory every night, and held by no other client. A room this
 * client already holds on any of those nights is theirs, not free.
 */
async function roomsFor(
  db: Prisma.TransactionClient,
  input: { eventId: string; categoryId: string; clientId: string; checkIn: Date; checkOut: Date },
) {
  const nightCount = nightsBetween(input.checkIn, input.checkOut);
  const slots = await db.roomSlot.findMany({
    where: { categoryId: input.categoryId },
    orderBy: { slotNumber: "asc" },
    select: {
      id: true,
      slotNumber: true,
      roomNights: {
        where: { eventId: input.eventId, date: { gte: input.checkIn, lt: input.checkOut } },
        select: { salesState: true, clientId: true, acquisitionState: true },
      },
    },
  });
  const hard = (state: string) => state === "BLOCKED" || state === "SOLD";
  return slots.map((slot) => {
    const present = slot.roomNights.length === nightCount;
    const heldByOther = slot.roomNights.some((night) => hard(night.salesState) && night.clientId !== input.clientId);
    const theirs = slot.roomNights.some((night) => hard(night.salesState) && night.clientId === input.clientId);
    return {
      slotId: slot.id,
      slotNumber: slot.slotNumber,
      present,
      theirs,
      free: present && !heldByOther && !theirs,
      bought: present && slot.roomNights.every((night) => night.acquisitionState === "BOUGHT"),
    };
  });
}

/**
 * Nights as the rectangles the inventory changes in — rooms × a run of dates
 * (doc §4.8). A request's rooms are usually one rectangle; where rooms arrive
 * or leave on different days, each run is its own.
 */
function rectangles(nights: { slotId: string; date: Date }[]) {
  const bySlot = new Map<string, Date[]>();
  for (const night of nights) bySlot.set(night.slotId, [...(bySlot.get(night.slotId) ?? []), night.date]);
  const runs = new Map<string, { slotIds: string[]; checkIn: Date; checkOut: Date }>();
  for (const [slotId, dates] of bySlot) {
    dates.sort((a, b) => a.getTime() - b.getTime());
    let start = dates[0]!;
    let end = dates[0]!;
    const flush = () => {
      const checkOut = addDays(end, 1);
      const key = `${start.toISOString()}|${checkOut.toISOString()}`;
      const run = runs.get(key) ?? { slotIds: [], checkIn: start, checkOut };
      run.slotIds.push(slotId);
      runs.set(key, run);
    };
    for (const date of dates.slice(1)) {
      if (nightsBetween(end, date) === 1) end = date;
      else {
        flush();
        start = date;
        end = date;
      }
    }
    flush();
  }
  return [...runs.values()];
}

export const salesRouter = createTRPCRouter({
  /**
   * The Sales requests page (doc §4.11): open ones by default, filtered by
   * event, account manager, and whether a follow-up is due.
   */
  list: protectedProcedure
    .input(
      z.object({
        show: z.enum(["open", "closed", "all"]).default("open"),
        eventId: z.string().optional(),
        ownerId: z.string().optional(),
        dueOnly: z.boolean().default(false),
        q: z.string().max(200).default(""),
      }),
    )
    .query(async ({ ctx, input }) => {
      const q = input.q.trim();
      const where: Prisma.SalesRequestWhereInput = {
        ...(input.show === "open" && { stage: { in: openStages } }),
        ...(input.show === "closed" && { stage: { notIn: openStages } }),
        ...(input.eventId && { eventId: input.eventId }),
        ...(input.ownerId && { ownerId: input.ownerId }),
        ...(input.dueOnly && { followUpOn: { lte: today() }, stage: { in: openStages } }),
        ...(q && {
          OR: [
            { client: { name: { contains: q, mode: "insensitive" } } },
            { client: { shortName: { contains: q, mode: "insensitive" } } },
            { contact: { name: { contains: q, mode: "insensitive" } } },
            { description: { contains: q, mode: "insensitive" } },
          ],
        }),
      };
      const requests = await ctx.db.salesRequest.findMany({
        where,
        orderBy: [{ followUpOn: { sort: "asc", nulls: "last" } }, { createdAt: "desc" }],
        take: 500,
        include,
      });
      // The nights held for each request, counted from the room-nights
      // themselves (doc §4.11) — never stored on the request.
      const counts = requests.length
        ? await ctx.db.roomNight.groupBy({
            by: ["salesRequestId", "salesState"],
            where: { salesRequestId: { in: requests.map((request) => request.id) }, salesState: { in: ["BLOCKED", "SOLD"] } },
            _count: { _all: true },
          })
        : [];
      const count = (id: string, state: "BLOCKED" | "SOLD") =>
        counts.find((row) => row.salesRequestId === id && row.salesState === state)?._count._all ?? 0;
      return requests.map((request) => ({
        ...request,
        nightsBlocked: count(request.id, "BLOCKED"),
        nightsSold: count(request.id, "SOLD"),
      }));
    }),

  /**
   * The rooms behind a request (doc §4.11): the room-nights held for it and
   * the nights it has asked about, by property, room category and state,
   * worked out from the inventory each time it is asked. Also counts the
   * client's holds and requests on the event that belong to no request yet.
   */
  rooms: protectedProcedure
    .input(z.object({ id: z.string() }))
    .query(async ({ ctx, input }) => {
      const request = await ctx.db.salesRequest.findUniqueOrThrow({
        where: { id: input.id },
        select: { clientId: true, eventId: true },
      });
      if (!request.eventId) return null;
      const category = { select: { id: true, name: true, property: { select: { id: true, name: true } } } } as const;
      const [held, requested, looseHolds, looseRequests] = await Promise.all([
        ctx.db.roomNight.findMany({
          where: { salesRequestId: input.id },
          select: {
            date: true,
            slotId: true,
            salesState: true,
            blockExpiry: true,
            sellPriceCents: true,
            sellCurrency: true,
            slot: { select: { category } },
          },
        }),
        ctx.db.roomNightRequest.findMany({
          where: { salesRequestId: input.id },
          select: {
            sellPriceCents: true,
            sellCurrency: true,
            roomNight: { select: { date: true, slotId: true, slot: { select: { category } } } },
          },
        }),
        ctx.db.roomNight.count({
          where: {
            eventId: request.eventId,
            clientId: request.clientId,
            salesState: { in: ["BLOCKED", "SOLD"] },
            salesRequestId: null,
          },
        }),
        ctx.db.roomNightRequest.count({
          where: { clientId: request.clientId, roomNight: { eventId: request.eventId }, salesRequestId: null },
        }),
      ]);
      type State = "REQUESTED" | "BLOCKED" | "SOLD" | "CANCELLED";
      type Row = {
        categoryId: string;
        propertyId: string;
        propertyName: string;
        categoryName: string;
        state: State;
        nights: number;
        rooms: Set<string>;
        from: Date;
        to: Date;
        blockExpiry: Date | null;
        prices: Set<string>;
        valueCents: number;
        currency: string | null;
      };
      const rows = new Map<string, Row>();
      const add = (
        night: { date: Date; slotId: string; slot: { category: { id: string; name: string; property: { id: string; name: string } } } },
        state: State,
        extra: { blockExpiry?: Date | null; sellPriceCents: number | null; sellCurrency: string | null },
      ) => {
        const { category } = night.slot;
        const key = `${category.id}|${state}`;
        const row =
          rows.get(key) ??
          ({
            categoryId: category.id,
            propertyId: category.property.id,
            propertyName: category.property.name,
            categoryName: category.name,
            state,
            nights: 0,
            rooms: new Set<string>(),
            from: night.date,
            to: night.date,
            blockExpiry: null,
            prices: new Set<string>(),
            valueCents: 0,
            currency: null,
          } satisfies Row);
        row.nights += 1;
        row.rooms.add(night.slotId);
        if (night.date < row.from) row.from = night.date;
        if (night.date > row.to) row.to = night.date;
        // The earliest a block runs out is the one to watch.
        if (extra.blockExpiry && (!row.blockExpiry || extra.blockExpiry < row.blockExpiry)) row.blockExpiry = extra.blockExpiry;
        row.prices.add(extra.sellPriceCents !== null && extra.sellCurrency ? `${extra.sellPriceCents} ${extra.sellCurrency}` : "");
        if (extra.sellPriceCents !== null && extra.sellCurrency) {
          row.valueCents += extra.sellPriceCents;
          row.currency = extra.sellCurrency;
        }
        rows.set(key, row);
      };
      for (const night of held) {
        if (night.salesState === "BLOCKED" || night.salesState === "SOLD" || night.salesState === "CANCELLED") {
          add(night, night.salesState, night);
        }
      }
      for (const claim of requested) add(claim.roomNight, "REQUESTED", claim);
      const order = { SOLD: 0, BLOCKED: 1, REQUESTED: 2, CANCELLED: 3 } as const;
      return {
        eventId: request.eventId,
        loose: looseHolds + looseRequests,
        rows: [...rows.values()]
          .sort((a, b) => a.propertyName.localeCompare(b.propertyName) || a.categoryName.localeCompare(b.categoryName) || order[a.state] - order[b.state])
          .map(({ rooms, prices, valueCents, currency, ...row }) => {
            // One price for every night is offered again when the rooms move on;
            // a mix is not guessed at.
            const [only] = prices.size === 1 ? [...prices] : [""];
            const [cents, code] = only ? only.split(" ") : [];
            return {
              ...row,
              rooms: rooms.size,
              price: cents && code ? { cents: Number(cents), currency: code } : null,
              // A value only means something when every night is priced in one currency.
              value: currency && !prices.has("") && new Set([...prices].map((p) => p.split(" ")[1])).size === 1 ? { cents: valueCents, currency } : null,
            };
          }),
      };
    }),

  /** The room categories an event has in inventory, for adding rooms to a request. */
  roomOptions: protectedProcedure
    .input(z.object({ id: z.string() }))
    .query(async ({ ctx, input }) => {
      const request = await ctx.db.salesRequest.findUniqueOrThrow({ where: { id: input.id }, select: { eventId: true } });
      if (!request.eventId) return [];
      const slots = await ctx.db.roomNight.groupBy({ by: ["slotId"], where: { eventId: request.eventId } });
      const categories = await ctx.db.roomCategory.findMany({
        where: { slots: { some: { id: { in: slots.map((slot) => slot.slotId) } } } },
        select: { id: true, name: true, property: { select: { name: true } } },
        orderBy: [{ property: { name: "asc" } }, { sortOrder: "asc" }],
      });
      return categories.map((category) => ({ id: category.id, label: `${category.property.name} · ${category.name}` }));
    }),

  /**
   * How many rooms of a category could be given to this request for the whole
   * stay — in inventory every night, and held by no other client — and how
   * many of those we have bought.
   */
  availability: protectedProcedure
    .input(z.object({ id: z.string(), categoryId: z.string(), checkIn: dayRequired, checkOut: dayRequired }))
    .query(async ({ ctx, input }) => {
      const request = await ctx.db.salesRequest.findUniqueOrThrow({ where: { id: input.id }, select: { clientId: true, eventId: true } });
      if (!request.eventId) return null;
      const checkIn = parseDay(input.checkIn);
      const checkOut = parseDay(input.checkOut);
      if (checkOut <= checkIn) return null;
      const rooms = await roomsFor(ctx.db, { eventId: request.eventId, categoryId: input.categoryId, clientId: request.clientId, checkIn, checkOut });
      return {
        total: rooms.length,
        free: rooms.filter((room) => room.free).length,
        freeBought: rooms.filter((room) => room.free && room.bought).length,
        alreadyTheirs: rooms.filter((room) => room.theirs).length,
        notInInventory: rooms.filter((room) => !room.present).length,
      };
    }),

  /**
   * Request, block or sell rooms for this request, straight into the event's
   * inventory (doc §4.11). The rooms are picked for the rep — free for every
   * night of the stay, bought ones first, lowest room numbers first — and the
   * change goes through the same rules, ledger and undo as the stock sheet.
   */
  addRooms: protectedProcedure
    .input(
      z.object({
        id: z.string(),
        categoryId: z.string(),
        rooms: z.number().int().min(1).max(500),
        checkIn: dayRequired,
        checkOut: dayRequired,
        action: z.enum(["REQUEST", "BLOCK", "SELL"]),
        blockExpiry: day,
        sellPriceCents: z.number().int().min(0).nullable().optional(),
        sellCurrency: z.string().length(3).optional(),
        clientRef: z.string().max(200).optional(),
        /** The client contract a sale is made under (doc §7.1). */
        salesContractId: z.string().optional(),
        /** Different rates for different dates — pre, event, post (doc §4.8). */
        periods: z
          .array(z.object({ checkIn: dayRequired, checkOut: dayRequired, priceCents: z.number().int().min(0), currency: z.string().length(3) }))
          .max(20)
          .optional(),
      }),
    )
    .mutation(({ ctx, input }) =>
      ctx.db.$transaction(
        async (tx) => {
          const request = await tx.salesRequest.findUniqueOrThrow({
            where: { id: input.id },
            select: { clientId: true, eventId: true, ownerId: true },
          });
          if (!request.eventId) {
            throw new TRPCError({ code: "BAD_REQUEST", message: "Choose the event under Details first — rooms belong to an event." });
          }
          const checkIn = parseDay(input.checkIn);
          const checkOut = parseDay(input.checkOut);
          if (checkOut <= checkIn) {
            throw new TRPCError({ code: "BAD_REQUEST", message: "Check-out must be after check-in; check-out day is never a night." });
          }
          const rooms = await roomsFor(tx, { eventId: request.eventId, categoryId: input.categoryId, clientId: request.clientId, checkIn, checkOut });
          const free = rooms
            .filter((room) => room.free)
            .sort((a, b) => Number(b.bought) - Number(a.bought) || a.slotNumber - b.slotNumber);
          if (free.length < input.rooms) {
            throw new TRPCError({
              code: "BAD_REQUEST",
              message: `Nothing was changed. Only ${free.length} of these rooms ${free.length === 1 ? "is" : "are"} free for every night of the stay${
                rooms.some((room) => !room.present) ? " (some are not in inventory for all those dates)" : ""
              }. Ask for fewer, or split the dates.`,
            });
          }
          const chosen = free.slice(0, input.rooms);
          const periods = input.periods?.map((period) => ({ ...period, checkIn: parseDay(period.checkIn), checkOut: parseDay(period.checkOut) }));
          if (periods?.length) checkPeriods(periods, checkIn, checkOut);
          const apply = (change: Parameters<typeof applyInventoryChange>[2]) =>
            periods?.length ? applyByPeriod(tx, ctx.session.user.id, change, periods) : applyInventoryChange(tx, ctx.session.user.id, change);
          const outcome = await apply({
            eventId: request.eventId,
            slotIds: chosen.map((room) => room.slotId),
            checkIn,
            checkOut,
            action: input.action,
            clientId: request.clientId,
            salesRequestId: input.id,
            blockExpiry: input.blockExpiry ? parseDay(input.blockExpiry) : undefined,
            sellPriceCents: input.sellPriceCents ?? undefined,
            sellCurrency: input.sellPriceCents != null ? input.sellCurrency : undefined,
            clientRef: input.clientRef,
            salesOwnerId: request.ownerId ?? undefined,
            ...(input.action === "SELL" && input.salesContractId && { salesContractId: input.salesContractId }),
          });
          const category = await tx.roomCategory.findUniqueOrThrow({
            where: { id: input.categoryId },
            select: { name: true, property: { select: { name: true } } },
          });
          await logAudit(tx, {
            actorId: ctx.session.user.id,
            entity: "SalesRequest",
            entityId: input.id,
            summary: `${roomVerbs[input.action]}: ${input.rooms} × ${category.name}, ${category.property.name}, ${formatRange(checkIn, checkOut)}`,
            changes: `Rooms #${chosen.map((room) => room.slotNumber).sort((a, b) => a - b).join(", #")} · ${outcome.nights} room-nights`,
          });
          return { ...outcome, slotNumbers: chosen.map((room) => room.slotNumber).sort((a, b) => a - b) };
        },
        { timeout: 30_000 },
      ),
    ),

  /**
   * Move a request's rooms on, a room category at a time (doc §4.11): a
   * request becomes a block or a sale, a block becomes a sale, is extended or
   * released, a sale is cancelled. Applied through the inventory's own rules,
   * one ledger entry per run of dates.
   */
  changeRooms: protectedProcedure
    .input(
      z.object({
        id: z.string(),
        categoryId: z.string(),
        state: z.enum(["REQUESTED", "BLOCKED", "SOLD"]),
        action: z.enum(["BLOCK", "SELL", "WITHDRAW_REQUEST", "EXTEND_BLOCK", "RELEASE_HOLD", "CANCEL_SALE"]),
        blockExpiry: day,
        sellPriceCents: z.number().int().min(0).nullable().optional(),
        sellCurrency: z.string().length(3).optional(),
        salesContractId: z.string().optional(),
      }),
    )
    .mutation(({ ctx, input }) =>
      ctx.db.$transaction(
        async (tx) => {
          const allowed = {
            REQUESTED: ["BLOCK", "SELL", "WITHDRAW_REQUEST"],
            BLOCKED: ["SELL", "EXTEND_BLOCK", "RELEASE_HOLD"],
            SOLD: ["CANCEL_SALE"],
          } as const;
          if (!(allowed[input.state] as readonly string[]).includes(input.action)) {
            throw new TRPCError({ code: "BAD_REQUEST", message: "That cannot be done to these rooms." });
          }
          const request = await tx.salesRequest.findUniqueOrThrow({
            where: { id: input.id },
            select: { clientId: true, eventId: true, ownerId: true },
          });
          if (!request.eventId) throw new TRPCError({ code: "BAD_REQUEST", message: "This request has no event." });
          const eventId = request.eventId;

          // The nights in question, with what a sale would otherwise wipe.
          const nights =
            input.state === "REQUESTED"
              ? (
                  await tx.roomNightRequest.findMany({
                    where: { salesRequestId: input.id, roomNight: { slot: { categoryId: input.categoryId } } },
                    select: {
                      clientRef: true,
                      sellPriceCents: true,
                      sellCurrency: true,
                      notes: true,
                      roomNight: { select: { slotId: true, date: true } },
                    },
                  })
                ).map((claim) => ({
                  slotId: claim.roomNight.slotId,
                  date: claim.roomNight.date,
                  clientRef: claim.clientRef,
                  sellPriceCents: claim.sellPriceCents,
                  sellCurrency: claim.sellCurrency,
                  salesNotes: claim.notes,
                  dueDate: null as Date | null,
                  salesOwnerId: request.ownerId,
                }))
              : await tx.roomNight.findMany({
                  where: { salesRequestId: input.id, salesState: input.state, slot: { categoryId: input.categoryId } },
                  select: {
                    slotId: true,
                    date: true,
                    clientRef: true,
                    sellPriceCents: true,
                    sellCurrency: true,
                    salesNotes: true,
                    dueDate: true,
                    salesOwnerId: true,
                  },
                });
          if (nights.length === 0) throw new TRPCError({ code: "BAD_REQUEST", message: "There are no such rooms on this request any more." });

          let applied = 0;
          for (const rect of rectangles(nights)) {
            const these = nights.filter((night) => rect.slotIds.includes(night.slotId) && night.date >= rect.checkIn && night.date < rect.checkOut);
            const same = <K extends keyof (typeof these)[number]>(key: K) => {
              const values = new Set(these.map((night) => String(night[key] instanceof Date ? (night[key] as Date).toISOString() : night[key])));
              return values.size === 1 ? these[0]![key] : undefined;
            };
            const priceGiven = input.sellPriceCents !== undefined;
            const outcome = await applyInventoryChange(tx, ctx.session.user.id, {
              eventId,
              slotIds: rect.slotIds,
              checkIn: rect.checkIn,
              checkOut: rect.checkOut,
              action: input.action,
              clientId: request.clientId,
              ...((input.action === "BLOCK" || input.action === "SELL") && { salesRequestId: input.id }),
              ...(input.action === "SELL" && input.salesContractId && { salesContractId: input.salesContractId }),
              blockExpiry: input.blockExpiry ? parseDay(input.blockExpiry) : undefined,
              // A sale keeps what the block said unless told otherwise; a mix
              // across nights is not guessed at.
              sellPriceCents: priceGiven ? (input.sellPriceCents ?? undefined) : ((same("sellPriceCents") as number | null) ?? undefined),
              sellCurrency: priceGiven ? input.sellCurrency : ((same("sellCurrency") as string | null) ?? undefined),
              clientRef: (same("clientRef") as string | null) ?? undefined,
              salesNotes: (same("salesNotes") as string | null) ?? undefined,
              dueDate: (same("dueDate") as Date | null) ?? undefined,
              salesOwnerId: (same("salesOwnerId") as string | null) ?? request.ownerId ?? undefined,
            });
            applied += outcome.nights;
            // A request that became a block or a sale is not also still a request.
            if (input.state === "REQUESTED" && input.action !== "WITHDRAW_REQUEST") {
              await applyInventoryChange(tx, ctx.session.user.id, {
                eventId,
                slotIds: rect.slotIds,
                checkIn: rect.checkIn,
                checkOut: rect.checkOut,
                action: "WITHDRAW_REQUEST",
                clientId: request.clientId,
                reason: "Became a block or a sale on the sales request",
              });
            }
          }
          const category = await tx.roomCategory.findUniqueOrThrow({
            where: { id: input.categoryId },
            select: { name: true, property: { select: { name: true } } },
          });
          await logAudit(tx, {
            actorId: ctx.session.user.id,
            entity: "SalesRequest",
            entityId: input.id,
            summary: `${changeVerbs[input.action]}: ${category.name}, ${category.property.name} — ${applied} room-nights`,
          });
          return { nights: applied };
        },
        { timeout: 60_000 },
      ),
    ),

  /**
   * Tie the client's holds and requests on the event that belong to no request
   * yet — made on the stock sheet, or before requests held nights — to this one.
   */
  tieLooseRooms: protectedProcedure
    .input(z.object({ id: z.string() }))
    .mutation(({ ctx, input }) =>
      ctx.db.$transaction(async (tx) => {
        const request = await tx.salesRequest.findUniqueOrThrow({ where: { id: input.id }, select: { clientId: true, eventId: true } });
        if (!request.eventId) throw new TRPCError({ code: "BAD_REQUEST", message: "This request has no event." });
        const loose = await tx.roomNight.findMany({
          where: { eventId: request.eventId, clientId: request.clientId, salesState: { in: ["BLOCKED", "SOLD"] }, salesRequestId: null },
        });
        const holds = await tx.roomNight.updateMany({
          where: { id: { in: loose.map((night) => night.id) } },
          data: { salesRequestId: input.id },
        });
        const claims = await tx.roomNightRequest.updateMany({
          where: { clientId: request.clientId, roomNight: { eventId: request.eventId }, salesRequestId: null },
          data: { salesRequestId: input.id },
        });
        if (loose.length) {
          // A change to a room-night is never unrecorded (§4.5.8).
          await tx.ledgerEntry.create({
            data: {
              eventId: request.eventId,
              actorId: ctx.session.user.id,
              axis: "SALES",
              nightCount: loose.length,
              summary: `Tied ${loose.length} room-nights to a sales request.`,
              undoable: true,
              beforeSnapshot: loose.map((night) => snapshotNight(night)),
              nights: { connect: loose.map((night) => ({ id: night.id })) },
            },
          });
        }
        await logAudit(tx, {
          actorId: ctx.session.user.id,
          entity: "SalesRequest",
          entityId: input.id,
          summary: `Tied the client's rooms on this event to this request: ${holds.count} held room-nights, ${claims.count} requested`,
        });
        return { holds: holds.count, requests: claims.count };
      }),
    ),

  /** A client's requests, for its own page. */
  forClient: protectedProcedure
    .input(z.object({ clientId: z.string() }))
    .query(({ ctx, input }) =>
      ctx.db.salesRequest.findMany({
        where: { clientId: input.clientId },
        orderBy: { createdAt: "desc" },
        include,
      }),
    ),

  byId: protectedProcedure
    .input(z.object({ id: z.string() }))
    .query(({ ctx, input }) =>
      ctx.db.salesRequest.findUnique({
        where: { id: input.id },
        include: {
          ...include,
          client: { select: { id: true, name: true, shortName: true, contacts: { orderBy: { name: "asc" }, select: { id: true, name: true, title: true } } } },
        },
      }),
    ),

  /**
   * Register a client's initial interest. The client is an existing one, or a
   * new one named here — an enquiry often comes from a company we have never
   * dealt with.
   */
  create: protectedProcedure
    .input(
      requestInput.extend({
        clientId: z.string().optional(),
        newClientName: z.string().max(200).optional(),
      }),
    )
    .mutation(({ ctx, input }) =>
      ctx.db.$transaction(async (tx) => {
        const { clientId: chosen, newClientName, ...fields } = input;
        let clientId = chosen;
        if (!clientId) {
          const name = newClientName?.trim();
          if (!name) throw new TRPCError({ code: "BAD_REQUEST", message: "Choose the client, or name a new one." });
          const existing = await tx.client.findFirst({ where: { name: { equals: name, mode: "insensitive" } } });
          if (existing) {
            clientId = existing.id;
          } else {
            const created = await tx.client.create({ data: { name } });
            clientId = created.id;
            await logAudit(tx, { actorId: ctx.session.user.id, entity: "Client", entityId: clientId, summary: "Added" });
          }
        }
        await checkContact(tx, fields.contactId, clientId);
        const request = await tx.salesRequest.create({
          data: { ...(dataFrom(fields) as Prisma.SalesRequestUncheckedCreateInput), clientId },
          include,
        });
        await logAudit(tx, {
          actorId: ctx.session.user.id,
          entity: "SalesRequest",
          entityId: request.id,
          summary: "Initial interest registered",
        });
        await logAudit(tx, {
          actorId: ctx.session.user.id,
          entity: "Client",
          entityId: clientId,
          summary: `Sales request added${request.event ? ` for ${request.event.name}` : ""}`,
        });
        return request;
      }),
    ),

  /** Change any part of a request; the history records what changed. */
  update: protectedProcedure
    .input(requestInput.extend({ id: z.string() }))
    .mutation(({ ctx, input }) =>
      ctx.db.$transaction(async (tx) => {
        const { id, ...fields } = input;
        const before = await tx.salesRequest.findUniqueOrThrow({ where: { id }, include });
        await checkContact(tx, fields.contactId, before.clientId);
        const after = await tx.salesRequest.update({ where: { id }, data: dataFrom(fields), include });
        const changes = diffFields(readable(before), readable(after), historyFields);
        if (changes) {
          await logAudit(tx, { actorId: ctx.session.user.id, entity: "SalesRequest", entityId: id, summary: "Updated", changes });
        }
        return after;
      }),
    ),

  /**
   * Move a request to another stage. Moving to *Proposal sent* dates the
   * proposal today unless a date is already there; closing it dates the close,
   * and reopening clears that — a request is closed only while its stage says so.
   */
  setStage: protectedProcedure
    .input(z.object({ id: z.string(), stage: z.nativeEnum(SalesRequestStage) }))
    .mutation(({ ctx, input }) =>
      ctx.db.$transaction(async (tx) => {
        const before = await tx.salesRequest.findUniqueOrThrow({ where: { id: input.id }, include });
        if (before.stage === input.stage) return before;
        const closing = isClosed(input.stage);
        const after = await tx.salesRequest.update({
          where: { id: input.id },
          data: {
            stage: input.stage,
            closedOn: closing ? (before.closedOn && isClosed(before.stage) ? before.closedOn : today()) : null,
            ...(input.stage === "PROPOSAL_SENT" && !before.proposalSentOn && { proposalSentOn: today() }),
          },
          include,
        });
        await logAudit(tx, {
          actorId: ctx.session.user.id,
          entity: "SalesRequest",
          entityId: input.id,
          summary: `Stage: ${salesStageLabels[before.stage]} → ${salesStageLabels[input.stage]}`,
        });
        return after;
      }),
    ),

  // --- The client's contracting link (doc §4.11) --------------------------------

  /**
   * Make a link for the client to fill in their contracting details. Making a
   * new one replaces the old: its address changes, so the old one stops working.
   */
  makeContractingLink: protectedProcedure
    .input(z.object({ id: z.string() }))
    .mutation(async ({ ctx, input }) => {
      const updated = await ctx.db.salesRequest.update({
        where: { id: input.id },
        data: { contractingToken: randomBytes(24).toString("base64url"), contractingLinkMadeAt: new Date() },
        select: { contractingToken: true },
      });
      await logAudit(ctx.db, { actorId: ctx.session.user.id, entity: "SalesRequest", entityId: input.id, summary: "Contracting link made" });
      return updated;
    }),

  /** Switch the link off: it then opens nothing. The details already sent stay. */
  switchOffContractingLink: protectedProcedure
    .input(z.object({ id: z.string() }))
    .mutation(async ({ ctx, input }) => {
      await ctx.db.salesRequest.update({ where: { id: input.id }, data: { contractingToken: null } });
      await logAudit(ctx.db, { actorId: ctx.session.user.id, entity: "SalesRequest", entityId: input.id, summary: "Contracting link switched off" });
    }),

  /**
   * What the client's page shows, found by the link's code alone — no sign-in.
   * Only their own company details and who we are dealing with: nothing else
   * on the request is sent to the browser.
   */
  contractingForm: publicProcedure
    .input(z.object({ token: z.string().min(20).max(100) }))
    .query(async ({ ctx, input }) => {
      const request = await ctx.db.salesRequest.findUnique({
        where: { contractingToken: input.token },
        select: {
          ...Object.fromEntries(clientContractingKeys.map((key) => [key, true])),
          contractingSubmittedAt: true,
          client: { select: { name: true } },
          event: { select: { name: true } },
        } as const,
      });
      if (!request) throw new TRPCError({ code: "NOT_FOUND", message: "This link is not in use any more." });
      return {
        clientName: request.client.name,
        eventName: request.event?.name ?? null,
        submittedAt: request.contractingSubmittedAt,
        values: Object.fromEntries(clientContractingKeys.map((key) => [key, (request as Record<string, unknown>)[key] ?? ""])) as Record<
          (typeof clientContractingKeys)[number],
          string
        >,
      };
    }),

  /** The client sends the form: it lands on the request, and the history says so. */
  submitContracting: publicProcedure
    .input(
      z.object({
        token: z.string().min(20).max(100),
        values: z.object(Object.fromEntries(clientContractingKeys.map((key) => [key, z.string().max(5000)])) as Record<
          (typeof clientContractingKeys)[number],
          z.ZodString
        >),
      }),
    )
    .mutation(({ ctx, input }) =>
      ctx.db.$transaction(async (tx) => {
        const before = await tx.salesRequest.findUnique({ where: { contractingToken: input.token }, include });
        if (!before) throw new TRPCError({ code: "NOT_FOUND", message: "This link is not in use any more." });
        if (!input.values.tradeName.trim()) {
          throw new TRPCError({ code: "BAD_REQUEST", message: "Please give your company's trade name." });
        }
        const data = Object.fromEntries(clientContractingKeys.map((key) => [key, blank(input.values[key])]));
        const after = await tx.salesRequest.update({
          where: { id: before.id },
          data: { ...data, contractingSubmittedAt: new Date() },
          include,
        });
        await logAudit(tx, {
          actorId: null,
          entity: "SalesRequest",
          entityId: before.id,
          summary: "Contracting details sent by the client, through the link",
          changes: diffFields(readable(before), readable(after), historyFields),
        });
        return { ok: true };
      }),
    ),
});
