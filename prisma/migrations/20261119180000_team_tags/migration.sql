-- CreateTable
CREATE TABLE "TeamTag" (
    "id" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "TeamTag_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "_TeamTagMembers" (
    "A" TEXT NOT NULL,
    "B" TEXT NOT NULL,

    CONSTRAINT "_TeamTagMembers_AB_pkey" PRIMARY KEY ("A","B")
);

-- CreateIndex
CREATE UNIQUE INDEX "TeamTag_name_key" ON "TeamTag"("name");

-- CreateIndex
CREATE INDEX "_TeamTagMembers_B_index" ON "_TeamTagMembers"("B");

-- AddForeignKey
ALTER TABLE "_TeamTagMembers" ADD CONSTRAINT "_TeamTagMembers_A_fkey" FOREIGN KEY ("A") REFERENCES "TeamTag"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "_TeamTagMembers" ADD CONSTRAINT "_TeamTagMembers_B_fkey" FOREIGN KEY ("B") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE;

