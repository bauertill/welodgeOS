import { PrismaClient } from "../generated/prisma";

/**
 * Carries an event's venue across to a place of interest (doc §3.7).
 *
 * Events used to hold one venue in three columns of their own. They now hold
 * as many places of interest as they need, and those columns are gone —
 * applying the schema drops them, taking every live venue with it silently.
 *
 * Run in three steps, in this order, against the database being upgraded:
 *
 *   1. `pnpm exec tsx prisma/venues-to-places.ts read`   — before the schema
 *      is applied. Prints the venues as JSON and writes them to
 *      `prisma/venues-backup.json`.
 *   2. `pnpm exec prisma db push`                        — applies the schema.
 *      The three columns go; `PlaceOfInterest` arrives.
 *   3. `pnpm exec tsx prisma/venues-to-places.ts write`  — reads the file back
 *      and writes each venue in as a place of interest.
 *
 * Step 3 is safe to re-run: a venue already carried across is left alone.
 *
 * `DATABASE_URL` decides which database this touches, so point it at the one
 * you mean and check twice — there is no prompt.
 */

const db = new PrismaClient();
const BACKUP = new URL("./venues-backup.json", import.meta.url);

type Venue = {
  id: string;
  name: string | null;
  latitude: number | null;
  longitude: number | null;
};

async function read() {
  // Raw SQL, because by this point the schema no longer describes these
  // columns and the generated client cannot see them.
  let rows: Venue[];
  try {
    rows = await db.$queryRawUnsafe<Venue[]>(
      `select id, "venueName" as name, "venueLatitude" as latitude, "venueLongitude" as longitude
       from "Event"
       where "venueName" is not null or "venueLatitude" is not null`,
    );
  } catch (error) {
    // The columns are already gone, so this database has had the schema
    // applied. Either the venues were carried across or they were lost; this
    // step can no longer tell which, and cannot help either way.
    if (String(error).includes("venueName")) {
      console.log(
        "This database no longer has the venue columns, so the schema has already been applied here. Nothing to read.",
      );
      return;
    }
    throw error;
  }

  const { writeFileSync } = await import("node:fs");
  writeFileSync(BACKUP, JSON.stringify(rows, null, 2));

  console.log(JSON.stringify(rows, null, 2));
  console.log(
    `\n${rows.length} event(s) with a venue, saved to prisma/venues-backup.json.`,
  );
  const unlocatable = rows.filter(
    (row) => row.latitude === null || row.longitude === null,
  );
  if (unlocatable.length > 0) {
    console.log(
      `${unlocatable.length} of them have a name but no coordinates. A place of interest must be locatable, so those are listed here and skipped — enter them by hand with their coordinates:\n` +
        unlocatable.map((row) => `  - ${row.name ?? "(unnamed)"}`).join("\n"),
    );
  }
}

async function write() {
  const { readFileSync } = await import("node:fs");
  const rows = JSON.parse(readFileSync(BACKUP, "utf8")) as Venue[];

  let written = 0;
  let skipped = 0;

  for (const row of rows) {
    if (row.latitude === null || row.longitude === null) {
      skipped += 1;
      continue;
    }

    const name = row.name?.trim() ?? "Venue";

    // Re-running must not create a second copy, and must not trample a place
    // somebody has since edited by hand.
    const existing = await db.placeOfInterest.findFirst({
      where: { eventId: row.id, name },
    });
    if (existing) {
      skipped += 1;
      continue;
    }

    await db.placeOfInterest.create({
      data: {
        eventId: row.id,
        name,
        category: "VENUE",
        latitude: row.latitude,
        longitude: row.longitude,
      },
    });
    written += 1;
  }

  console.log(
    `${written} venue(s) written as places of interest; ${skipped} left alone (already there, or no coordinates).`,
  );
}

const mode = process.argv[2];

if (mode !== "read" && mode !== "write") {
  console.error(
    "Say which step: `read` (before applying the schema) or `write` (after).",
  );
  process.exit(1);
}

await (mode === "read" ? read() : write());
await db.$disconnect();
