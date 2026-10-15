-- Hotel contact tasks for a sales request are named for its client too (doc §4.11):
-- "Contact Hotel Amarano — LA28" becomes "Contact Hotel Amarano for Beyond Limits — LA28".
UPDATE "Task" AS t
SET "title" = 'Contact ' || p."name" || ' for ' || c."name" || ' — ' || e."name"
FROM "TaskType" AS tt, "Property" AS p, "SalesRequest" AS r, "Client" AS c, "Event" AS e
WHERE t."typeId" = tt."id" AND tt."name" = 'Hotel contact'
  AND t."propertyId" = p."id"
  AND t."salesRequestId" = r."id" AND r."clientId" = c."id"
  AND t."eventId" = e."id"
  AND t."title" = 'Contact ' || p."name" || ' — ' || e."name";
