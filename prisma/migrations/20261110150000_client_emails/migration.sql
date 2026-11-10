-- CreateTable
CREATE TABLE "GmailConnection" (
    "id" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "email" TEXT NOT NULL,
    "refreshTokenEnc" TEXT NOT NULL,
    "connectedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "lastSyncedAt" TIMESTAMP(3),
    "coveredAddresses" TEXT[] DEFAULT ARRAY[]::TEXT[],
    "lastError" TEXT,

    CONSTRAINT "GmailConnection_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "ClientEmail" (
    "id" TEXT NOT NULL,
    "messageId" TEXT NOT NULL,
    "threadId" TEXT,
    "subject" TEXT,
    "fromName" TEXT,
    "fromEmail" TEXT NOT NULL,
    "to" TEXT[],
    "cc" TEXT[],
    "addresses" TEXT[],
    "sentAt" TIMESTAMP(3) NOT NULL,
    "snippet" TEXT,
    "bodyText" TEXT,
    "attachmentNames" TEXT[] DEFAULT ARRAY[]::TEXT[],
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "ClientEmail_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "EmailCopy" (
    "id" TEXT NOT NULL,
    "emailId" TEXT NOT NULL,
    "connectionId" TEXT NOT NULL,
    "gmailId" TEXT NOT NULL,

    CONSTRAINT "EmailCopy_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "GmailConnection_userId_key" ON "GmailConnection"("userId");

-- CreateIndex
CREATE UNIQUE INDEX "ClientEmail_messageId_key" ON "ClientEmail"("messageId");

-- CreateIndex
CREATE INDEX "ClientEmail_sentAt_idx" ON "ClientEmail"("sentAt");

-- CreateIndex
CREATE INDEX "ClientEmail_addresses_idx" ON "ClientEmail" USING GIN ("addresses");

-- CreateIndex
CREATE INDEX "EmailCopy_emailId_idx" ON "EmailCopy"("emailId");

-- CreateIndex
CREATE UNIQUE INDEX "EmailCopy_connectionId_gmailId_key" ON "EmailCopy"("connectionId", "gmailId");

-- AddForeignKey
ALTER TABLE "GmailConnection" ADD CONSTRAINT "GmailConnection_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "EmailCopy" ADD CONSTRAINT "EmailCopy_emailId_fkey" FOREIGN KEY ("emailId") REFERENCES "ClientEmail"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "EmailCopy" ADD CONSTRAINT "EmailCopy_connectionId_fkey" FOREIGN KEY ("connectionId") REFERENCES "GmailConnection"("id") ON DELETE CASCADE ON UPDATE CASCADE;

