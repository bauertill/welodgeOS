-- A room category on an event starts with no supplier status at all — blank,
-- not "In negotiation" (doc §3.5). NOT_STARTED is that blank. Postgres only
-- lets a new enum value be used once it is committed, so making it the
-- default is the next migration. Rows that already exist keep their status.

ALTER TYPE "CategoryContractStatus" ADD VALUE IF NOT EXISTS 'NOT_STARTED' BEFORE 'IN_NEGOTIATION';
