-- Books (ADR-0017): expense categories and bank accounts, and the ledger
-- accounts keyed to them.


-- DropIndex
DROP INDEX "ledger_account_organization_singleton_key";

-- AlterTable
ALTER TABLE "ledger_account" ADD COLUMN     "bankAccountId" TEXT,
ADD COLUMN     "expenseCategoryId" TEXT;

-- CreateTable
CREATE TABLE "expense_category" (
    "id" TEXT NOT NULL,
    "organizationId" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "isActive" BOOLEAN NOT NULL DEFAULT true,
    "createdAt" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMPTZ(3) NOT NULL,
    "createdByUserId" TEXT,

    CONSTRAINT "expense_category_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "bank_account" (
    "id" TEXT NOT NULL,
    "organizationId" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "last4" TEXT,
    "isActive" BOOLEAN NOT NULL DEFAULT true,
    "createdAt" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMPTZ(3) NOT NULL,
    "createdByUserId" TEXT,

    CONSTRAINT "bank_account_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "expense_category_organizationId_idx" ON "expense_category"("organizationId");

-- CreateIndex
CREATE INDEX "bank_account_organizationId_idx" ON "bank_account"("organizationId");

-- CreateIndex
CREATE INDEX "ledger_account_expenseCategoryId_idx" ON "ledger_account"("expenseCategoryId");

-- CreateIndex
CREATE INDEX "ledger_account_bankAccountId_idx" ON "ledger_account"("bankAccountId");

-- CreateIndex
CREATE UNIQUE INDEX "ledger_account_organization_singleton_key" ON "ledger_account"("organizationId", "accountType") WHERE ("accountType" = ANY (ARRAY['CASH_AT_OFFICE'::"LedgerAccountType", 'CAPITAL'::"LedgerAccountType", 'UNEARNED_PROFIT'::"LedgerAccountType", 'EARNED_PROFIT'::"LedgerAccountType", 'WRITE_OFF_LOSS'::"LedgerAccountType", 'OTHER_INCOME'::"LedgerAccountType", 'OWNER_DRAWINGS'::"LedgerAccountType"]));

-- CreateIndex
CREATE UNIQUE INDEX "ledger_account_expense_category_key" ON "ledger_account"("expenseCategoryId") WHERE ("accountType" = 'EXPENSE'::"LedgerAccountType");

-- CreateIndex
CREATE UNIQUE INDEX "ledger_account_bank_account_key" ON "ledger_account"("bankAccountId") WHERE ("accountType" = 'BANK'::"LedgerAccountType");

-- AddForeignKey
ALTER TABLE "ledger_account" ADD CONSTRAINT "ledger_account_expenseCategoryId_fkey" FOREIGN KEY ("expenseCategoryId") REFERENCES "expense_category"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ledger_account" ADD CONSTRAINT "ledger_account_bankAccountId_fkey" FOREIGN KEY ("bankAccountId") REFERENCES "bank_account"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "expense_category" ADD CONSTRAINT "expense_category_organizationId_fkey" FOREIGN KEY ("organizationId") REFERENCES "organization"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "bank_account" ADD CONSTRAINT "bank_account_organizationId_fkey" FOREIGN KEY ("organizationId") REFERENCES "organization"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

