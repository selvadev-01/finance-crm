-- Books slice 2 (ADR-0018): expenses, bank transfers, owner drawings and
-- other income, the source rows of their ledger postings.

-- CreateEnum
CREATE TYPE "ExpensePaidFrom" AS ENUM ('OFFICE_CASH', 'BANK', 'CASH_IN_HAND');

-- CreateEnum
CREATE TYPE "ExpenseStatus" AS ENUM ('PENDING', 'APPROVED', 'REJECTED');

-- CreateTable
CREATE TABLE "expense" (
    "id" TEXT NOT NULL,
    "organizationId" TEXT NOT NULL,
    "expenseCategoryId" TEXT NOT NULL,
    "amount" DECIMAL(14,2) NOT NULL,
    "businessDate" DATE NOT NULL,
    "note" TEXT NOT NULL,
    "paidFrom" "ExpensePaidFrom" NOT NULL,
    "bankAccountId" TEXT,
    "spenderUserId" TEXT,
    "lineId" TEXT,
    "status" "ExpenseStatus" NOT NULL,
    "decidedByUserId" TEXT,
    "decidedAt" TIMESTAMPTZ(3),
    "decisionNote" TEXT,
    "createdAt" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMPTZ(3) NOT NULL,
    "createdByUserId" TEXT NOT NULL,

    CONSTRAINT "expense_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "bank_transfer" (
    "id" TEXT NOT NULL,
    "organizationId" TEXT NOT NULL,
    "amount" DECIMAL(14,2) NOT NULL,
    "businessDate" DATE NOT NULL,
    "note" TEXT NOT NULL,
    "fromBankAccountId" TEXT,
    "toBankAccountId" TEXT,
    "createdAt" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "createdByUserId" TEXT NOT NULL,

    CONSTRAINT "bank_transfer_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "drawing_entry" (
    "id" TEXT NOT NULL,
    "organizationId" TEXT NOT NULL,
    "amount" DECIMAL(14,2) NOT NULL,
    "businessDate" DATE NOT NULL,
    "note" TEXT NOT NULL,
    "bankAccountId" TEXT,
    "createdAt" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "createdByUserId" TEXT NOT NULL,

    CONSTRAINT "drawing_entry_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "income_entry" (
    "id" TEXT NOT NULL,
    "organizationId" TEXT NOT NULL,
    "amount" DECIMAL(14,2) NOT NULL,
    "businessDate" DATE NOT NULL,
    "note" TEXT NOT NULL,
    "bankAccountId" TEXT,
    "createdAt" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "createdByUserId" TEXT NOT NULL,

    CONSTRAINT "income_entry_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "expense_organizationId_businessDate_idx" ON "expense"("organizationId", "businessDate");

-- CreateIndex
CREATE INDEX "expense_expenseCategoryId_idx" ON "expense"("expenseCategoryId");

-- CreateIndex
CREATE INDEX "expense_bankAccountId_idx" ON "expense"("bankAccountId");

-- CreateIndex
CREATE INDEX "expense_lineId_businessDate_idx" ON "expense"("lineId", "businessDate");

-- CreateIndex
CREATE INDEX "expense_spenderUserId_businessDate_idx" ON "expense"("spenderUserId", "businessDate");

-- CreateIndex
CREATE INDEX "bank_transfer_organizationId_businessDate_idx" ON "bank_transfer"("organizationId", "businessDate");

-- CreateIndex
CREATE INDEX "bank_transfer_fromBankAccountId_idx" ON "bank_transfer"("fromBankAccountId");

-- CreateIndex
CREATE INDEX "bank_transfer_toBankAccountId_idx" ON "bank_transfer"("toBankAccountId");

-- CreateIndex
CREATE INDEX "drawing_entry_organizationId_businessDate_idx" ON "drawing_entry"("organizationId", "businessDate");

-- CreateIndex
CREATE INDEX "drawing_entry_bankAccountId_idx" ON "drawing_entry"("bankAccountId");

-- CreateIndex
CREATE INDEX "income_entry_organizationId_businessDate_idx" ON "income_entry"("organizationId", "businessDate");

-- CreateIndex
CREATE INDEX "income_entry_bankAccountId_idx" ON "income_entry"("bankAccountId");

-- AddForeignKey
ALTER TABLE "expense" ADD CONSTRAINT "expense_organizationId_fkey" FOREIGN KEY ("organizationId") REFERENCES "organization"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "expense" ADD CONSTRAINT "expense_expenseCategoryId_fkey" FOREIGN KEY ("expenseCategoryId") REFERENCES "expense_category"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "expense" ADD CONSTRAINT "expense_bankAccountId_fkey" FOREIGN KEY ("bankAccountId") REFERENCES "bank_account"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "expense" ADD CONSTRAINT "expense_lineId_fkey" FOREIGN KEY ("lineId") REFERENCES "line"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "bank_transfer" ADD CONSTRAINT "bank_transfer_organizationId_fkey" FOREIGN KEY ("organizationId") REFERENCES "organization"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "bank_transfer" ADD CONSTRAINT "bank_transfer_fromBankAccountId_fkey" FOREIGN KEY ("fromBankAccountId") REFERENCES "bank_account"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "bank_transfer" ADD CONSTRAINT "bank_transfer_toBankAccountId_fkey" FOREIGN KEY ("toBankAccountId") REFERENCES "bank_account"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "drawing_entry" ADD CONSTRAINT "drawing_entry_organizationId_fkey" FOREIGN KEY ("organizationId") REFERENCES "organization"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "drawing_entry" ADD CONSTRAINT "drawing_entry_bankAccountId_fkey" FOREIGN KEY ("bankAccountId") REFERENCES "bank_account"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "income_entry" ADD CONSTRAINT "income_entry_organizationId_fkey" FOREIGN KEY ("organizationId") REFERENCES "organization"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "income_entry" ADD CONSTRAINT "income_entry_bankAccountId_fkey" FOREIGN KEY ("bankAccountId") REFERENCES "bank_account"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

