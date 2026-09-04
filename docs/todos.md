# To-do list

**A living checklist, not a spec.** The specification lives in
`docs/product-scope.md`; this file is the queue of work against it — what to
build next and what to fix in what already exists. Update it as things get
done or the plan changes. It is not meant to be exhaustive of every polish
item, only what someone would need to know to decide what to work on next.

Last reviewed: 2026-09-04.

---

## 1. Ship to production

Nothing about this app is deployed anywhere yet. Nobody outside a laptop
running `pnpm run dev` can use it.

- [ ] **Pick a host.** Vercel is the natural fit for a T3-stack app (built by
      the same team as Next.js) and needs the least setup, but any Node host
      that can also run Postgres works. No decision has been made.
- [ ] **Provision a production database.** Local Postgres runs in Docker via
      `./start-database.sh`; production needs a managed instance (Vercel
      Postgres, Supabase, Neon, RDS — pick one) and its own `DATABASE_URL`.
- [ ] **Set every environment variable on the host**, from `.env.example`:
  - `DATABASE_URL` — the production database
  - `AUTH_SECRET` — generate a fresh one for production with `npx auth secret`;
    never reuse the local `.env` value
  - `AUTH_GOOGLE_ID` / `AUTH_GOOGLE_SECRET` — for Google Workspace sign-in
  - `AUTH_RESEND_KEY` / `EMAIL_FROM` — for magic-link sign-in
  - See §2 below — at least one sign-in method must actually be configured
    before this goes live, or nobody can log in.
- [ ] **Run migrations against production**, not `db:push`. Today the schema
      reaches the database with `pnpm run db:push`, which has no history and
      is a development convenience. Production wants
      `prisma migrate deploy` (`pnpm run db:migrate`) against a real migration
      history — which means starting to commit migrations, since none exist
      yet (`prisma migrate dev` has never been run).
- [ ] **Decide what "seeding production" means, if anything.**
      `pnpm run db:seed` deletes and rebuilds a demo event and its properties —
      it must never run against production. Real properties, clients and
      events need to be entered through the app once it's live, or imported
      separately.
- [ ] **Confirm the dev sign-in bypass is actually inert in production.** The
      README says `/api/dev-login` 404s and the button is hidden whenever
      `NODE_ENV !== "development"`, and that this has been checked against a
      production build — worth re-verifying against the real deployment once
      it exists, since a misconfigured `NODE_ENV` would quietly reopen a
      password-free login.
- [ ] **Add CI.** There is no `.github/workflows` (or equivalent) yet — nothing
      runs `pnpm run typecheck` or `pnpm run build` on a pull request. At minimum,
      typecheck and build should run before anything merges to `master`.
- [ ] **Decide on backups and monitoring** for the production database once it
      exists — nothing has been set up.

## 2. Sign-in has to actually work for real users

Right now the only working sign-in method for anyone outside development is
whichever of Google SSO or magic-link email gets configured — neither is set
up yet.

- [ ] **Google Workspace SSO**: register an OAuth client in Google Cloud
      Console, set the authorized redirect URI to the production domain
      (`https://<domain>/api/auth/callback/google`), and set
      `AUTH_GOOGLE_ID` / `AUTH_GOOGLE_SECRET` on the host. This is the
      better fit if everyone signing in has a `@welodge.net` account.
- [ ] **Magic-link email via Resend**: verify a sending domain at
      resend.com/domains (the shared `onboarding@resend.dev` sender only
      delivers to the Resend account owner — useless for a team), then set
      `AUTH_RESEND_KEY` and `EMAIL_FROM`.
- [ ] At least one of the two has to be configured before launch — with
      neither set, the sign-in page renders with no way in.
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
      with `prisma db push`, which doesn't produce migration files. This needs
      to be resolved before a production database can be safely evolved with
      `prisma migrate deploy` — see §1 above.
