-- Kanban cards keep the order the team puts them in (doc §2.8).
ALTER TABLE "Task" ADD COLUMN "boardOrder" INTEGER;
