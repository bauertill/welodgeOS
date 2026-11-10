import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { TRPCError } from "@trpc/server";
import { z } from "zod";

import { createCaller } from "~/server/api/root";
import { actingVia } from "~/server/audit";
import { db } from "~/server/db";

/**
 * What Claude can do in WeLodge OS (doc §2.10), as the person who connected
 * it: look things up, and make everyday changes. Every tool calls the same
 * action the site's own pages call — so the same rules apply, and every
 * change is written to the history in that person's name, "via Claude". No
 * tool deletes, buys, blocks or sells rooms, or makes a contract.
 */

type Person = { id: string; name: string | null; email: string | null; image: string | null };

/** Nulls, empty strings and empty lists left out — less for Claude to read. */
const tidy = (value: unknown) =>
  JSON.stringify(
    value,
    (_, v: unknown) => (v === null || v === "" || (Array.isArray(v) && v.length === 0) ? undefined : v),
    1,
  );
const day = z.string().regex(/^\d{4}-\d{2}-\d{2}$/, "A date as YYYY-MM-DD");
const read = { readOnlyHint: true, destructiveHint: false, openWorldHint: false };
const write = { readOnlyHint: false, destructiveHint: false, openWorldHint: false };

export function welodgeServer(person: Person, headers: Headers) {
  const caller = createCaller({ db, session: { user: person, expires: new Date(Date.now() + 3600_000).toISOString() }, headers });
  const server = new McpServer(
    { name: "welodge-os", title: "WeLodge OS", version: "1.0.0" },
    {
      instructions: [
        `You are working in WeLodge OS for ${person.name ?? person.email} of We Lodge, who buys accommodation from hotels and sells it to B2B clients for events.`,
        "Words matter: a room-night is Bought / Option / In progress with the hotel, and Sold / Blocked / Requested with the client. A sales request moves Initial interest → Specify → Proposal sent → Negotiation → Contracted, or is Lost/Declined.",
        "Look things up before changing them, use ids from what you found, and say what you changed. Every change is recorded as made by this person via Claude.",
        "You cannot delete, buy, block or sell rooms, or make contracts — point the person to the site for those.",
      ].join("\n"),
    },
  );

  /** One tool: its action run as the person, "via Claude", an error said plainly. */
  const tool = <S extends z.ZodRawShape>(
    name: string,
    description: string,
    shape: S,
    annotations: typeof read,
    run: (args: z.objectOutputType<S, z.ZodTypeAny>) => Promise<unknown>,
  ) =>
    server.registerTool(name, { description, inputSchema: shape, annotations }, (async (args: z.objectOutputType<S, z.ZodTypeAny>) => {
      try {
        const result = await actingVia.run({ via: "Claude" }, () => run(args));
        return { content: [{ type: "text" as const, text: typeof result === "string" ? result : tidy(result) }] };
      } catch (error) {
        const message = error instanceof TRPCError || error instanceof Error ? error.message : "Something went wrong.";
        return { isError: true, content: [{ type: "text" as const, text: message }] };
      }
    }) as never);

  // --- Looking things up ------------------------------------------------------------

  tool("list_events", "Every event (LA28, EXPO Belgrade…) with its id and dates. Most other tools need an event id.", {}, read, async () =>
    (await caller.event.list()).map((event) => ({ id: event.id, name: event.name, from: event.startDate, to: event.endDate })),
  );

  tool("list_team", "The We Lodge team, with their ids — for account managers and task assignees.", {}, read, () => caller.user.list());

  tool(
    "search_clients",
    "Find clients by company name, short name, or a contact's name or email. Returns client ids.",
    { query: z.string().min(1).max(200) },
    read,
    async ({ query }) => caller.clients.search({ q: query }),
  );

  tool("get_client", "A client in full: details, contacts, and their sales requests.", { clientId: z.string() }, read, async ({ clientId }) => ({
    client: await caller.clients.byId({ id: clientId }),
    salesRequests: (await caller.sales.forClient({ clientId })).map((r) => ({ id: r.id, stage: r.stage, event: r.event?.name, description: r.description, owner: r.owner?.name })),
  }));

  tool(
    "list_sales_requests",
    "Sales requests, open ones by default. Filter by event, account manager, a search word, or follow-ups due today or earlier.",
    {
      show: z.enum(["open", "closed", "all"]).default("open"),
      eventId: z.string().optional(),
      accountManagerId: z.string().optional(),
      query: z.string().max(200).optional(),
      followUpDue: z.boolean().default(false),
    },
    read,
    async ({ show, eventId, accountManagerId, query, followUpDue }) =>
      (await caller.sales.list({ show, eventId, ownerId: accountManagerId, q: query ?? "", dueOnly: followUpDue })).map((r) => ({
        id: r.id,
        client: r.client.name,
        contact: r.contact?.name,
        event: r.event?.name,
        stage: r.stage,
        waitingOn: r.waitingOn,
        accountManager: r.owner?.name,
        followUpOn: r.followUpOn,
        nextStep: r.nextStep,
        description: r.description?.slice(0, 300),
        nightsSold: r.nightsSold,
        nightsBlocked: r.nightsBlocked,
      })),
  );

  tool("get_sales_request", "One sales request in full: what the client asked for, its stage, contacts, details and tasks.", { id: z.string() }, read, ({ id }) =>
    caller.sales.byId({ id }),
  );

  tool(
    "list_event_properties",
    "The hotels and apartments on an event's properties board, with their status and room types.",
    { eventId: z.string() },
    read,
    async ({ eventId }) =>
      (await caller.scouting.listForEvent({ eventId })).map((entry) => ({
        propertyId: entry.property.id,
        name: entry.property.name,
        type: entry.property.type,
        stars: entry.property.stars,
        city: entry.property.city,
        status: entry.status,
        roomTypes: entry.property.categories?.map((c: { name: string; unitCount: number }) => `${c.unitCount} × ${c.name}`),
      })),
  );

  tool("get_property", "A property in full: address, contacts, room types, amenities and terms.", { propertyId: z.string() }, read, ({ propertyId }) =>
    caller.property.byId({ id: propertyId }),
  );

  tool(
    "event_position",
    "An event's stock-sheet position: rooms bought, on option, sold and blocked, what is short or idle, and warnings. Optionally for one property or client.",
    { eventId: z.string(), propertyId: z.string().optional(), clientId: z.string().optional() },
    read,
    (scope) => caller.reporting.summary(scope),
  );

  tool(
    "list_tasks",
    "Tasks on the team's board. Filter by status, assignee, or a search word.",
    { status: z.enum(["BACKLOG", "TODO", "IN_PROGRESS", "DONE"]).optional(), assigneeId: z.string().optional(), query: z.string().max(200).optional() },
    read,
    async ({ status, assigneeId, query }) =>
      ((await caller.task.list({ status, assigneeId, search: query })) as { id: string; title: string; status: string; deadline: Date | null; assignees: { name: string | null }[] }[]).map((t) => ({
        id: t.id,
        title: t.title,
        status: t.status,
        deadline: t.deadline,
        assignees: t.assignees.map((a) => a.name),
      })),
  );

  // --- Everyday changes ---------------------------------------------------------------

  tool(
    "create_sales_request",
    "Register a new enquiry for a client (an existing client's id, or a new client's name), with what they asked for in their words.",
    {
      clientId: z.string().optional(),
      newClientName: z.string().max(200).optional(),
      eventId: z.string().optional(),
      contactId: z.string().optional(),
      accountManagerId: z.string().optional(),
      description: z.string().max(20_000),
      followUpOn: day.optional(),
      nextStep: z.string().max(2000).optional(),
    },
    write,
    async (input) => {
      const created = await caller.sales.create({
        clientId: input.clientId,
        newClientName: input.newClientName,
        eventId: input.eventId ?? null,
        contactId: input.contactId ?? null,
        ownerId: input.accountManagerId ?? person.id,
        description: input.description,
        followUpOn: input.followUpOn,
        nextStep: input.nextStep,
      });
      return { created: created.id, client: created.client.name, event: created.event?.name };
    },
  );

  tool(
    "update_sales_request",
    "Change a sales request's details: what they asked for, location, rooms, period, budget, follow-up date, next step, event, contact or account manager (to hand it over). Only what is given changes.",
    {
      id: z.string(),
      description: z.string().max(20_000).optional(),
      location: z.string().max(20_000).optional(),
      rooms: z.string().max(20_000).optional(),
      period: z.string().max(20_000).optional(),
      budget: z.string().max(20_000).optional(),
      followUpOn: z.union([day, z.literal("")]).optional(),
      nextStep: z.string().max(2000).optional(),
      eventId: z.string().nullable().optional(),
      contactId: z.string().nullable().optional(),
      accountManagerId: z.string().nullable().optional(),
    },
    write,
    async ({ accountManagerId, ...input }) => {
      const updated = await caller.sales.update({ ...input, ...(accountManagerId !== undefined && { ownerId: accountManagerId }) });
      return { updated: updated.id, accountManager: updated.owner?.name, event: updated.event?.name };
    },
  );

  tool(
    "set_sales_stage",
    "Move a sales request to a stage. LOST needs a reason: DECLINED, NO_REPLY or RELEASED. CONTRACTED needs the client's contract registered on the site first.",
    {
      id: z.string(),
      stage: z.enum(["INITIAL_INTEREST", "SPECIFY", "PROPOSAL_SENT", "NEGOTIATION", "CONTRACTED", "LOST"]),
      lostReason: z.enum(["DECLINED", "NO_REPLY", "RELEASED"]).optional(),
    },
    write,
    async (input) => {
      const moved = await caller.sales.setStage(input);
      return { id: moved.id, stage: moved.stage };
    },
  );

  tool(
    "set_sales_waiting",
    "Mark what an open sales request is waiting on — CONTRACT_SENT, AWAITING_APPROVAL or PENDING — or null to clear it. It never changes the stage.",
    { id: z.string(), waitingOn: z.enum(["CONTRACT_SENT", "AWAITING_APPROVAL", "PENDING"]).nullable() },
    write,
    async (input) => {
      await caller.sales.setWaiting(input);
      return `Marked ${input.waitingOn ?? "not waiting"}.`;
    },
  );

  tool(
    "add_client_contact",
    "Add a person at a client.",
    {
      clientId: z.string(),
      name: z.string().min(1).max(200),
      title: z.string().max(300).optional(),
      email: z.string().email().optional(),
      mobile: z.string().max(100).optional(),
      phone: z.string().max(100).optional(),
    },
    write,
    async ({ clientId, ...contact }) => {
      const created = await caller.clients.saveContact({ clientId, contact });
      return { contactId: created.id, name: created.name };
    },
  );

  tool(
    "post_update",
    "Post an update on a client's or a property's history — a note, meeting feedback or call summary.",
    {
      clientId: z.string().optional(),
      propertyId: z.string().optional(),
      body: z.string().min(1).max(20_000),
      kind: z.enum(["NOTE", "MEETING", "CALL"]).default("NOTE"),
      happenedOn: day.optional(),
    },
    write,
    async (input) => {
      await caller.update.post(input as never);
      return "Posted.";
    },
  );

  tool(
    "create_task",
    "Put a task on the team's board, optionally assigned and tied to an event, property, client or sales request.",
    {
      title: z.string().min(1).max(300),
      details: z.string().max(10_000).optional(),
      assigneeIds: z.array(z.string()).max(20).optional(),
      deadline: day.optional(),
      priority: z.enum(["LOW", "MEDIUM", "HIGH"]).optional(),
      eventId: z.string().optional(),
      propertyId: z.string().optional(),
      clientId: z.string().optional(),
      salesRequestId: z.string().optional(),
    },
    write,
    async (input) => {
      const created = await caller.task.create(input as never);
      return { taskId: (created as { id: string }).id };
    },
  );

  tool(
    "update_task_status",
    "Move a task to BACKLOG, TODO, IN_PROGRESS or DONE.",
    { id: z.string(), status: z.enum(["BACKLOG", "TODO", "IN_PROGRESS", "DONE"]) },
    write,
    async (input) => {
      await caller.task.update(input);
      return `Task now ${input.status}.`;
    },
  );

  tool("comment_on_task", "Add a comment to a task.", { taskId: z.string(), body: z.string().min(1).max(10_000) }, write, async (input) => {
    await caller.task.comment(input);
    return "Commented.";
  });

  return server;
}
