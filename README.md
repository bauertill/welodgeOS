# We Lodge OS

Booking and accommodation management for **We Lodge AG**, built on the
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
- **Email magic link** — for partners outside the Workspace tenant. Set
  `EMAIL_SERVER` (e.g. `smtp://user:pass@smtp.host.com:587`) and `EMAIL_FROM`.
  Links are single-use and expire after 15 minutes.

**In development without SMTP**, the magic link is printed to the server console
instead of being mailed — look for `[auth] Magic link for …` in the terminal and
open the URL on the next line. No mail setup needed to work locally.

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

`prisma/schema.prisma` covers the booking domain:

- **Event** — a championship, congress or tour we accommodate
- **Property** → **Room** — hotels and apartment blocks, with nightly rates and
  allotments per room type
- **Client** — the federation, broadcaster or sponsor we bill
- **Guest** — the person staying
- **Booking** — the core record tying guest, client, event, property and room to
  a date range and a status (`INQUIRY → OPTIONED → CONFIRMED → CHECKED_IN →
  CHECKED_OUT`, or `CANCELLED`)

Money is stored in minor units (`rateCents`) to avoid floating-point drift.

## Structure

```
src/
  app/
    _components/   app shell, nav, shared UI primitives
    bookings/  events/  properties/  guests/
  lib/format.ts    date, night-count and currency formatting (en-CH)
  server/api/routers/   booking, event, property, guest tRPC routers
```

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

The shell is read-only. Still to come: creating and editing bookings, allotment
availability checks, an arrivals/departures calendar, rooming lists and exports.
