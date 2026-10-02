-- US-032: the source row of a CAPITAL ledger transaction (M08, M09).

-- CreateTable
CREATE TABLE "capital_entry" (
    "id" TEXT NOT NULL,
    "organizationId" TEXT NOT NULL,
    "amount" DECIMAL(14,2) NOT NULL,
    "businessDate" DATE NOT NULL,
    "note" TEXT NOT NULL,
    "createdAt" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "createdByUserId" TEXT NOT NULL,

    CONSTRAINT "capital_entry_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "capital_entry_organizationId_businessDate_idx" ON "capital_entry"("organizationId", "businessDate");

-- AddForeignKey
ALTER TABLE "capital_entry" ADD CONSTRAINT "capital_entry_organizationId_fkey" FOREIGN KEY ("organizationId") REFERENCES "organization"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
