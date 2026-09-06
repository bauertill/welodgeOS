import { PrismaClient } from "../generated/prisma";

const db = new PrismaClient();

/**
 * Seeds the amenity vocabulary (which the app depends on) and a small, honest
 * scouting example: one event with a venue, three properties around it.
 *
 * Run with `--amenities-only` (`pnpm run db:seed:amenities`) to write just the
 * vocabulary and stop. That is the only form safe against a live database; the
 * default run deletes and rebuilds every event, property and client it finds.
 */

const AMENITIES = [
  "WiFi",
  "Breakfast included",
  "Parking",
  "Air conditioning",
  "Gym",
  "Pool",
  "Kitchen",
  "Washing machine",
  "Lift",
  "Accessible",
  "Pets allowed",
  "24h reception",
  "Airport shuttle",
  "Restaurant",
  "Meeting rooms",
  "Laundry service",
];

const key = (label: string) => label.toLowerCase().replace(/[^a-z0-9]+/g, "-");

async function main() {
  // The amenity list is a controlled vocabulary, so it is upserted rather than
  // wiped — properties point at these rows.
  const amenities = await Promise.all(
    AMENITIES.map((label, sortOrder) =>
      db.amenity.upsert({
        where: { key: key(label) },
        update: { label, sortOrder },
        create: { key: key(label), label, sortOrder },
      }),
    ),
  );

  // A live database needs the vocabulary above and nothing else. Without the
  // amenity rows no property can be tagged and the scouting filters have
  // nothing to filter by, but the demo data below would be an invention sitting
  // among real suppliers. `--amenities-only` is the safe half, and it is the
  // only part of this file that may ever be pointed at production.
  if (process.argv.includes("--amenities-only")) {
    console.log(`Seeded ${amenities.length} amenities. No demo data written.`);
    return;
  }

  const byKey = (label: string) => {
    const amenity = amenities.find((a) => a.key === key(label));
    if (!amenity) throw new Error(`Unknown amenity: ${label}`);
    return { id: amenity.id };
  };

  // Demo data below. Idempotent: cleared and rebuilt on every run. Phase 2
  // rows go first — a client cannot be deleted while a room-night points at it.
  await db.ledgerEntry.deleteMany();
  await db.roomNightRequest.deleteMany();
  await db.roomNight.deleteMany();
  await db.roomSlot.deleteMany();
  await db.scoutingEntry.deleteMany();
  await db.property.deleteMany();
  await db.event.deleteMany();
  await db.client.deleteMany();

  const event = await db.event.create({
    data: {
      name: "LA28 Olympic Games",
      city: "Los Angeles",
      country: "United States",
      startDate: new Date("2028-07-10T00:00:00Z"),
      endDate: new Date("2028-08-05T00:00:00Z"),
      status: "PLANNING",
      venueName: "SoFi Stadium",
      venueLatitude: 33.9535,
      venueLongitude: -118.3392,
    },
  });

  const carmel = await db.property.create({
    data: {
      name: "Hotel Carmel",
      type: "HOTEL",
      address: "201 Broadway",
      city: "Santa Monica",
      country: "United States",
      latitude: 34.0154,
      longitude: -118.4954,
      stars: 3,
      phone: "+1 310 555 0142",
      notes:
        "Walkable to the pier. Manager is open to a full buy-out for the Games fortnight.",
      amenities: {
        connect: [
          byKey("WiFi"),
          byKey("Breakfast included"),
          byKey("24h reception"),
          byKey("Lift"),
        ],
      },
      categories: {
        create: [
          {
            name: "King Room",
            unitCount: 60,
            capacity: 2,
            bedConfiguration: "1 King",
            indicativePriceCents: 32_000,
            currency: "USD",
            sortOrder: 0,
          },
          {
            name: "Twin Room",
            unitCount: 42,
            capacity: 2,
            bedConfiguration: "2 Twin",
            indicativePriceCents: 30_500,
            currency: "USD",
            sortOrder: 1,
          },
        ],
      },
      contacts: {
        create: [
          {
            name: "Dana Reyes",
            role: "Director of Sales",
            email: "dana.reyes@example.com",
          },
        ],
      },
    },
  });

  const courtyard = await db.property.create({
    data: {
      name: "Courtyard Culver City",
      type: "HOTEL",
      city: "Culver City",
      country: "United States",
      latitude: 34.0219,
      longitude: -118.3965,
      stars: 4,
      amenities: {
        connect: [
          byKey("WiFi"),
          byKey("Parking"),
          byKey("Gym"),
          byKey("Pool"),
          byKey("Air conditioning"),
          byKey("Restaurant"),
        ],
      },
      categories: {
        create: [
          {
            name: "King Room",
            unitCount: 120,
            capacity: 2,
            bedConfiguration: "1 King",
            indicativePriceCents: 41_000,
            currency: "USD",
            sortOrder: 0,
          },
        ],
      },
    },
  });

  const marinaFlats = await db.property.create({
    data: {
      name: "Marina Del Rey Residences",
      type: "APARTMENT",
      city: "Marina del Rey",
      country: "United States",
      latitude: 33.9802,
      longitude: -118.4517,
      amenities: {
        connect: [
          byKey("WiFi"),
          byKey("Kitchen"),
          byKey("Washing machine"),
          byKey("Parking"),
          byKey("Accessible"),
        ],
      },
      categories: {
        create: [
          {
            name: "1 Bedroom",
            unitCount: 24,
            capacity: 2,
            bedrooms: 1,
            bathrooms: 1,
            indicativePriceCents: 38_000,
            currency: "USD",
            sortOrder: 0,
          },
          {
            name: "2 Bedroom",
            unitCount: 16,
            capacity: 4,
            bedrooms: 2,
            bathrooms: 1.5,
            indicativePriceCents: 56_000,
            currency: "USD",
            sortOrder: 1,
          },
        ],
      },
    },
  });

  await db.scoutingEntry.createMany({
    data: [
      // Contracted, so Phase 2 can turn it into inventory (doc §3.6).
      { eventId: event.id, propertyId: carmel.id, status: "CONTRACTED" },
      { eventId: event.id, propertyId: courtyard.id, status: "CONTACTED" },
      { eventId: event.id, propertyId: marinaFlats.id, status: "PROSPECT" },
    ],
  });

  // -------------------------------------------------------------------------
  // Phase 2 — a small, honest commercial position at Hotel Carmel.
  //
  // The point of the demo is that the four situations a rep actually worries
  // about are all visible at once: bought and sold, sold against an option that
  // is running out, bought with nobody on it, and blocked with nothing secured.
  // -------------------------------------------------------------------------

  const cnosf = await db.client.create({
    data: {
      name: "Comité National Olympique et Sportif Français",
      shortName: "CNOSF",
      notes: "Federation. Books early, pays on time, moves teams around a lot.",
    },
  });

  const obs = await db.client.create({
    data: {
      name: "Olympic Broadcasting Services",
      shortName: "OBS",
      notes: "Broadcaster. Long stays, crews arriving in waves.",
    },
  });

  const kingRoom = await db.roomCategory.findFirstOrThrow({
    where: { propertyId: carmel.id, name: "King Room" },
  });

  const stayFrom = new Date("2028-07-10T00:00:00Z");
  const stayTo = new Date("2028-07-31T00:00:00Z"); // 21 nights; check-out is not a night.
  const nights: Date[] = [];
  for (
    let day = stayFrom.getTime();
    day < stayTo.getTime();
    day += 86_400_000
  ) {
    nights.push(new Date(day));
  }

  // Deadlines are relative to today, so the deadline dashboard has something to
  // say whenever the demo is rebuilt.
  const inDays = (days: number) => {
    const now = new Date();
    return new Date(
      Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), now.getUTCDate() + days),
    );
  };

  const slots = await Promise.all(
    Array.from({ length: 30 }, (_, i) => i + 1).map((slotNumber) =>
      db.roomSlot.create({
        data: { categoryId: kingRoom.id, slotNumber },
      }),
    ),
  );

  const slotIds = (from: number, to: number) =>
    slots.filter((s) => s.slotNumber >= from && s.slotNumber <= to).map((s) => s.id);

  await db.roomNight.createMany({
    data: slots.flatMap((slot) =>
      nights.map((date) => ({ slotId: slot.id, eventId: event.id, date })),
    ),
  });

  const setNights = (from: number, to: number, data: object) =>
    db.roomNight.updateMany({
      where: { eventId: event.id, slotId: { in: slotIds(from, to) } },
      data,
    });

  // #1–#10: bought and sold. The position everyone wants.
  await setNights(1, 10, {
    acquisitionState: "BOUGHT",
    supplierRef: "CARMEL-2028-A",
    buyPriceCents: 29_000,
    buyCurrency: "USD",
    salesState: "SOLD",
    clientId: cnosf.id,
    clientRef: "CNOSF-LA28-001",
    sellPriceCents: 42_000,
    sellCurrency: "USD",
    dueDate: inDays(21),
  });

  // #11–#18: sold to the client, but we only hold an option — and it runs out
  // this week. This is the row that should be shouting.
  await setNights(11, 18, {
    acquisitionState: "OPTION",
    supplierRef: "CARMEL-2028-B",
    optionExpiry: inDays(3),
    buyPriceCents: 31_000,
    buyCurrency: "USD",
    salesState: "SOLD",
    clientId: cnosf.id,
    clientRef: "CNOSF-LA28-002",
    sellPriceCents: 44_000,
    sellCurrency: "USD",
  });

  // #19–#24: bought, nobody on it. Long — money sitting on the book.
  await setNights(19, 24, {
    acquisitionState: "BOUGHT",
    supplierRef: "CARMEL-2028-A",
    buyPriceCents: 29_000,
    buyCurrency: "USD",
  });

  // #25–#30: a client is holding rooms we have not started to acquire.
  await setNights(25, 30, {
    salesState: "BLOCKED",
    clientId: obs.id,
    blockExpiry: inDays(9),
    sellPriceCents: 46_000,
    sellCurrency: "USD",
  });

  // Soft requests: a second client wants the rooms CNOSF already holds. Nothing
  // is locked by this — it is the contention that drives the acquisition push.
  const contested = await db.roomNight.findMany({
    where: { eventId: event.id, slotId: { in: slotIds(1, 10) } },
    select: { id: true },
  });
  await db.roomNightRequest.createMany({
    data: contested.map((night) => ({
      roomNightId: night.id,
      clientId: obs.id,
      sellPriceCents: 45_000,
      sellCurrency: "USD",
      notes: "Would take the whole block if CNOSF releases.",
    })),
  });

  await db.ledgerEntry.create({
    data: {
      eventId: event.id,
      axis: "INVENTORY",
      toState: "Nothing started",
      nightCount: slots.length * nights.length,
      summary: `Brought Hotel Carmel King Room #1–#30 into inventory for 10 Jul – 31 Jul 2028 (${slots.length * nights.length} room-nights, nothing contracted).`,
      reason: "Seeded demo data.",
    },
  });

  console.log(
    `Seeded ${amenities.length} amenities, 1 event, 3 scouted properties, 2 clients and ${slots.length * nights.length} room-nights.`,
  );
}

main()
  .catch((error) => {
    console.error(error);
    process.exit(1);
  })
  .finally(() => db.$disconnect());
