# To-do list

**A living checklist, not a spec.** The specification lives in
`docs/product-scope.md`; this file is the queue of work against it — what to
build next and what to fix in what already exists. Update it as things get
done or the plan changes. It is not meant to be exhaustive of every polish
item, only what someone would need to know to decide what to work on next.

Last reviewed: 2026-09-06.

---

## 1. Ship to production

**Live at https://welodge-os.vercel.app since 2026-09-06**, hosted on Vercel
under the We Lodge team (`we-lodge`) — a Vercel account of its own, separate
from any other work, so We Lodge owns the project and is billed for it
directly. The database is a Neon Postgres instance provisioned through
Vercel's marketplace.

- [x] **Pick a host.** Vercel, We Lodge team. The GitHub repo is connected, so
      every push to `master` deploys to the live site automatically; the Vercel
      CLI is not needed for routine changes.
- [x] **Provision a production database.** Neon Postgres, created through the
      Vercel marketplace, which sets `DATABASE_URL` on the project itself. The
      app connects through Neon's pooled endpoint, which is what serverless
      functions need.
- [x] **Set every environment variable on the host.** `DATABASE_URL` (from
      Neon) and `AUTH_SECRET` (generated fresh for production — the local value
      is not reused) are set. `AUTH_GOOGLE_ID` / `AUTH_GOOGLE_SECRET` are still
      outstanding, which is what §2 is about. Resend is deliberately unset; see
      the decision recorded there.
- [ ] **Run migrations against production, not `db:push`.** *Still open, and
      now more pressing than when it was written.* The production schema was
      created on 2026-09-06 with `prisma db push` — the development convenience
      this item warns against — because there is no migration history to deploy
      instead. Production therefore has all 17 tables but no baseline to
      migrate from. Before the schema changes again: run `prisma migrate dev`
      locally to generate an initial migration, then baseline production
      against it with `prisma migrate resolve --applied`. Doing this while the
      database still holds no real data is far cheaper than doing it later.
- [x] **Decide what "seeding production" means.** It means nothing: production
      starts empty and stays that way. Real properties, clients and events are
      entered through the app, so nobody ever has to wonder which rows are
      invented. `pnpm run db:seed` must never be pointed at it.
- [x] **Confirm the dev sign-in bypass is actually inert in production.**
      Verified against the live deployment on 2026-09-06: `POST` to
      `/api/dev-login` returns `404 Not found` and sets no session cookie.
- [ ] **Add CI.** Unchanged — nothing runs `pnpm run typecheck` or
      `pnpm run build` before a merge. This now matters more than it did: with
      `master` wired to the live site, a broken merge reaches production
      directly.
- [ ] **Decide on backups and monitoring.** Now a real question rather than a
      hypothetical one. Neon keeps its own point-in-time history, but nobody
      has chosen a retention window, and nothing alerts anyone if the site
      stops responding.
- [ ] **Know the `.env.local` trap.** Several Vercel CLI commands (`link`, and
      anything that provisions a marketplace database) write a `.env.local`
      holding the *production* `DATABASE_URL`. Next.js reads `.env.local` in
      preference to `.env`, so left in place it silently points local
      development — `pnpm run dev`, and far worse `pnpm run db:seed` — at the
      live database. Delete the file after any Vercel command that creates it.

## 2. Sign-in has to actually work for real users

**Decided on 2026-09-06: Google Workspace SSO is the sign-in method for
launch.** Everyone who needs the system at launch has a `@welodge.net`
account, so it is the shortest path to a working door.

- [ ] **Google Workspace SSO** — *the one remaining blocker to anybody using
      the live site.* An OAuth client has to be registered in Google Cloud
      Console with the consent screen set to **Internal**, which is the setting
      that limits sign-in to `@welodge.net` accounts rather than to anyone with
      a Google account. Authorized redirect URIs must be
      `https://welodge-os.vercel.app/api/auth/callback/google` and
      `http://localhost:3000/api/auth/callback/google`. Then set
      `AUTH_GOOGLE_ID` / `AUTH_GOOGLE_SECRET` on the Vercel project. Until this
      is done the live sign-in page reads "No sign-in method is configured" and
      there is no way in for anyone.
- [x] **Magic-link email via Resend — decided against for launch.** Verifying a
      sending domain is real work serving nobody yet, since no launch user sits
      outside the Workspace. The code still supports it untouched: set
      `AUTH_RESEND_KEY` and `EMAIL_FROM` and the option reappears on the
      sign-in page. Revisit the first time a supplier or client needs an
      account.
- [ ] **Roles and permissions are not built at all** (open question 5 in
      `product-scope.md` §9). Every signed-in user currently has full access
      to everything — there is no concept of a rep who can only touch their
      own clients, or an admin-only screen. Worth deciding whether that's
      acceptable for launch or blocking.

## 3. Phase 3 — Operations

Not started. This is the third of the three phases described in
`product-scope.md` §1, and answers "will the rooming lists we received
actually work against what we hold?" It's fully specified in §6 of that
document but has no schema, no screens, nothing. Coming back to this file to
break Phase 3 into smaller steps once Phase 1/2 gaps below are cleared is
probably the next big planning session.

## 4. Gaps inside Phase 1 and Phase 2

These are pieces of already-shipped phases that are explicitly marked
**Not built** in `product-scope.md` §12, or called out as known gaps in the
README. None of them are Phase 3 — they're loose ends in what's supposedly
done.

- [ ] **Calendar reminders for option and block deadlines** (§4.6). The
      Deadlines dashboard in the app shows everything expiring, soonest
      first — but nothing pushes that to anyone's Google Calendar or sends a
      notification. Needs Google credentials and a scheduled job.
- [ ] **Configurable deadline windows.** The "option expires in 7 days" /
      "block expires in 48 hours" warning thresholds are hard-coded constants
      in the code, with no screen to change them.
- [ ] **Google My Maps import for property coordinates** (§3.1). Coordinates
      are typed in by hand today; there's no bulk import from the sheet this
      replaced.
- [ ] **An admin screen for the amenity list** (§3.4). The controlled
      vocabulary of amenities is seeded in `prisma/seed.ts` and can only be
      changed by editing that file and reseeding — not through the app.
- [ ] **Shift dates** on an existing hold (§4.8) — moving a block or sale to a
      different date range without cancelling and re-creating it. This is
      tied up with the Phase 3 simulation work.
- [ ] **Split or merge a hold as a single operation** (§4.8). Splitting a
      hold across rooms is possible today in two separate operations; doing
      it atomically is blocked on open question 3 below.

## 5. Open questions blocking real decisions

These are from `product-scope.md` §9 — business questions, not engineering
ones. Each blocks a specific piece of work above until it's answered. Listed
here so they don't get lost; the fuller framing of each is in the scope
document.

- [ ] **Release deadlines on bought stock** — do supplier agreements ever
      carry a cancellation window? If so, `RELEASED` needs its own deadline
      clock.
- [ ] **What `dueDate` means on the sales sheet** — payment due date, or the
      client's decision deadline?
- [ ] **Slot stability across suppliers** — if a client's rooms move hotels,
      does the sale follow or get cancelled and re-sold? This is what's
      currently blocking split/merge as one operation (§4).
- [ ] **Contracted vs. indicative price** — should a negotiated rate live on
      the category as a rate card, rather than being entered per night?
- [ ] **Roles and permissions** — see §2 above. Is "We Lodge Rep" just a label,
      or does it need to gate who can sell, buy or release?
- [ ] **Overbooking policy** — should the system ever allow selling past what
      we hold, with a configured tolerance, rather than flagging every night?
- [ ] **Apartment slot numbering** — do apartment units need a real unit
      identifier from the operator, or is our internal numbering enough?
- [ ] **Availability semantics** — should blocks reduce availability by
      default, and should partial-period availability be offerable? Both
      figures are reported side by side today so this can be settled from
      real usage data rather than guessed at up front.
- [ ] **Indefinite blocks** — are there clients whose blocks genuinely have no
      deadline, and if so what review cadence replaces an expiry date?
- [ ] **Event period per property** — is the start/end date range a
      commercial fact belonging on the contract, or just a reporting filter?

## 6. Engineering hygiene worth doing before this grows further

- [ ] **No automated tests exist anywhere in the repo.** For a system whose
      whole premise is that every reported number is computed from room-nights
      on read (`CLAUDE.md`), the position grid, the invariant checks and the
      reporting math (`src/lib/position.ts`, `src/lib/reporting.ts`) are the
      highest-value places to start.
- [ ] **No Prisma migration history.** The schema has only ever been applied
      with `prisma db push`, which doesn't produce migration files — including
      the push that created the live database on 2026-09-06. Production now
      exists, so this is no longer theoretical: it has to be resolved before
      the schema changes again, and it is cheapest to do now while no real
      data is at stake. See §1 above for the steps.
