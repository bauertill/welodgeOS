-- A chat message can now be edited by its author (doc §2.7). The edit time is
-- recorded on the message, and every earlier wording is kept in its own
-- table, so nothing that was said is lost. Purely additive.

-- AlterTable
ALTER TABLE "Message" ADD COLUMN     "editedAt" TIMESTAMP(3);

-- CreateTable
CREATE TABLE "MessageRevision" (
    "id" TEXT NOT NULL,
    "body" TEXT NOT NULL,
    "replacedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "messageId" TEXT NOT NULL,

    CONSTRAINT "MessageRevision_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "MessageRevision_messageId_idx" ON "MessageRevision"("messageId");

-- AddForeignKey
ALTER TABLE "MessageRevision" ADD CONSTRAINT "MessageRevision_messageId_fkey" FOREIGN KEY ("messageId") REFERENCES "Message"("id") ON DELETE CASCADE ON UPDATE CASCADE;
