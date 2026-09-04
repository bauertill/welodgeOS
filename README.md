# We Lodge OS

Accommodation inventory management for **We Lodge AG**, built on the
[T3 Stack](https://create.t3.gg/): Next.js App Router, TypeScript, Tailwind CSS
v4, tRPC, Prisma and NextAuth.

## Getting started

```bash
pnpm install
./start-database.sh    # local Postgres in Docker
pnpm run db:push       # create the schema
pnpm run db:seed       # load demo events, properties, guests and bookings
pnpm run dev
```

The app runs on <http://localhost:3000> (Next.js falls back to 3001 if the port
is taken).

### Signing in

Three routes, in the order you are likely to want them:

**Development sign-in.** The sign-in page shows a *Log in as till@welodge.net*
button whenever `NODE_ENV === "development"`. It creates that user, mints a
database session and sets the cookie — no password, no email. It is a real
authentication bypass, fenced two ways: `/api/dev-login` returns 404 outside
development, and the button is not rendered. Both are verified against a
production build.

**Google Workspace SSO.** Set `AUTH_GOOGLE_ID` and `AUTH_GOOGLE_SECRET`; the
provider is only mounted when both are present. Redirect URI for local work is
`http://localhost:3000/api/auth/callback/google`.

**Magic link via Resend.** Set `AUTH_RESEND_KEY` and an `EMAIL_FROM` on a
domain verified at [resend.com/domains](https://resend.com/domains). Verifying a
domain is what allows sending to *any* recipient — the shared
`onboarding@resend.dev` sender delivers only to the address that owns the Resend
account and returns 403 for everyone else.

With no Resend key, the magic-link form still works but **prints the link to the
server console instead of emailing it**. The sign-in page says so rather than
sending you to an inbox nothing was sent to.

> Deployed with neither Google nor Resend configured, the app has no sign-in
> providers at all and nobody can get in. Configure one before deploying.

## Corporate identity

The theme mirrors [welodge.net](https://welodge.net). Tokens live in
`src/styles/globals.css`:

| Token | Value | Use |
| --- | --- | --- |
| `brand-400` | `#AB6CE2` | Primary purple — buttons, active nav, links |
| `brand-700` | `#614FC9` | Logo indigo, secondary emphasis |
| `ink-700` | `#292929` | Sidebar and top bar |
| `ink-50` | `#F2F2F2` | Page canvas |
| `success` / `danger` | `#12B878` / `#DB4B68` | Status accents |

Type is **Poppins** (300–700), loaded via `next/font`. Buttons use the site's
fully rounded pill shape with light (300) weight. The logo lives at
`public/welodge-logo.png` and sits on a white card, as it does on the website.

## Data model

`prisma/schema.prisma` covers **Phase 1 (Scouting)** and stops there:

- **Event** — the championship, congress or tour we are housing. Everything hangs
  off it. Optionally carries a venue and its coordinates, which is what
  distance-to-venue is measured from.
- **Property** — a hotel or apartment building we could contract. Scouted once
  and reusable across events.
- **RoomCategory** — a room type at a hotel or a unit type in an apartment
  block, with how many there are, what it sleeps and an *indicative* nightly
  price. Hotels fill in the bed configuration; apartments fill in bedrooms and
  bathrooms.
- **Amenity** — a controlled vocabulary shared by both property types, so
  amenities stay a filter rather than free text.
- **ScoutingEntry** — one property on one event's list, with its status
  (`PROSPECT → CONTACTED → SHORTLISTED → REJECTED | CONTRACTED`). Status lives
  here, not on the property: a hotel can be shortlisted for one event and
  rejected for another.

Money is stored in minor units (`indicativePriceCents`) with an explicit
currency. Dates that describe a calendar day are `@db.Date`, not timestamps.

There are deliberately **no room slots, room-nights, acquisition or sales
states** yet — those are Phase 2, and they land with their section of the scope
document, not before it.

## Structure

```
docs/product-scope.md   the business logic — the source of truth
src/
  app/
    _components/   app shell, forms, scouting list and map
    events/        events and their scouting lists
    properties/    the property library, scouting form and detail
  lib/format.ts    date and currency formatting (en-CH)
  lib/scouting.ts  business vocabulary, distance and price helpers
  server/api/routers/   event, property, scouting, amenity
```

The map is Leaflet over OpenStreetMap tiles, loaded browser-side only. The
scouting list is the source of truth; the map renders whatever has coordinates.

## Scripts

| Command | Description |
| --- | --- |
| `pnpm run dev` | Dev server (Turbopack) |
| `pnpm run build` | Production build |
| `pnpm run typecheck` | `tsc --noEmit` |
| `pnpm run db:push` | Push the schema without a migration |
| `pnpm run db:seed` | Reset and reseed the demo data |
| `pnpm run db:studio` | Prisma Studio |

## Not yet built

Phase 1 (Scouting) is built. Phase 2 (Acquisition & Sales) and Phase 3
(Operations) are fully specified in `docs/product-scope.md` and not implemented
— see §12 of that document for the line-by-line status.

Known gaps inside Phase 1: importing coordinates from Google My Maps, and an
admin screen for the amenity list (it is seeded today).

## Keeping the document honest

`docs/product-scope.md` is the source of truth for business logic, and it must
never drift from the code. Any change to behaviour ships with its documentation
change in the same commit. See `CLAUDE.md`.
