# Working in this repo

## Who this is for

**The owner of this project is not a technical user.** He describes what the
business needs to do, not how to do it, and he will read the documentation
rather than the code. Every conversation happens at the semantic level:
"a client blocked ten rooms until Friday", not "add a nullable `blockExpiry`
column".

What follows from that:

- **Explain changes in business terms.** Say what now happens differently for a
  rep, a supplier or a client. Mention a file or a column only when it is the
  clearest way to make the point.
- **The documentation is the interface to this system.** It is how he checks
  what was built, disagrees with it, and decides what comes next. Treat it as a
  deliverable, not a byproduct.
- **Surface decisions, don't bury them.** When something is ambiguous, name the
  choice you made and what it rules out. Do not present a technical constraint
  as a business rule.
- **Never assume domain knowledge is obvious.** If a rule seems odd, ask. The
  Google Sheet this replaces is full of rules that look wrong and are not.

## Documentation and implementation move together

**`docs/product-scope.md` is the source of truth for business logic, and it must
never drift from the code.** This is a hard rule, not a preference.

Every change that touches behaviour ships with its documentation change **in the
same commit**:

| If you… | Then… |
| --- | --- |
| Add or change a rule, state, field or calculation | Update the matching section of `docs/product-scope.md` in the same commit |
| Implement something the document already specifies | Update its status in §12 so the document says what is actually built |
| Find the code and the document disagree | Stop. Decide which one is right, fix the other, and say so in the commit message |
| Deliberately depart from the document | Change the document too, with the reason — the document records the decision, not the intention |
| Answer a question the document leaves open (§9) | Move it out of the open questions and into the body |

A commit that changes behaviour and touches no documentation is a bug in the
process, even when the code is correct. Reviewing the diff is how a
non-technical owner exercises control over this system; a silent behaviour
change removes that control.

Where the document is not yet reality — a specified phase that is not built —
say so explicitly in §12 rather than letting the reader assume it works.

## The domain, in short

We Lodge buys accommodation from suppliers and sells it to B2B clients. The
commercial position is what matters: **short** means sold before it was bought,
**long** means bought and unsold. Three phases: **Scouting** (what could we
contract), **Acquisition & Sales** (what do we hold and what have we promised),
**Operations** (will the rooming lists actually work).

Vocabulary is load-bearing and defined in §10 of the scope document. *Bought*,
*Option* and *In progress* describe our relationship with the **supplier**;
*Sold*, *Blocked* and *Requested* describe our relationship with the **client**.
They are independent — a room-night has one of each. Use these words as the
business uses them and do not invent synonyms in code, in UI copy or in
conversation.

## Conventions

- **Language the user speaks.** UI copy and labels live in `src/lib/scouting.ts`
  and the components, in plain business English. No enum names on screen.
- **Money** is stored in minor units (`indicativePriceCents`) with an explicit
  currency. Never a float, never an implicit currency.
- **Dates** that describe a calendar day are `@db.Date`, not timestamps. A night
  is identified by the date it begins; check-out day is never a night.
- **Build only the phase that is documented.** Phase 2 and 3 models do not
  belong in the schema until their behaviour is agreed. An unused table implies
  a decision nobody made.

## Commands

| Command | What it does |
| --- | --- |
| `./start-database.sh` | Local Postgres in Docker |
| `npm run db:push` | Apply `prisma/schema.prisma` to the database |
| `npm run db:seed` | Reset demo data and load the amenity vocabulary |
| `npm run dev` | Development server on :3000 |
| `npm run typecheck` | `tsc --noEmit` |
| `npm run build` | Production build — run before claiming something works |

`npm run db:seed` deletes and rebuilds the demo event and properties. The
amenity list is upserted, never wiped, because properties point at those rows.
