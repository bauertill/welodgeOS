# We Lodge OS

Accommodation inventory management for **We Lodge AG**, built on the
[T3 Stack](https://create.t3.gg/): Next.js App Router, TypeScript, Tailwind CSS
v4, tRPC, Prisma and NextAuth.

## Getting started

```bash
npm install
./start-database.sh   # local Postgres in Docker
npm run db:push       # create the schema
npm run db:seed       # load demo events, properties, guests and bookings
npm run dev
```

The app runs on <http://localhost:3000> (Next.js falls back to 3001 if the port
is taken).

### Signing in

Two methods, both at `/signin`:

- **Google** — for We Lodge staff on Google Workspace. Set `AUTH_GOOGLE_ID` and
  `AUTH_GOOGLE_SECRET`; the button only appears when both are present. Create
  the credentials in the [Google Cloud console](https://console.cloud.google.com/apis/credentials)
  with redirect URI `http://localhost:3000/api/auth/callback/google`.
- **Email magic link** — for partners outside the Workspace tenant. Delivered
  through [Resend](https://resend.com): set `AUTH_RESEND_KEY` and `EMAIL_FROM`.
  Links are single-use and expire after 15 minutes.

  `EMAIL_FROM` must sit on a domain verified in Resend. Use
  `onboarding@resend.dev` to test before `welodge.net` is verified — note that
  it only delivers to the address that owns the Resend account.

  The email itself is branded in `src/server/auth/magic-link-email.ts`.

**In development without a Resend key**, the magic link is printed to the server
console instead of being mailed — look for `[auth] Magic link for …` in the
terminal and open the URL on the next line. No mail setup needed to work
locally.

Sessions are database-backed via the Prisma adapter. Sign-in, check-email and
sign-out screens are all branded (`src/app/signin/`, `src/app/signout/`).

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
| `npm run dev` | Dev server (Turbopack) |
| `npm run build` | Production build |
| `npm run typecheck` | `tsc --noEmit` |
| `npm run db:push` | Push the schema without a migration |
| `npm run db:seed` | Reset and reseed the demo data |
| `npm run db:studio` | Prisma Studio |

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
