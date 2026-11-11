-- Named periods of an event, like LA28's Olympics, Between Games and Paralympics (doc §3.10).
CREATE TABLE "EventPeriod" (
    "id" TEXT NOT NULL,
    "eventId" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "startDate" DATE NOT NULL,
    "endDate" DATE NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "EventPeriod_pkey" PRIMARY KEY ("id")
);

CREATE INDEX "EventPeriod_eventId_idx" ON "EventPeriod"("eventId");

ALTER TABLE "EventPeriod" ADD CONSTRAINT "EventPeriod_eventId_fkey" FOREIGN KEY ("eventId") REFERENCES "Event"("id") ON DELETE CASCADE ON UPDATE CASCADE;
