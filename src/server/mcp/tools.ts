import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { TRPCError } from "@trpc/server";
import { z } from "zod";

import { unitInput, visitInput } from "~/lib/site-visits";

import { createCaller } from "~/server/api/root";
import { actingVia } from "~/server/audit";
import { db } from "~/server/db";

/**
 * What Claude can do in WeLodge OS (doc §2.10), as the person who connected
 * it: look things up, and make everyday changes. Every tool calls the same
 * action the site's own pages call — so the same rules apply, and every
 * change is written to the history in that person's name, "via Claude". No
 * tool deletes, buys, blocks or sells rooms, or makes an offer. Since
 * 2026-11-20 it can add properties, hotel quotations and contracts (with their
 * payments and deadlines) from a PDF the person shares (the owner's choice).
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
        "You cannot delete anything, or buy, block or sell rooms, or make offers — point the person to the site for those.",
        "Site visit reports: when the person gives you notes, a write-up or a PDF of a visit, post it with save_site_visit on the properties visited (each apartment its own property, under its landlord or chain as provider), keeping what the visitor saw and leaving out what they did not.",
        "Contractors — transport, furniture, cleaning, linen and other companies working on an event besides the hotels — are on each event's Contractors tab: find them with list_contractors, add one with create_contractor, and record their offers with add_contractor_quote (line by line for vehicles or services). A quote is not a contract: only register a contract once it is signed.",
        "When the person shares a PDF — a hotel's quotation (their proposal to us), a contractor's quote (add_contractor_quote), a signed contract, a property's fact sheet — read it, find the event, property, client or contract it belongs to (search before adding, so nothing is added twice), then show the person in a short list what you will add and ask them to confirm before writing. Never guess a figure or a date the PDF does not give: leave it out and say so. Terms that do not fit a field go, in words, into the notes or terms. Afterwards say what you added, with the link.",
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
        // An empty list (or nothing) tidies away to no text at all, which Claude
        // reads as a broken reply — say so in words instead.
        const text = typeof result === "string" ? result : (tidy(result) ?? (Array.isArray(result) ? "None found." : "Done."));
        return { content: [{ type: "text" as const, text }] };
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
    "list_emails",
    "The emails the team has with a client's contacts, from their connected Gmail — for a sales request or a client (one of the two), newest first, with the text. Read-only.",
    { salesRequestId: z.string().optional(), clientId: z.string().optional(), limit: z.number().int().min(1).max(50).default(15) },
    read,
    async ({ salesRequestId, clientId, limit }) => {
      if (!salesRequestId === !clientId) throw new Error("Give a sales request or a client.");
      const emails = salesRequestId ? await caller.email.forRequest({ id: salesRequestId }) : await caller.email.forClient({ clientId: clientId! });
      return emails.slice(0, limit).map((e) => ({
        sentAt: e.sentAt,
        from: e.fromName ? `${e.fromName} <${e.fromEmail}>` : e.fromEmail,
        to: e.to,
        cc: e.cc,
        subject: e.subject,
        text: e.bodyText?.slice(0, 4000),
        attachments: e.attachmentNames,
      }));
    },
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
    "Move a sales request to a stage. LOST needs a reason: NOT_INTERESTED, DECLINED, NO_REPLY or RELEASED. CONTRACTED needs the client's contract registered on the site first.",
    {
      id: z.string(),
      stage: z.enum(["INITIAL_INTEREST", "SPECIFY", "PROPOSAL_SENT", "NEGOTIATION", "CONTRACTED", "LOST"]),
      lostReason: z.enum(["NOT_INTERESTED", "DECLINED", "NO_REPLY", "RELEASED"]).optional(),
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
    "Post an update — a note, meeting feedback or call summary — on a sales request, a client, a property or a contractor (exactly one). An update on a sales request shows on its client's feed too.",
    {
      salesRequestId: z.string().optional(),
      clientId: z.string().optional(),
      propertyId: z.string().optional(),
      contractorId: z.string().optional(),
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
    "Put a task on the team's board, optionally assigned and tied to an event, property, client, sales request or contractor.",
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
      contractorId: z.string().optional(),
      links: z
        .array(z.object({ url: z.string().min(1).max(2000), title: z.string().max(200).optional() }))
        .max(20)
        .optional()
        .describe("Google Sheets, Docs or any page — put in the task's Links section (not only its description)."),
    },
    write,
    async ({ links, ...input }) => {
      const created = await caller.task.create(input as never);
      const taskId = (created as { id: string }).id;
      for (const link of links ?? []) await caller.task.addLink({ taskId, url: link.url, title: link.title });
      return { taskId, links: links?.length ?? 0 };
    },
  );

  tool(
    "add_task_link",
    "Put a link — a Google Sheet, Doc or any page — in the Links section of one or several tasks at once (up to 100). A task that already has that link is skipped.",
    {
      taskIds: z.array(z.string()).min(1).max(100),
      url: z.string().min(1).max(2000),
      title: z.string().max(200).optional().describe("What it is called on the task — 'Rooming tracker'. Empty shows what the link is."),
    },
    write,
    async ({ taskIds, url, title }) => {
      const full = /^https?:\/\//i.test(url.trim()) ? url.trim() : `https://${url.trim()}`;
      let added = 0;
      let already = 0;
      for (const taskId of [...new Set(taskIds)]) {
        const existing = await caller.task.links({ taskId });
        if (existing.some((link) => link.url === full)) {
          already++;
          continue;
        }
        await caller.task.addLink({ taskId, url: full, title });
        added++;
      }
      return { added, alreadyThere: already };
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

  // ── From a PDF: properties, hotel quotations and contracts (the owner, 2026-11-20) ──

  /** Money as the PDF says it — 198450.5 — into cents. */
  const cents = (amount: number | null | undefined) => (amount === null || amount === undefined ? null : Math.round(amount * 100));
  /** A percentage as the PDF says it — 20 or 12.5 — into hundredths of a percent. */
  const bp = (pct: number | null | undefined) => (pct === null || pct === undefined ? null : Math.round(pct * 100));
  const money = z.number().min(0).max(1_000_000_000);
  const pct = z.number().min(0).max(100);

  /** The event's entry for a property — put on the event's board first if it is not yet. */
  const entryFor = async (eventId: string, propertyId: string) => {
    const found = await db.scoutingEntry.findFirst({ where: { eventId, propertyId }, select: { id: true } });
    return found ?? (await caller.scouting.add({ eventId, propertyId }));
  };

  /** A room type by name on a property — added (with these rooms) if it is not there yet. */
  const categoryFor = async (propertyId: string, name: string, rooms: number, capacity: number) => {
    const existing = await db.roomCategory.findFirst({ where: { propertyId, name: { equals: name.trim(), mode: "insensitive" } }, select: { id: true } });
    if (existing) return existing.id;
    const made = await caller.property.saveCategory({ propertyId, category: { name: name.trim(), unitCount: rooms, capacity, currency: "USD" } });
    return made.id;
  };

  tool(
    "search_properties",
    "Find properties (hotels, apartments…) already in the system by name, city or address — always look before adding one, so it is not added twice. Returns property ids and the events each is on.",
    { query: z.string().min(2).max(200) },
    read,
    async ({ query }) => {
      const words = query.trim();
      const found = await db.property.findMany({
        where: { OR: [{ name: { contains: words, mode: "insensitive" } }, { city: { contains: words, mode: "insensitive" } }, { address: { contains: words, mode: "insensitive" } }] },
        select: { id: true, name: true, type: true, city: true, address: true, scoutingEntries: { select: { event: { select: { id: true, name: true } } } } },
        take: 25,
        orderBy: { name: "asc" },
      });
      return found.map(({ scoutingEntries, ...property }) => ({ ...property, events: scoutingEntries.map((entry) => entry.event) }));
    },
  );

  tool(
    "create_property",
    "Add a new property to the system — and, with an event id, onto that event's properties board. Search first. Refused if it looks like one already there; pass confirmedDifferent only when the person has said it is a different property. Room types can be given here or added later.",
    {
      name: z.string().min(1).max(300),
      type: z.enum(["HOTEL", "APARTHOTEL", "FURNISHED_APARTMENT", "UNFURNISHED_APARTMENT", "MOTEL", "HOSTEL", "BED_AND_BREAKFAST", "EXTENDED_STAY", "STUDENT_HOUSING", "GUEST_HOUSE", "INDIVIDUAL_HOME", "RESORT_LODGE", "OTHER"]),
      eventId: z.string().optional(),
      providerId: z.string().optional().describe("The chain or landlord it belongs to (list_providers / create_provider)."),
      address: z.string().max(500).optional(),
      city: z.string().max(200).optional(),
      country: z.string().max(200).optional(),
      stars: z.number().int().min(1).max(5).optional(),
      totalRooms: z.number().int().min(0).optional(),
      website: z.string().max(500).optional(),
      phone: z.string().max(100).optional(),
      generalEmail: z.string().max(300).optional(),
      checkInTime: z.string().max(50).optional(),
      checkOutTime: z.string().max(50).optional(),
      tradeName: z.string().max(300).optional(),
      vatNumber: z.string().max(100).optional(),
      registrationNumber: z.string().max(100).optional(),
      signatoryName: z.string().max(200).optional(),
      signatoryTitle: z.string().max(200).optional(),
      contractEmail: z.string().max(300).optional(),
      notes: z.string().max(5000).optional(),
      roomTypes: z
        .array(z.object({ name: z.string().min(1).max(200), rooms: z.number().int().min(0), sleeps: z.number().int().min(1).default(2), bedConfiguration: z.string().max(200).optional(), size: z.string().max(200).optional() }))
        .max(40)
        .default([]),
      contacts: z.array(z.object({ name: z.string().min(1).max(200), role: z.string().max(200).optional(), email: z.string().email().optional(), phone: z.string().max(100).optional() })).max(20).default([]),
      confirmedDifferent: z.boolean().optional(),
    },
    write,
    async ({ eventId, roomTypes, contacts, ...property }) => {
      const created = await caller.property.create({
        ...property,
        categories: roomTypes.map((room) => ({ name: room.name, unitCount: room.rooms, capacity: room.sleeps, bedConfiguration: room.bedConfiguration, size: room.size, currency: "USD" })),
        contacts,
      });
      if (eventId) await caller.scouting.add({ eventId, propertyId: created.id });
      return { propertyId: created.id, name: created.name, onEvent: eventId ?? null };
    },
  );

  tool(
    "add_property_to_event",
    "Put a property that is already in the system onto an event's properties board.",
    { eventId: z.string(), propertyId: z.string() },
    write,
    async ({ eventId, propertyId }) => {
      const entry = await entryFor(eventId, propertyId);
      return { onEvent: true, entryId: entry.id };
    },
  );

  tool(
    "add_room_type",
    "Add a room type to a property (Double, 1-bedroom apartment…), with how many rooms and how many people one sleeps.",
    {
      propertyId: z.string(),
      name: z.string().min(1).max(200),
      rooms: z.number().int().min(0),
      sleeps: z.number().int().min(1).default(2),
      bedConfiguration: z.string().max(200).optional(),
      bedrooms: z.number().int().min(0).optional(),
      bathrooms: z.number().min(0).optional(),
      size: z.string().max(200).optional(),
    },
    write,
    async ({ propertyId, name, rooms, sleeps, ...rest }) => {
      const made = await caller.property.saveCategory({ propertyId, category: { name, unitCount: rooms, capacity: sleeps, currency: "USD", ...rest } });
      return { roomTypeId: made.id, name: made.name };
    },
  );

  // --- Providers: hotel chains and landlords (doc §3.9) ----------------------------

  tool("list_providers", "Every provider — hotel chain, group or landlord (\"Babak\") — with its id and how many properties it has.", {}, read, async () =>
    (await caller.provider.list()).map((p) => ({ id: p.id, name: p.name, properties: p._count.properties })),
  );

  tool(
    "create_provider",
    "Add a provider — a hotel chain, group or landlord whose properties we deal with. List the providers first; a name already there is refused.",
    { name: z.string().min(1).max(200) },
    write,
    async ({ name }) => {
      const created = await caller.provider.create({ name });
      return { providerId: created.id, name: created.name };
    },
  );

  tool(
    "set_property_provider",
    "Say which provider (chain or landlord) a property belongs to — or none.",
    { propertyId: z.string(), providerId: z.string().nullable() },
    write,
    async ({ propertyId, providerId }) => {
      await caller.property.patch({ id: propertyId, providerId });
      return "Saved.";
    },
  );

  // --- Site visit reports (doc §3.12) --------------------------------------------------

  tool(
    "list_site_visits",
    "Site visit reports on a property or a provider, newest first — each place visited with its verdict and summary.",
    { propertyId: z.string().optional(), providerId: z.string().optional() },
    read,
    async (input) =>
      (await caller.siteVisit.list(input)).map((report) => ({
        id: report.id,
        title: report.title,
        visitedOn: report.visitedOn,
        visitors: report.visitors,
        places: report.units.map((unit) => ({ property: unit.property?.name, label: unit.label, verdict: unit.verdict, conclusion: unit.conclusion })),
        link: `/site-visits/${report.id}`,
      })),
  );

  tool("get_site_visit", "One site visit report in full, to read or change it (then save_site_visit with its id).", { id: z.string() }, read, async ({ id }) => {
    const report = await caller.siteVisit.byId({ id });
    if (!report) throw new TRPCError({ code: "NOT_FOUND", message: "That report no longer exists." });
    return report;
  });

  tool(
    "save_site_visit",
    [
      "Post a site visit report on the properties visited — one visit, one or several places (units), shown on each property's Site visits tab in We Lodge's report layout, and printable.",
      "For each place: the propertyId (search or create the property first — each apartment is its own property), a heading, a verdict (STRONG, NEEDS_WORK, NOT_READY or NO_GO) and optionally the badge in the visitor's words (verdictNote: 'Stronger option out of the 3'), a one- or two-line conclusion, the at-a-glance facts (Building, Sleeps, Bathrooms, Floors, Kitchen, Laundry, Outdoor, Entry, Condition — same labels across places, so they line up side by side), room by room (area → what was seen), issues and needs (a short bold title, the text, and the video link and time it shows in), and the videos (name and link).",
      "A new report tags the @LA team by itself (bell and email) — no separate update is needed to tell them. Keep the visitor's facts and words; do not invent what was not seen — say 'Not seen'. Show the person what you will post and wait for them to confirm. Pass id to replace an existing report with a corrected one.",
    ].join(" "),
    {
      id: z.string().optional(),
      ...visitInput.shape,
      units: z.array(unitInput).min(1).max(30),
    },
    write,
    async ({ id, ...report }) => {
      const saved = id ? await caller.siteVisit.update({ id, ...report }) : await caller.siteVisit.create(report);
      return { id: saved.id, link: `/site-visits/${saved.id}`, places: saved.units.map((unit) => unit.property?.name ?? unit.label) };
    },
  );

  // --- Contractors (doc §3.11): furniture, cleaning, linen… companies on one event ---

  const contractorKind = z.enum(["FURNITURE", "CLEANING", "LINEN", "MAINTENANCE", "TRANSPORT", "SECURITY", "CATERING", "OTHER"]);
  const contactShape = z.object({ name: z.string().min(1).max(200), role: z.string().max(200).optional(), email: z.string().email().optional(), phone: z.string().max(100).optional() });
  const contractorDetails = {
    service: z.string().max(2000).optional().describe("What it does, in words — needed when the kind is OTHER."),
    website: z.string().max(500).optional(),
    email: z.string().email().optional(),
    phone: z.string().max(100).optional(),
    notes: z.string().max(2000).optional(),
    tradeName: z.string().max(300).optional(),
    vatNumber: z.string().max(100).optional(),
    registrationNumber: z.string().max(100).optional(),
    iban: z.string().max(100).optional(),
    bic: z.string().max(100).optional(),
    signatoryName: z.string().max(200).optional(),
    signatoryTitle: z.string().max(200).optional(),
    contractEmail: z.string().max(300).optional(),
  };
  /** Its fields as they stand, with what is given laid over — the site's save takes them all. */
  const saveContractor = async (id: string, given: Record<string, unknown>, addContacts: z.infer<typeof contactShape>[]) => {
    const current = await caller.contractor.byId({ id });
    if (!current) throw new TRPCError({ code: "NOT_FOUND", message: "That contractor no longer exists." });
    const keep = (key: string) => (given[key] !== undefined ? given[key] : (current as Record<string, unknown>)[key]) ?? undefined;
    const keys = ["service", "website", "email", "phone", "notes", "tradeName", "vatNumber", "registrationNumber", "iban", "bic", "signatoryName", "signatoryTitle", "contractEmail"];
    const known = new Set(current.contacts.map((contact) => (contact.email ?? contact.name).toLowerCase()));
    await caller.contractor.update({
      id,
      name: (given.name as string | undefined) ?? current.name,
      kind: (given.kind as z.infer<typeof contractorKind> | undefined) ?? current.kind,
      ...(Object.fromEntries(keys.map((key) => [key, keep(key)])) as object),
      contacts: [
        ...current.contacts.map((contact) => ({ name: contact.name, role: contact.role ?? undefined, email: contact.email ?? undefined, phone: contact.phone ?? undefined })),
        ...addContacts.filter((contact) => !known.has((contact.email ?? contact.name).toLowerCase())),
      ],
    } as never);
  };

  tool(
    "list_contractors",
    "An event's contractors — furniture, cleaning, linen, maintenance, transport, security, catering or other companies working on it besides the hotels — with their ids, a first contact, and how many properties, contracts and tasks each has.",
    { eventId: z.string() },
    read,
    async ({ eventId }) =>
      (await caller.contractor.list({ eventId })).map((c) => ({
        id: c.id,
        name: c.name,
        kind: c.kind,
        service: c.service,
        email: c.email,
        phone: c.phone,
        contact: c.contacts[0] ? `${c.contacts[0].name}${c.contacts[0].email ? ` <${c.contacts[0].email}>` : ""}` : null,
        properties: c._count.properties,
        contracts: c._count.contracts,
        tasks: c._count.tasks,
      })),
  );

  tool("get_contractor", "One contractor in full: details, contacts, contracting details and the properties it serves.", { id: z.string() }, read, async ({ id }) => {
    const contractor = await caller.contractor.byId({ id });
    if (!contractor) throw new TRPCError({ code: "NOT_FOUND", message: "That contractor no longer exists." });
    return { ...contractor, link: `/events/${contractor.eventId}/contractors/${contractor.id}` };
  });

  tool(
    "create_contractor",
    "Add a contractor to an event's Contractors tab (a contractor belongs to one event). List the event's contractors first — a name already there is refused. Contacts, contracting details and the properties it serves can be given here.",
    {
      eventId: z.string(),
      name: z.string().min(1).max(200),
      kind: contractorKind,
      ...contractorDetails,
      contacts: z.array(contactShape).max(20).default([]),
      serves: z.array(z.object({ propertyId: z.string(), what: z.string().max(500).optional().describe("What it does there, e.g. 'linen for 40 apartments'.") })).max(100).default([]),
    },
    write,
    async ({ eventId, name, kind, contacts, serves, ...details }) => {
      const created = await caller.contractor.create({ eventId, name, kind, service: details.service });
      await saveContractor(created.id, details, contacts);
      for (const one of serves) await caller.contractor.setProperty({ contractorId: created.id, propertyId: one.propertyId, on: true, what: one.what });
      return { contractorId: created.id, name: created.name, link: `/events/${eventId}/contractors/${created.id}` };
    },
  );

  tool(
    "update_contractor",
    "Fill in or correct a contractor: only the fields given change. Contacts given are added to its contacts (none are removed).",
    { id: z.string(), name: z.string().min(1).max(200).optional(), kind: contractorKind.optional(), ...contractorDetails, addContacts: z.array(contactShape).max(20).default([]) },
    write,
    async ({ id, addContacts, ...given }) => {
      await saveContractor(id, given, addContacts);
      return "Saved.";
    },
  );

  tool(
    "set_contractor_property",
    "Record that a contractor serves a property on its event, and what it does there (or change what it does).",
    { contractorId: z.string(), propertyId: z.string(), what: z.string().max(500).optional() },
    write,
    async ({ contractorId, propertyId, what }) => {
      await caller.contractor.setProperty({ contractorId, propertyId, on: true, what });
      return "Saved.";
    },
  );

  tool(
    "add_contractor_quote",
    "Record a contractor's quote (not yet accepted — a transport, furniture, cleaning… offer) — what it is for, the amount or its lines (each with quantity, unit and price), the currency, when received and how long it is valid, its file's link and notes. It shows on the contractor's page, where it can be accepted to make the contract.",
    {
      contractorId: z.string(),
      title: z.string().min(1).max(300),
      amount: z.number().min(0).optional().describe("The quote's total in the currency's main unit, e.g. 12500.50 — leave out when giving lines."),
      lines: z
        .array(
          z.object({
            description: z.string().min(1).max(500).describe("What it is, e.g. 'Mercedes Sprinter, 16 seats — airport transfers'"),
            quantity: z.number().int().min(1),
            unit: z.string().max(100).optional().describe("What one is: 'per vehicle per day', 'per trip'"),
            unitPrice: z.number().min(0).describe("Price of one, in the currency's main unit"),
          }),
        )
        .max(100)
        .optional()
        .describe("For a quote made of lines — vehicles, services, items: the total is their sum."),
      currency: z.string().length(3).default("USD"),
      receivedOn: day.optional(),
      validUntil: day.optional(),
      documentUrl: z.string().max(2000).optional(),
      notes: z.string().max(5000).optional(),
    },
    write,
    async ({ amount, lines, ...quote }) => {
      const created = await caller.contractor.addQuote({
        ...quote,
        amountCents: amount === undefined ? null : Math.round(amount * 100),
        lines: lines?.map(({ unitPrice, ...line }) => ({ ...line, unitPriceCents: Math.round(unitPrice * 100) })),
      });
      return { quoteId: created.id };
    },
  );

  tool(
    "add_contractor_link",
    "Keep a link on a contractor's page under Files and links — a Google Sheet, Doc, Drive folder or any page — with an optional name.",
    { contractorId: z.string(), url: z.string().min(1).max(2000), name: z.string().max(300).optional() },
    write,
    async (input) => {
      await caller.contractor.addFile(input);
      return "Added.";
    },
  );

  tool(
    "list_quotations",
    "The quotations a hotel or apartment sent us for an event, with their lines and totals.",
    { eventId: z.string(), propertyId: z.string() },
    read,
    async ({ eventId, propertyId }) => {
      const entry = await db.scoutingEntry.findFirst({ where: { eventId, propertyId }, select: { id: true } });
      if (!entry) return "That property is not on this event's board yet, so it has no quotations for it.";
      return caller.quotation.forEntry({ scoutingEntryId: entry.id });
    },
  );

  tool(
    "add_quotation",
    [
      "Record a hotel's or apartment's quotation (their proposal to us) for an event — from the PDF they sent. The property is put on the event's board if it is not yet.",
      "Each line is rooms of one room type, for one stay (checkIn–checkOut), at one rate per room per night in the quotation's currency. A line charged by the day instead — a meeting room, day use — has per 'DAY': then checkIn is the first day and checkOut the last day, both counted, and the rate is per day. A room type is matched by name; one not on the property yet is added with that many rooms.",
      "Payments and cancellation terms as the hotel quotes them; anything that does not fit goes, in words, into paymentTerms, cancellationTerms or notes. Amounts are plain numbers (189.5), percentages plain numbers (20).",
    ].join(" "),
    {
      eventId: z.string(),
      propertyId: z.string(),
      name: z.string().min(1).max(300).describe("The group or scenario, like 'Austria House staff' or 'Main block'"),
      currency: z.string().length(3).default("USD"),
      receivedOn: day.optional(),
      validUntil: day.optional(),
      lines: z
        .array(
          z.object({
            roomType: z.string().min(1).max(200),
            checkIn: day,
            checkOut: day,
            per: z.enum(["NIGHT", "DAY"]).default("NIGHT").describe("Charged by the night, or by the day (a meeting room) — then checkOut is the last day"),
            rooms: z.number().int().min(1),
            ratePerNight: money.describe("The rate per room per night — or per day for a line charged by the day"),
            sleeps: z.number().int().min(1).max(20).optional(),
          }),
        )
        .min(1)
        .max(200),
      rateIncludes: z.array(z.enum(["BREAKFAST", "WIFI", "TAXES", "PARKING"])).default([]),
      rateIncludesOther: z.string().max(2000).default(""),
      cleaning: z.enum(["DAILY", "WEEKLY", "OTHER"]).nullable().default(null),
      cleaningOther: z.string().max(500).default(""),
      taxes: z
        .array(
          z.object({
            kind: z.enum(["OCCUPANCY", "CITY", "VAT", "SALES", "ISS", "SERVICE_CHARGE", "TOURISM", "TOURISM_DISTRICT", "RESORT_FEE", "OTHER"]),
            label: z.string().max(200).default(""),
            percent: pct.optional(),
            amountPerNight: money.optional(),
          }),
        )
        .max(20)
        .default([]),
      otherTaxes: z.string().max(2000).default(""),
      payments: z.array(z.object({ onSignature: z.boolean().default(false), dueOn: day.optional(), percent: pct, plusTaxes: z.boolean().default(false) })).max(20).default([]),
      cancellations: z
        .array(
          z.object({
            kind: z.enum(["ATTRITION", "RELEASE", "OTHER"]),
            cutoffOn: day.optional(),
            rooms: z.number().int().min(1).optional(),
            roomType: z.string().max(200).default(""),
            percent: pct.optional(),
            feePercent: pct.optional(),
            remarks: z.string().max(500).default(""),
          }),
        )
        .max(20)
        .default([]),
      paymentTerms: z.string().max(5000).default(""),
      cancellationTerms: z.string().max(5000).default(""),
      documentUrl: z.string().max(2000).default("").describe("A Google Drive link to the PDF, if the person gives one"),
      notes: z.string().max(5000).default(""),
      salesRequestId: z.string().optional().describe("The client request it was quoted for, if any"),
    },
    write,
    async (input) => {
      const entry = await entryFor(input.eventId, input.propertyId);
      const lines = [];
      for (const line of input.lines) {
        const categoryId = await categoryFor(input.propertyId, line.roomType, line.rooms, line.sleeps ?? 2);
        lines.push({ categoryId, checkIn: line.checkIn, checkOut: line.checkOut, per: line.per, rooms: line.rooms, rateCents: cents(line.ratePerNight)!, occupancy: line.sleeps ?? null });
      }
      const saved = await caller.quotation.save({
        scoutingEntryId: entry.id,
        quotation: {
          name: input.name,
          receivedOn: input.receivedOn ?? "",
          validUntil: input.validUntil ?? "",
          rooms: null,
          currency: input.currency.toUpperCase(),
          paymentTerms: input.paymentTerms,
          cancellationTerms: input.cancellationTerms,
          rateIncludes: input.rateIncludes,
          rateIncludesOther: input.rateIncludesOther,
          cleaning: input.cleaning,
          cleaningOther: input.cleaningOther,
          taxes: input.taxes.map((tax) => ({ kind: tax.kind, label: tax.label, basisPoints: bp(tax.percent), amountCents: tax.percent === undefined ? cents(tax.amountPerNight) : null })),
          otherTaxes: input.otherTaxes,
          documentUrl: input.documentUrl,
          notes: input.notes,
          salesRequestId: input.salesRequestId ?? null,
          agreementOn: null,
          payments: input.payments.map((payment) => ({ onSignature: payment.onSignature, dueOn: payment.dueOn ?? "", percentBasisPoints: bp(payment.percent)!, plusTaxes: payment.plusTaxes })),
          cancellations: input.cancellations.map((cut) => ({
            kind: cut.kind,
            cutoffOn: cut.cutoffOn ?? "",
            rooms: cut.rooms ?? null,
            roomType: cut.roomType,
            percentBasisPoints: bp(cut.percent),
            feeBasisPoints: bp(cut.feePercent),
            remarks: cut.remarks,
          })),
          lines,
        },
      });
      const quotation = saved as { id: string; totalCents?: number; payableCents?: number };
      return { quotationId: quotation.id, total: quotation.totalCents !== undefined ? quotation.totalCents / 100 : undefined, payable: quotation.payableCents !== undefined ? quotation.payableCents / 100 : undefined };
    },
  );

  tool(
    "list_contracts",
    "Contracts, filtered by event, property, client, contractor or sales request — each with what it still lacks (payment terms, cancellation terms, total, signed PDF).",
    {
      eventId: z.string().optional(),
      propertyId: z.string().optional(),
      clientId: z.string().optional(),
      contractorId: z.string().optional(),
      salesRequestId: z.string().optional(),
      party: z.enum(["SUPPLIER", "CLIENT"]).optional(),
    },
    read,
    async (input) =>
      (await caller.finance.contracts(input)).map((contract) => ({
        id: contract.id,
        name: contract.name,
        party: contract.party,
        event: contract.event.name,
        with: contract.property?.name ?? contract.contractor?.name ?? contract.client?.name,
        signedOn: contract.signedOn,
        total: contract.totalCents === null ? null : contract.totalCents / 100,
        currency: contract.currency,
        accountManager: contract.owner?.name,
        payments: contract._count.payments,
        cancellationDeadlines: contract._count.cancellations,
        missing: contract.missing,
      })),
  );

  tool("get_contract", "One contract in full: total, taxes, signed date, account manager, reminders, every payment (with its amount and status) and cancellation deadline.", { id: z.string() }, read, async ({ id }) => {
    const contract = await caller.finance.contract({ id });
    if (!contract) return "No such contract.";
    return {
      ...contract,
      totalCents: undefined,
      taxCents: undefined,
      total: contract.totalCents === null ? null : contract.totalCents / 100,
      taxes: contract.taxCents === null ? null : contract.taxCents / 100,
      payments: contract.payments.map((payment) => ({ ...payment, amountCents: undefined, amount: payment.amount === null ? null : payment.amount / 100 })),
    };
  });

  const paymentShape = z.object({
    description: z.string().min(1).max(500).describe("Like '1st deposit' or 'Final payment + tax'"),
    dueOn: day,
    percent: pct.optional().describe("A share of the contract total, like 20"),
    amount: money.optional().describe("Or a set amount instead of a share"),
    plusTaxes: z.boolean().default(false).describe("This payment also takes all of the contract's taxes"),
    status: z.enum(["TO_BE_PAID", "INVOICE_REQUESTED", "INVOICE_RECEIVED", "INVOICE_ISSUED", "PAID", "REFUND"]).default("TO_BE_PAID"),
    paidOn: day.optional(),
  });
  const deadlineShape = z.object({
    kind: z.enum(["ATTRITION", "RELEASE", "CLIENT_CANCELLATION", "OTHER"]).describe("ATTRITION/RELEASE on a hotel contract, CLIENT_CANCELLATION on a client contract"),
    cutoffOn: day,
    percent: pct.optional().describe("The share that may go by this date"),
    appliesTo: z.string().max(500).default("").describe("Or in words, like '63 room-nights'"),
    roomType: z.string().max(200).default(""),
    feePercent: pct.optional(),
    remarks: z.string().max(5000).default(""),
  });
  const addPayment = (contractId: string, payment: z.infer<typeof paymentShape>) =>
    caller.finance.savePayment({
      contractId,
      payment: {
        description: payment.description,
        dueOn: payment.dueOn,
        percentBasisPoints: bp(payment.percent),
        amountCents: payment.percent === undefined ? cents(payment.amount) : null,
        plusTaxes: payment.plusTaxes,
        status: payment.status,
        paidOn: payment.paidOn ?? "",
        invoiceUrl: "",
        proofUrl: "",
        beneficiary: "",
      },
    });
  const addDeadline = (contractId: string, cut: z.infer<typeof deadlineShape>) =>
    caller.finance.saveCancellation({
      contractId,
      cancellation: { kind: cut.kind, cutoffOn: cut.cutoffOn, percentBasisPoints: bp(cut.percent), appliesTo: cut.appliesTo, roomType: cut.roomType, feeBasisPoints: bp(cut.feePercent), remarks: cut.remarks },
    });

  tool(
    "create_contract",
    [
      "Register a signed contract from its PDF: with a hotel or apartment (SUPPLIER + propertyId), a contractor (SUPPLIER + contractorId) or a client (CLIENT + clientId, and the salesRequestId if it came from one), with its payments and cancellation deadlines.",
      "Look first with list_contracts that it is not there already. The total is the rooms before tax; taxes on top go in taxes; each payment is a share of the total (percent) or a set amount.",
      "It never buys or sells rooms and never moves a sales request to Contracted — say so, and point the person to the site for that.",
    ].join(" "),
    {
      party: z.enum(["SUPPLIER", "CLIENT"]),
      eventId: z.string(),
      propertyId: z.string().optional(),
      contractorId: z.string().optional(),
      clientId: z.string().optional(),
      salesRequestId: z.string().optional(),
      name: z.string().min(1).max(300).describe("Like 'Group Sales Agreement — Courtyard Culver City'"),
      signedOn: day.optional(),
      total: money.optional(),
      taxes: money.optional(),
      currency: z.string().length(3).default("USD"),
      documentUrl: z.string().max(2000).optional().describe("A Google Drive link to the signed PDF, if the person gives one"),
      notes: z.string().max(5000).optional(),
      paymentInstructions: z.string().max(5000).optional().describe("Where invoices must go or how payment is made, when the contract or person says: an email address, a portal to upload to, a PO to quote"),
      accountManagerId: z.string().optional().describe("Defaults to the person you are working for; they get the payment and deadline reminders"),
      noCancellationTerms: z.boolean().optional().describe("Only when the contract truly has no cancellation deadlines"),
      payments: z.array(paymentShape).max(30).default([]),
      cancellationDeadlines: z.array(deadlineShape).max(30).default([]),
    },
    write,
    async (input) => {
      const contract = await caller.finance.createContract({
        party: input.party,
        eventId: input.eventId,
        propertyId: input.propertyId,
        contractorId: input.contractorId,
        clientId: input.clientId,
        salesRequestId: input.salesRequestId,
        name: input.name,
        signedOn: input.signedOn ?? "",
        totalCents: cents(input.total),
        taxCents: cents(input.taxes),
        currency: input.currency.toUpperCase(),
        documentUrl: input.documentUrl ?? "",
        notes: input.notes ?? "",
        paymentInstructions: input.paymentInstructions,
        ownerId: input.accountManagerId ?? person.id,
        noCancellationTerms: input.noCancellationTerms,
      });
      const problems: string[] = [];
      for (const payment of input.payments) {
        await addPayment(contract.id, payment).catch((error: Error) => problems.push(`Payment "${payment.description}": ${error.message}`));
      }
      for (const cut of input.cancellationDeadlines) {
        await addDeadline(contract.id, cut).catch((error: Error) => problems.push(`Deadline ${cut.cutoffOn}: ${error.message}`));
      }
      return { contractId: contract.id, link: `/events/${input.eventId}/contracts/${contract.id}`, notAdded: problems };
    },
  );

  tool(
    "update_contract",
    "Fill in or correct a contract's own details from its PDF — name, signed date, total, taxes, currency, signed PDF link, notes, where invoices go (payment instructions), account manager. Only what is given changes.",
    {
      id: z.string(),
      name: z.string().min(1).max(300).optional(),
      signedOn: day.optional(),
      total: money.nullable().optional(),
      taxes: money.nullable().optional(),
      currency: z.string().length(3).optional(),
      documentUrl: z.string().max(2000).optional(),
      notes: z.string().max(5000).optional(),
      paymentInstructions: z.string().max(5000).optional().describe("Where invoices must go or how payment is made, when the contract or person says: an email address, a portal to upload to, a PO to quote"),
      accountManagerId: z.string().nullable().optional(),
      noCancellationTerms: z.boolean().optional(),
    },
    write,
    async ({ id, total, taxes, accountManagerId, ...rest }) => {
      await caller.finance.updateContract({
        id,
        ...rest,
        ...(rest.currency && { currency: rest.currency.toUpperCase() }),
        ...(total !== undefined && { totalCents: cents(total) }),
        ...(taxes !== undefined && { taxCents: cents(taxes) }),
        ...(accountManagerId !== undefined && { ownerId: accountManagerId }),
      });
      return "Contract updated.";
    },
  );

  tool("add_contract_payment", "Add a payment to a contract — its share of the total or a set amount, and its due date.", { contractId: z.string(), payment: paymentShape }, write, async ({ contractId, payment }) => {
    const saved = await addPayment(contractId, payment);
    return { paymentId: (saved as { id: string }).id };
  });

  tool(
    "add_contract_deadline",
    "Add a cancellation deadline to a contract — attrition, release or client cancellation, its date, share and fee.",
    { contractId: z.string(), deadline: deadlineShape },
    write,
    async ({ contractId, deadline }) => {
      const saved = await addDeadline(contractId, deadline);
      return { deadlineId: (saved as { id: string }).id };
    },
  );

  return server;
}
