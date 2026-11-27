-- CreateTable
CREATE TABLE "_SalesRequestCoOwners" (
    "A" TEXT NOT NULL,
    "B" TEXT NOT NULL,

    CONSTRAINT "_SalesRequestCoOwners_AB_pkey" PRIMARY KEY ("A","B")
);

-- CreateIndex
CREATE INDEX "_SalesRequestCoOwners_B_index" ON "_SalesRequestCoOwners"("B");

-- AddForeignKey
ALTER TABLE "_SalesRequestCoOwners" ADD CONSTRAINT "_SalesRequestCoOwners_A_fkey" FOREIGN KEY ("A") REFERENCES "SalesRequest"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "_SalesRequestCoOwners" ADD CONSTRAINT "_SalesRequestCoOwners_B_fkey" FOREIGN KEY ("B") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE;

