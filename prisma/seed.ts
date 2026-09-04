import { PrismaClient } from "../generated/prisma";

const db = new PrismaClient();

/**
 * Seeds the amenity vocabulary (which the app depends on) and a small, honest
 * scouting example: one event with a venue, three properties around it.
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

  const byKey = (label: string) => {
    const amenity = amenities.find((a) => a.key === key(label));
    if (!amenity) throw new Error(`Unknown amenity: ${label}`);
    return { id: amenity.id };
  };

  // Demo data below. Idempotent: cleared and rebuilt on every run.
  await db.scoutingEntry.deleteMany();
  await db.property.deleteMany();
  await db.event.deleteMany();

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
      { eventId: event.id, propertyId: carmel.id, status: "SHORTLISTED" },
      { eventId: event.id, propertyId: courtyard.id, status: "CONTACTED" },
      { eventId: event.id, propertyId: marinaFlats.id, status: "PROSPECT" },
    ],
  });

  console.log(
    `Seeded ${amenities.length} amenities, 1 event and 3 scouted properties.`,
  );
}

main()
  .catch((error) => {
    console.error(error);
    process.exit(1);
  })
  .finally(() => db.$disconnect());
