# To-do list

**A living checklist, not a spec.** The specification lives in
`docs/product-scope.md`; this file is the queue of work against it — what to
build next and what to fix in what already exists. Update it as things get
done or the plan changes. It is not meant to be exhaustive of every polish
item, only what someone would need to know to decide what to work on next.

Last reviewed: 2026-09-24.

---

## 1. Ship to production

**Live at https://os.welodge.net since 2026-09-24**, and at
`welodge-os.vercel.app` from 2026-09-06 until then. Hosted on Vercel under the
We Lodge team (`we-lodge`) — a Vercel account of its own, separate from any
other work, so We Lodge owns the project and is billed for it directly. The
database is a Neon Postgres instance provisioned through Vercel's marketplace.

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
- [x] **Decide what "seeding production" means.** It means the amenity
      vocabulary and nothing else. Production holds no events, properties or
      clients — those are entered through the app, so nobody ever has to wonder
      which rows are invented. But the amenity list is a controlled vocabulary
      the app depends on: without it no property can be tagged and the scouting
      filters have nothing to filter by. `pnpm run db:seed` must never be
      pointed at production, because it deletes and rebuilds demo data;
      `pnpm run db:seed:amenities` was added for exactly this and writes the
      vocabulary alone. Loaded into production on 2026-09-06.
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
- [x] **The site has its own address, `os.welodge.net`** — done 2026-09-24.
      Vercel's own `welodge-os.vercel.app` read as somebody's side project
      rather than a We Lodge system. What was set up, in case any of it has to
      be repeated or undone:
  - A `CNAME` record on `welodge.net` at Cloudflare, name `os`, pointing at
    the target Vercel gave for this project, **proxy off — DNS only**. With
    Cloudflare's proxy on, Vercel can neither confirm the address nor renew
    its certificate, and the site sits behind two CDNs disagreeing about what
    to cache. The certificate is Let's Encrypt, issued by Vercel, renewed by
    Vercel; nobody has to diarise it.
  - `https://os.welodge.net/api/auth/callback/google` added to the OAuth
    client's authorized redirect URIs. Without it Google refuses every
    sign-in, because it checks the address the request came from against that
    list. The old address stays on the list only because removing it would
    break nothing and buy nothing.
  - `welodge-os.vercel.app` redirects to the new address, set on Vercel's
    Domains screen, so old links and bookmarks still arrive.
  - Everyone was signed out once by the move: a session lives in a cookie
    belonging to one address, and this is a different one.
  - **Still owed when the Google Maps work merges:** the browser key is
    restricted to the web addresses allowed to use it, so `os.welodge.net/*`
    has to join `welodge-os.vercel.app` and `localhost:3000` in its
    restrictions, or the map will show its "no key" notice on the live site.
    **Still outstanding** — the keys exist and are set on Vercel, but the new
    address was added to the key's restrictions after they were made, so this
    has to be checked before anyone judges the live map.
- [ ] **Know the `.env.local` trap.** Several Vercel CLI commands (`link`, and
      anything that provisions a marketplace database) write a `.env.local`
      holding the *production* `DATABASE_URL`. Next.js reads `.env.local` in
      preference to `.env`, so left in place it silently points local
      development — `pnpm run dev`, and far worse `pnpm run db:seed` — at the
      live database. Delete the file after any Vercel command that creates it.

## 2. Sign-in has to actually work for real users

**Settled on 2026-09-06: Google Workspace SSO, and it works.** Everyone who
needs the system at launch has a `@welodge.net` account, so it was the
shortest path to a working door. Adding somebody to the Workspace is now what
grants them access to We Lodge OS; removing them is what withdraws it. See
`product-scope.md` §2.5.

- [x] **Google Workspace SSO — working on the live site since 2026-09-06.**
      The OAuth client is registered with the consent screen set to
      **Internal**, which is what limits sign-in to `@welodge.net` accounts
      rather than to anyone with a Google account, and
      `AUTH_GOOGLE_ID` / `AUTH_GOOGLE_SECRET` are set on the Vercel project for
      **production only**. Preview deployments deliberately have no credentials:
      they get throwaway web addresses that Google would refuse anyway, so
      sign-in there fails rather than half-working. Verified end to end — a
      `@welodge.net` account signs in and the user record is written.
- [x] **Magic-link email via Resend — decided against for launch.** Verifying a
      sending domain is real work serving nobody yet, since no launch user sits
      outside the Workspace. The code still supports it untouched: set
      `AUTH_RESEND_KEY` and `EMAIL_FROM` and the option reappears on the
      sign-in page. Revisit the first time a supplier or client needs an
      account.
- [ ] **Roles and permissions are not built at all** (open question 5 in
      `product-scope.md` §9). Every signed-in user currently has full access
      to everything — there is no concept of a rep who can only touch their
      own clients, or an admin-only screen. Now that the site is live and
      anyone in the Workspace can sign themselves in, this has stopped being
      hypothetical: the first person to visit out of curiosity gets the same
      powers as the person who built it. Worth deciding whether that's
      acceptable or blocking.

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
- [ ] **Google map, places of interest and client map links** (§3.7, §3.8,
      §5.5). Specified 2026-09-18, not built. What has to happen outside the
      code first:
  - [ ] **A Google Cloud billing account for We Lodge**, in the same Google
        Cloud project that already holds the sign-in client. Someone at We
        Lodge with a company card has to do this; it can't be done on their
        behalf. Enable the *Maps JavaScript API* and the *Routes API*.
  - [ ] **Two keys, not one.** A *browser key* that draws the map, restricted
        to `os.welodge.net`, `welodge-os.vercel.app` and `localhost:3000` (and
        `localhost:3001`, which is where the app lands when another project
        holds 3000) so it is useless on any other site; and a *server key* for
        travel times, restricted to the
        Routes API, which never leaves the server. Both go on Vercel and in the
        local `.env`: the browser key as `NEXT_PUBLIC_GOOGLE_MAPS_API_KEY`, the
        server key as `GOOGLE_MAPS_SERVER_KEY`.
  - [ ] **A map ID** (Google Cloud → Map management → Create map ID,
        JavaScript, Vector), set as `NEXT_PUBLIC_GOOGLE_MAPS_MAP_ID`. Without
        it the map falls back to Google's demo ID, which works but is meant
        for testing.
  - [ ] **Set the keys on Vercel before the map code reaches `master`.** The
        map is already switched to Google on the `google-maps` branch; without
        a key the live site would show a notice where the map was.
  - [ ] **A monthly budget alert in Google Cloud.** Expected cost is a few
        dollars a month: Google gives several thousand free lookups per month,
        and opening one property against five places of interest is 15
        lookups (5 places × 3 modes). A budget alert is the safeguard in case
        a link is opened far more than expected — by a crawler, for instance.
  - [ ] **Baseline the production database first** — see §1. This is the
        first change to the database's shape since it went live, and there is
        no migration history to apply it from. Pushing the code to `master`
        without updating the live database first would break the live site.
  - [ ] **Carry the live venues across when the schema is applied.** Use
        `prisma/venues-to-places.ts`: `read` before applying the schema,
        `prisma db push`, then `write`. Re-running `write` is safe. The three
        `Event.venue*` columns are gone, replaced by places of interest
        (§3.7). Applying the schema drops them, so before that: read every
        event's venue name and coordinates out of the live database, apply the
        schema, then write each one back as a place of interest of category
        `VENUE`. Done locally on 2026-09-24 this way; the live database still
        has to have it done. Skipping it loses every venue silently.
  - [ ] **Work out why the Google map stopped rendering locally.** It drew
        correctly once, with all pins, on 2026-09-24 and then stopped. Google
        accepts the key (maps can be created by hand on the same page), there
        are no errors in the browser, and it is not React strict mode and not
        the corrupted build cache that was cleared. Unresolved — the map must
        not be called working until somebody has seen it.
- [ ] **Google My Maps import for property coordinates** (§3.1). Coordinates
      are typed in by hand today; there's no bulk import from the sheet this
      replaced. *Waiting on the current My Map's link or KML export*, so the
      import copies what is actually on it (layers, colours, notes) rather
      than guessing.
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
