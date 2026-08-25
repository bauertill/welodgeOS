import { PrismaClient } from "../generated/prisma";

const db = new PrismaClient();

/** Days from a fixed anchor, so the seed is reproducible run to run. */
const anchor = new Date("2026-09-01T00:00:00Z");
const day = (offset: number) =>
  new Date(anchor.getTime() + offset * 86_400_000);

async function main() {
  // Idempotent: wipe the demo domain, leave auth tables alone.
  await db.booking.deleteMany();
  await db.room.deleteMany();
  await db.property.deleteMany();
  await db.event.deleteMany();
  await db.guest.deleteMany();
  await db.client.deleteMany();

  const worlds = await db.event.create({
    data: {
      name: "World Championships 2026",
      city: "Zurich",
      country: "Switzerland",
      startDate: day(0),
      endDate: day(12),
      status: "ACTIVE",
    },
  });

  const congress = await db.event.create({
    data: {
      name: "European Congress 2027",
      city: "Vienna",
      country: "Austria",
      startDate: day(210),
      endDate: day(215),
      status: "PLANNING",
    },
  });

  const marriott = await db.property.create({
    data: {
      name: "Marriott Zurich",
      city: "Zurich",
      country: "Switzerland",
      stars: 5,
      roomCount: 120,
      eventId: worlds.id,
      rooms: {
        create: [
          { name: "Standard Double", capacity: 2, rateCents: 32000, allotment: 40 },
          { name: "Executive Suite", capacity: 2, rateCents: 58000, allotment: 10 },
        ],
      },
    },
    include: { rooms: true },
  });

  const parkInn = await db.property.create({
    data: {
      name: "Park Inn Oerlikon",
      city: "Zurich",
      country: "Switzerland",
      stars: 4,
      roomCount: 80,
      eventId: worlds.id,
      rooms: {
        create: [
          { name: "Twin Room", capacity: 2, rateCents: 21000, allotment: 55 },
          { name: "Single Room", capacity: 1, rateCents: 17500, allotment: 25 },
        ],
      },
    },
    include: { rooms: true },
  });

  await db.property.create({
    data: {
      name: "Hotel Sacher Vienna",
      city: "Vienna",
      country: "Austria",
      stars: 5,
      roomCount: 60,
      eventId: congress.id,
      rooms: {
        create: [
          { name: "Deluxe Double", capacity: 2, rateCents: 42000, currency: "EUR", allotment: 30 },
        ],
      },
    },
  });

  const federation = await db.client.create({
    data: {
      name: "International Federation",
      contactName: "Marta Keller",
      contactEmail: "m.keller@federation.example",
    },
  });

  const broadcaster = await db.client.create({
    data: {
      name: "Global Sports Media",
      contactName: "Tom Rossi",
      contactEmail: "t.rossi@gsm.example",
    },
  });

  const guestSeeds = [
    ["Anna", "Berger", "a.berger@federation.example"],
    ["Luca", "Moretti", "l.moretti@gsm.example"],
    ["Sophie", "Dubois", "s.dubois@federation.example"],
    ["Jonas", "Weber", "j.weber@gsm.example"],
    ["Elena", "Petrova", "e.petrova@federation.example"],
    ["Marc", "Lambert", "m.lambert@gsm.example"],
  ] as const;

  const guests = await Promise.all(
    guestSeeds.map(([firstName, lastName, email]) =>
      db.guest.create({ data: { firstName, lastName, email } }),
    ),
  );

  const bookingSeeds = [
    { guest: 0, client: federation.id, room: marriott.rooms[0]!, property: marriott.id, status: "CONFIRMED", from: -1, to: 13 },
    { guest: 1, client: broadcaster.id, room: parkInn.rooms[0]!, property: parkInn.id, status: "CHECKED_IN", from: -3, to: 12 },
    { guest: 2, client: federation.id, room: marriott.rooms[1]!, property: marriott.id, status: "CONFIRMED", from: 0, to: 12 },
    { guest: 3, client: broadcaster.id, room: parkInn.rooms[1]!, property: parkInn.id, status: "OPTIONED", from: 2, to: 9 },
    { guest: 4, client: federation.id, room: marriott.rooms[0]!, property: marriott.id, status: "INQUIRY", from: 1, to: 6 },
    { guest: 5, client: broadcaster.id, room: parkInn.rooms[0]!, property: parkInn.id, status: "CANCELLED", from: 3, to: 8 },
  ] as const;

  await Promise.all(
    bookingSeeds.map((seed, index) =>
      db.booking.create({
        data: {
          reference: `WL-2026-${String(index + 1).padStart(4, "0")}`,
          status: seed.status,
          checkIn: day(seed.from),
          checkOut: day(seed.to),
          guests: seed.room.capacity,
          guestId: guests[seed.guest]!.id,
          clientId: seed.client,
          eventId: worlds.id,
          propertyId: seed.property,
          roomId: seed.room.id,
        },
      }),
    ),
  );

  console.log("Seeded 2 events, 3 properties, 6 guests, 6 bookings.");
}

main()
  .catch((error) => {
    console.error(error);
    process.exit(1);
  })
  .finally(() => db.$disconnect());
