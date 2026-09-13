-- CreateEnum
CREATE TYPE "StaffRole" AS ENUM ('SUPER_ADMIN', 'ADMIN', 'SENIOR', 'JUNIOR');

-- CreateEnum
CREATE TYPE "StaffStatus" AS ENUM ('ACTIVE', 'SUSPENDED', 'INACTIVE');

-- CreateEnum
CREATE TYPE "AssignmentRole" AS ENUM ('SENIOR', 'JUNIOR');

-- CreateEnum
CREATE TYPE "CustomerStatus" AS ENUM ('ACTIVE', 'INACTIVE', 'BLACKLISTED');

-- CreateEnum
CREATE TYPE "AccountStatus" AS ENUM ('PENDING', 'ACTIVE', 'COMPLETED', 'DEFAULTED', 'WRITTEN_OFF');

-- CreateEnum
CREATE TYPE "ScheduleStatus" AS ENUM ('PENDING', 'COLLECTED', 'PARTIAL', 'MISSED', 'CANCELLED');

-- CreateEnum
CREATE TYPE "Classification" AS ENUM ('CORRECT', 'LOW', 'EXTRA', 'NO_PAYMENT');

-- CreateEnum
CREATE TYPE "EntryType" AS ENUM ('ORIGINAL', 'ADJUSTMENT');

-- CreateEnum
CREATE TYPE "CollectionStatus" AS ENUM ('PENDING_APPROVAL', 'CONFIRMED', 'REVERSED');

-- CreateEnum
CREATE TYPE "ApprovalDecision" AS ENUM ('PENDING', 'APPROVED', 'REJECTED');

-- CreateEnum
CREATE TYPE "DayCloseStatus" AS ENUM ('OPEN', 'CLOSED', 'REOPENED', 'TALLIED');

-- CreateEnum
CREATE TYPE "HandoverStatus" AS ENUM ('PENDING', 'ACKNOWLEDGED', 'DISPUTED');

-- CreateEnum
CREATE TYPE "LedgerAccountType" AS ENUM ('CASH_IN_HAND', 'CASH_AT_OFFICE', 'LOAN_RECEIVABLE', 'CAPITAL', 'UNEARNED_PROFIT', 'EARNED_PROFIT');

-- CreateEnum
CREATE TYPE "Direction" AS ENUM ('DEBIT', 'CREDIT');

-- CreateEnum
CREATE TYPE "LedgerTransactionType" AS ENUM ('DISBURSEMENT', 'COLLECTION', 'HANDOVER', 'ADJUSTMENT', 'WRITE_OFF');

-- CreateEnum
CREATE TYPE "NotificationCategory" AS ENUM ('INFORMATION', 'SUCCESS', 'WARNING', 'ALERT');

-- CreateEnum
CREATE TYPE "NotificationEvent" AS ENUM ('NEW_ASSIGNMENT', 'LOW_COLLECTION', 'EXTRA_COLLECTION', 'MISSED_COLLECTION', 'ACCOUNT_COMPLETED', 'DAY_CLOSE_DISCREPANCY', 'APPROVAL_REQUESTED');

-- CreateEnum
CREATE TYPE "PushProvider" AS ENUM ('WEB_PUSH', 'FCM');

-- CreateEnum
CREATE TYPE "OutboxStatus" AS ENUM ('PENDING', 'SENT', 'FAILED', 'EXPIRED');

-- CreateEnum
CREATE TYPE "AuditAction" AS ENUM ('CREATE', 'UPDATE', 'DELETE', 'APPROVE', 'REJECT', 'LOGIN', 'REOPEN_DAY');

-- CreateTable
CREATE TABLE "organization" (
    "id" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "timezone" TEXT NOT NULL,
    "currency" TEXT NOT NULL,
    "createdAt" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMPTZ(3) NOT NULL,

    CONSTRAINT "organization_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "staff_profile" (
    "id" TEXT NOT NULL,
    "organizationId" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "staffCode" TEXT NOT NULL,
    "role" "StaffRole" NOT NULL,
    "phone" TEXT NOT NULL,
    "status" "StaffStatus" NOT NULL DEFAULT 'ACTIVE',
    "joinedAt" DATE NOT NULL,
    "deletedAt" TIMESTAMPTZ(3),
    "createdAt" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMPTZ(3) NOT NULL,
    "createdByUserId" TEXT,

    CONSTRAINT "staff_profile_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "sector" (
    "id" TEXT NOT NULL,
    "organizationId" TEXT NOT NULL,
    "code" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "isActive" BOOLEAN NOT NULL DEFAULT true,
    "createdAt" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMPTZ(3) NOT NULL,
    "createdByUserId" TEXT,

    CONSTRAINT "sector_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "line" (
    "id" TEXT NOT NULL,
    "organizationId" TEXT NOT NULL,
    "sectorId" TEXT NOT NULL,
    "code" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "isActive" BOOLEAN NOT NULL DEFAULT true,
    "createdAt" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMPTZ(3) NOT NULL,
    "createdByUserId" TEXT,

    CONSTRAINT "line_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "line_assignment" (
    "id" TEXT NOT NULL,
    "lineId" TEXT NOT NULL,
    "staffProfileId" TEXT NOT NULL,
    "assignmentRole" "AssignmentRole" NOT NULL,
    "effectiveFrom" DATE NOT NULL,
    "effectiveTo" DATE,
    "reason" TEXT,
    "createdAt" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMPTZ(3) NOT NULL,
    "createdByUserId" TEXT,

    CONSTRAINT "line_assignment_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "customer" (
    "id" TEXT NOT NULL,
    "organizationId" TEXT NOT NULL,
    "customerCode" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "mobile" TEXT NOT NULL,
    "alternateMobile" TEXT,
    "address" TEXT NOT NULL,
    "sectorId" TEXT NOT NULL,
    "lineId" TEXT NOT NULL,
    "status" "CustomerStatus" NOT NULL DEFAULT 'ACTIVE',
    "notes" TEXT,
    "deletedAt" TIMESTAMPTZ(3),
    "createdAt" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMPTZ(3) NOT NULL,
    "createdByUserId" TEXT,

    CONSTRAINT "customer_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "customer_reference" (
    "id" TEXT NOT NULL,
    "customerId" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "mobile" TEXT NOT NULL,
    "relation" TEXT,
    "address" TEXT,
    "createdAt" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMPTZ(3) NOT NULL,
    "createdByUserId" TEXT,

    CONSTRAINT "customer_reference_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "account_loan" (
    "id" TEXT NOT NULL,
    "organizationId" TEXT NOT NULL,
    "accountCode" TEXT NOT NULL,
    "customerId" TEXT NOT NULL,
    "lineId" TEXT NOT NULL,
    "accountAmount" DECIMAL(14,2) NOT NULL,
    "investedAmount" DECIMAL(14,2) NOT NULL,
    "profitAmount" DECIMAL(14,2) NOT NULL,
    "dailyAmount" DECIMAL(14,2) NOT NULL,
    "termDays" INTEGER NOT NULL DEFAULT 100,
    "disbursementDate" DATE NOT NULL,
    "firstCollectionDate" DATE NOT NULL,
    "targetCompletionDate" DATE NOT NULL,
    "actualCompletionDate" DATE,
    "collectedAmount" DECIMAL(14,2) NOT NULL DEFAULT 0,
    "outstandingAmount" DECIMAL(14,2) NOT NULL,
    "status" "AccountStatus" NOT NULL DEFAULT 'PENDING',
    "isOverdue" BOOLEAN NOT NULL DEFAULT false,
    "closureNote" TEXT,
    "createdAt" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMPTZ(3) NOT NULL,
    "createdByUserId" TEXT,

    CONSTRAINT "account_loan_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "account_schedule" (
    "id" TEXT NOT NULL,
    "accountLoanId" TEXT NOT NULL,
    "sequence" INTEGER NOT NULL,
    "dueDate" DATE NOT NULL,
    "expectedAmount" DECIMAL(14,2) NOT NULL,
    "status" "ScheduleStatus" NOT NULL DEFAULT 'PENDING',
    "createdAt" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMPTZ(3) NOT NULL,
    "createdByUserId" TEXT,

    CONSTRAINT "account_schedule_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "collection" (
    "id" TEXT NOT NULL,
    "idempotencyKey" TEXT NOT NULL,
    "accountLoanId" TEXT NOT NULL,
    "accountScheduleId" TEXT,
    "lineId" TEXT NOT NULL,
    "collectedByUserId" TEXT NOT NULL,
    "businessDate" DATE NOT NULL,
    "capturedAt" TIMESTAMPTZ(3) NOT NULL,
    "syncedAt" TIMESTAMPTZ(3) NOT NULL,
    "expectedAmount" DECIMAL(14,2) NOT NULL,
    "amount" DECIMAL(14,2) NOT NULL,
    "variance" DECIMAL(14,2) NOT NULL,
    "classification" "Classification" NOT NULL,
    "entryType" "EntryType" NOT NULL DEFAULT 'ORIGINAL',
    "adjustsCollectionId" TEXT,
    "status" "CollectionStatus" NOT NULL DEFAULT 'CONFIRMED',
    "note" TEXT,
    "createdAt" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "createdByUserId" TEXT,

    CONSTRAINT "collection_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "collection_approval" (
    "id" TEXT NOT NULL,
    "collectionId" TEXT NOT NULL,
    "requestedByUserId" TEXT NOT NULL,
    "decidedByUserId" TEXT,
    "decision" "ApprovalDecision" NOT NULL DEFAULT 'PENDING',
    "reason" TEXT NOT NULL,
    "decisionNote" TEXT,
    "decidedAt" TIMESTAMPTZ(3),
    "createdAt" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMPTZ(3) NOT NULL,
    "createdByUserId" TEXT,

    CONSTRAINT "collection_approval_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "day_close" (
    "id" TEXT NOT NULL,
    "lineId" TEXT NOT NULL,
    "businessDate" DATE NOT NULL,
    "expectedTotal" DECIMAL(14,2) NOT NULL,
    "collectedTotal" DECIMAL(14,2) NOT NULL,
    "cashReceivedTotal" DECIMAL(14,2) NOT NULL,
    "discrepancy" DECIMAL(14,2) NOT NULL,
    "status" "DayCloseStatus" NOT NULL DEFAULT 'OPEN',
    "closedByUserId" TEXT,
    "closedAt" TIMESTAMPTZ(3),
    "reopenReason" TEXT,
    "createdAt" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMPTZ(3) NOT NULL,
    "createdByUserId" TEXT,

    CONSTRAINT "day_close_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "cash_handover" (
    "id" TEXT NOT NULL,
    "dayCloseId" TEXT NOT NULL,
    "fromUserId" TEXT NOT NULL,
    "toUserId" TEXT NOT NULL,
    "declaredAmount" DECIMAL(14,2) NOT NULL,
    "systemAmount" DECIMAL(14,2) NOT NULL,
    "discrepancy" DECIMAL(14,2) NOT NULL,
    "status" "HandoverStatus" NOT NULL DEFAULT 'PENDING',
    "acknowledgedAt" TIMESTAMPTZ(3),
    "disputeNote" TEXT,
    "createdAt" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMPTZ(3) NOT NULL,
    "createdByUserId" TEXT,

    CONSTRAINT "cash_handover_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "cash_denomination" (
    "id" TEXT NOT NULL,
    "cashHandoverId" TEXT NOT NULL,
    "denomination" INTEGER NOT NULL,
    "count" INTEGER NOT NULL,
    "subtotal" DECIMAL(14,2) NOT NULL,
    "createdAt" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMPTZ(3) NOT NULL,

    CONSTRAINT "cash_denomination_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "ledger_account" (
    "id" TEXT NOT NULL,
    "accountType" "LedgerAccountType" NOT NULL,
    "ownerUserId" TEXT,
    "accountLoanId" TEXT,
    "normalBalance" "Direction" NOT NULL,
    "balance" DECIMAL(14,2) NOT NULL DEFAULT 0,
    "createdAt" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "ledger_account_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "ledger_transaction" (
    "id" TEXT NOT NULL,
    "transactionType" "LedgerTransactionType" NOT NULL,
    "sourceTable" TEXT NOT NULL,
    "sourceId" TEXT NOT NULL,
    "businessDate" DATE NOT NULL,
    "eventAt" TIMESTAMPTZ(3) NOT NULL,
    "description" TEXT NOT NULL,
    "createdAt" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "createdByUserId" TEXT,

    CONSTRAINT "ledger_transaction_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "ledger_entry" (
    "id" TEXT NOT NULL,
    "ledgerTransactionId" TEXT NOT NULL,
    "ledgerAccountId" TEXT NOT NULL,
    "direction" "Direction" NOT NULL,
    "amount" DECIMAL(14,2) NOT NULL,
    "sequence" INTEGER NOT NULL,
    "createdAt" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "ledger_entry_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "notification" (
    "id" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "category" "NotificationCategory" NOT NULL,
    "eventType" "NotificationEvent" NOT NULL,
    "title" TEXT NOT NULL,
    "body" TEXT NOT NULL,
    "payload" JSONB,
    "readAt" TIMESTAMPTZ(3),
    "createdAt" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMPTZ(3) NOT NULL,

    CONSTRAINT "notification_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "push_subscription" (
    "id" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "provider" "PushProvider" NOT NULL,
    "endpoint" TEXT,
    "p256dh" TEXT,
    "auth" TEXT,
    "fcmToken" TEXT,
    "deviceLabel" TEXT,
    "lastSeenAt" TIMESTAMPTZ(3) NOT NULL,
    "isActive" BOOLEAN NOT NULL DEFAULT true,
    "createdAt" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMPTZ(3) NOT NULL,

    CONSTRAINT "push_subscription_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "notification_outbox" (
    "id" TEXT NOT NULL,
    "notificationId" TEXT NOT NULL,
    "pushSubscriptionId" TEXT NOT NULL,
    "status" "OutboxStatus" NOT NULL DEFAULT 'PENDING',
    "attempts" INTEGER NOT NULL DEFAULT 0,
    "lastError" TEXT,
    "nextAttemptAt" TIMESTAMPTZ(3),
    "sentAt" TIMESTAMPTZ(3),
    "createdAt" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMPTZ(3) NOT NULL,

    CONSTRAINT "notification_outbox_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "holiday" (
    "id" TEXT NOT NULL,
    "organizationId" TEXT NOT NULL,
    "date" DATE NOT NULL,
    "name" TEXT NOT NULL,
    "sectorId" TEXT,
    "createdAt" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMPTZ(3) NOT NULL,
    "createdByUserId" TEXT,

    CONSTRAINT "holiday_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "audit_log" (
    "id" TEXT NOT NULL,
    "actorUserId" TEXT,
    "entityTable" TEXT NOT NULL,
    "entityId" TEXT NOT NULL,
    "action" "AuditAction" NOT NULL,
    "before" JSONB,
    "after" JSONB,
    "ipAddress" TEXT,
    "userAgent" TEXT,
    "createdAt" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "audit_log_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "idempotency_key" (
    "key" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "endpoint" TEXT NOT NULL,
    "responseBody" JSONB NOT NULL,
    "responseStatus" INTEGER NOT NULL,
    "expiresAt" TIMESTAMPTZ(3) NOT NULL,
    "createdAt" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "idempotency_key_pkey" PRIMARY KEY ("key")
);

-- CreateTable
CREATE TABLE "setting" (
    "id" TEXT NOT NULL,
    "organizationId" TEXT NOT NULL,
    "key" TEXT NOT NULL,
    "value" JSONB NOT NULL,
    "description" TEXT NOT NULL,
    "createdAt" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMPTZ(3) NOT NULL,
    "createdByUserId" TEXT,

    CONSTRAINT "setting_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "staff_profile_userId_key" ON "staff_profile"("userId");

-- CreateIndex
CREATE UNIQUE INDEX "staff_profile_staffCode_key" ON "staff_profile"("staffCode");

-- CreateIndex
CREATE UNIQUE INDEX "staff_profile_phone_key" ON "staff_profile"("phone");

-- CreateIndex
CREATE INDEX "staff_profile_organizationId_idx" ON "staff_profile"("organizationId");

-- CreateIndex
CREATE INDEX "staff_profile_status_idx" ON "staff_profile"("status");

-- CreateIndex
CREATE UNIQUE INDEX "sector_code_key" ON "sector"("code");

-- CreateIndex
CREATE INDEX "sector_organizationId_idx" ON "sector"("organizationId");

-- CreateIndex
CREATE UNIQUE INDEX "line_code_key" ON "line"("code");

-- CreateIndex
CREATE INDEX "line_organizationId_idx" ON "line"("organizationId");

-- CreateIndex
CREATE INDEX "line_sectorId_idx" ON "line"("sectorId");

-- CreateIndex
CREATE INDEX "line_assignment_lineId_effectiveTo_idx" ON "line_assignment"("lineId", "effectiveTo");

-- CreateIndex
CREATE INDEX "line_assignment_staffProfileId_idx" ON "line_assignment"("staffProfileId");

-- CreateIndex
CREATE UNIQUE INDEX "customer_customerCode_key" ON "customer"("customerCode");

-- CreateIndex
CREATE INDEX "customer_organizationId_idx" ON "customer"("organizationId");

-- CreateIndex
CREATE INDEX "customer_sectorId_idx" ON "customer"("sectorId");

-- CreateIndex
CREATE INDEX "customer_lineId_idx" ON "customer"("lineId");

-- CreateIndex
CREATE INDEX "customer_mobile_idx" ON "customer"("mobile");

-- CreateIndex
CREATE INDEX "customer_reference_customerId_idx" ON "customer_reference"("customerId");

-- CreateIndex
CREATE UNIQUE INDEX "account_loan_accountCode_key" ON "account_loan"("accountCode");

-- CreateIndex
CREATE INDEX "account_loan_organizationId_idx" ON "account_loan"("organizationId");

-- CreateIndex
CREATE INDEX "account_loan_customerId_idx" ON "account_loan"("customerId");

-- CreateIndex
CREATE INDEX "account_loan_lineId_status_idx" ON "account_loan"("lineId", "status");

-- CreateIndex
CREATE INDEX "account_loan_status_targetCompletionDate_idx" ON "account_loan"("status", "targetCompletionDate");

-- CreateIndex
CREATE INDEX "account_schedule_dueDate_status_idx" ON "account_schedule"("dueDate", "status");

-- CreateIndex
CREATE UNIQUE INDEX "account_schedule_accountLoanId_sequence_key" ON "account_schedule"("accountLoanId", "sequence");

-- CreateIndex
CREATE UNIQUE INDEX "collection_idempotencyKey_key" ON "collection"("idempotencyKey");

-- CreateIndex
CREATE INDEX "collection_lineId_businessDate_idx" ON "collection"("lineId", "businessDate");

-- CreateIndex
CREATE INDEX "collection_accountLoanId_businessDate_idx" ON "collection"("accountLoanId", "businessDate");

-- CreateIndex
CREATE INDEX "collection_collectedByUserId_businessDate_idx" ON "collection"("collectedByUserId", "businessDate");

-- CreateIndex
CREATE INDEX "collection_accountScheduleId_idx" ON "collection"("accountScheduleId");

-- CreateIndex
CREATE INDEX "collection_adjustsCollectionId_idx" ON "collection"("adjustsCollectionId");

-- CreateIndex
CREATE UNIQUE INDEX "collection_approval_collectionId_key" ON "collection_approval"("collectionId");

-- CreateIndex
CREATE INDEX "collection_approval_decision_idx" ON "collection_approval"("decision");

-- CreateIndex
CREATE UNIQUE INDEX "day_close_lineId_businessDate_key" ON "day_close"("lineId", "businessDate");

-- CreateIndex
CREATE INDEX "cash_handover_dayCloseId_idx" ON "cash_handover"("dayCloseId");

-- CreateIndex
CREATE INDEX "cash_handover_fromUserId_idx" ON "cash_handover"("fromUserId");

-- CreateIndex
CREATE INDEX "cash_handover_toUserId_idx" ON "cash_handover"("toUserId");

-- CreateIndex
CREATE UNIQUE INDEX "cash_denomination_cashHandoverId_denomination_key" ON "cash_denomination"("cashHandoverId", "denomination");

-- CreateIndex
CREATE INDEX "ledger_account_accountType_idx" ON "ledger_account"("accountType");

-- CreateIndex
CREATE INDEX "ledger_account_ownerUserId_idx" ON "ledger_account"("ownerUserId");

-- CreateIndex
CREATE INDEX "ledger_account_accountLoanId_idx" ON "ledger_account"("accountLoanId");

-- CreateIndex
CREATE INDEX "ledger_transaction_businessDate_idx" ON "ledger_transaction"("businessDate");

-- CreateIndex
CREATE INDEX "ledger_transaction_sourceTable_sourceId_idx" ON "ledger_transaction"("sourceTable", "sourceId");

-- CreateIndex
CREATE INDEX "ledger_entry_ledgerAccountId_id_idx" ON "ledger_entry"("ledgerAccountId", "id");

-- CreateIndex
CREATE INDEX "ledger_entry_ledgerTransactionId_idx" ON "ledger_entry"("ledgerTransactionId");

-- CreateIndex
CREATE INDEX "notification_userId_readAt_idx" ON "notification"("userId", "readAt");

-- CreateIndex
CREATE UNIQUE INDEX "push_subscription_endpoint_key" ON "push_subscription"("endpoint");

-- CreateIndex
CREATE UNIQUE INDEX "push_subscription_fcmToken_key" ON "push_subscription"("fcmToken");

-- CreateIndex
CREATE INDEX "push_subscription_userId_idx" ON "push_subscription"("userId");

-- CreateIndex
CREATE INDEX "notification_outbox_notificationId_idx" ON "notification_outbox"("notificationId");

-- CreateIndex
CREATE INDEX "notification_outbox_pushSubscriptionId_idx" ON "notification_outbox"("pushSubscriptionId");

-- CreateIndex
CREATE INDEX "notification_outbox_status_nextAttemptAt_idx" ON "notification_outbox"("status", "nextAttemptAt");

-- CreateIndex
CREATE INDEX "holiday_organizationId_idx" ON "holiday"("organizationId");

-- CreateIndex
CREATE INDEX "holiday_sectorId_idx" ON "holiday"("sectorId");

-- CreateIndex
CREATE UNIQUE INDEX "holiday_date_sectorId_key" ON "holiday"("date", "sectorId");

-- CreateIndex
CREATE INDEX "audit_log_entityTable_entityId_idx" ON "audit_log"("entityTable", "entityId");

-- CreateIndex
CREATE INDEX "audit_log_actorUserId_idx" ON "audit_log"("actorUserId");

-- CreateIndex
CREATE INDEX "audit_log_createdAt_idx" ON "audit_log"("createdAt");

-- CreateIndex
CREATE INDEX "idempotency_key_userId_idx" ON "idempotency_key"("userId");

-- CreateIndex
CREATE INDEX "idempotency_key_expiresAt_idx" ON "idempotency_key"("expiresAt");

-- CreateIndex
CREATE UNIQUE INDEX "setting_key_key" ON "setting"("key");

-- CreateIndex
CREATE INDEX "setting_organizationId_idx" ON "setting"("organizationId");

-- AddForeignKey
ALTER TABLE "staff_profile" ADD CONSTRAINT "staff_profile_organizationId_fkey" FOREIGN KEY ("organizationId") REFERENCES "organization"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "staff_profile" ADD CONSTRAINT "staff_profile_userId_fkey" FOREIGN KEY ("userId") REFERENCES "user"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "sector" ADD CONSTRAINT "sector_organizationId_fkey" FOREIGN KEY ("organizationId") REFERENCES "organization"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "line" ADD CONSTRAINT "line_organizationId_fkey" FOREIGN KEY ("organizationId") REFERENCES "organization"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "line" ADD CONSTRAINT "line_sectorId_fkey" FOREIGN KEY ("sectorId") REFERENCES "sector"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "line_assignment" ADD CONSTRAINT "line_assignment_lineId_fkey" FOREIGN KEY ("lineId") REFERENCES "line"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "line_assignment" ADD CONSTRAINT "line_assignment_staffProfileId_fkey" FOREIGN KEY ("staffProfileId") REFERENCES "staff_profile"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "customer" ADD CONSTRAINT "customer_organizationId_fkey" FOREIGN KEY ("organizationId") REFERENCES "organization"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "customer" ADD CONSTRAINT "customer_sectorId_fkey" FOREIGN KEY ("sectorId") REFERENCES "sector"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "customer" ADD CONSTRAINT "customer_lineId_fkey" FOREIGN KEY ("lineId") REFERENCES "line"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "customer_reference" ADD CONSTRAINT "customer_reference_customerId_fkey" FOREIGN KEY ("customerId") REFERENCES "customer"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "account_loan" ADD CONSTRAINT "account_loan_organizationId_fkey" FOREIGN KEY ("organizationId") REFERENCES "organization"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "account_loan" ADD CONSTRAINT "account_loan_customerId_fkey" FOREIGN KEY ("customerId") REFERENCES "customer"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "account_loan" ADD CONSTRAINT "account_loan_lineId_fkey" FOREIGN KEY ("lineId") REFERENCES "line"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "account_schedule" ADD CONSTRAINT "account_schedule_accountLoanId_fkey" FOREIGN KEY ("accountLoanId") REFERENCES "account_loan"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "collection" ADD CONSTRAINT "collection_accountLoanId_fkey" FOREIGN KEY ("accountLoanId") REFERENCES "account_loan"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "collection" ADD CONSTRAINT "collection_accountScheduleId_fkey" FOREIGN KEY ("accountScheduleId") REFERENCES "account_schedule"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "collection" ADD CONSTRAINT "collection_lineId_fkey" FOREIGN KEY ("lineId") REFERENCES "line"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "collection" ADD CONSTRAINT "collection_adjustsCollectionId_fkey" FOREIGN KEY ("adjustsCollectionId") REFERENCES "collection"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "collection_approval" ADD CONSTRAINT "collection_approval_collectionId_fkey" FOREIGN KEY ("collectionId") REFERENCES "collection"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "day_close" ADD CONSTRAINT "day_close_lineId_fkey" FOREIGN KEY ("lineId") REFERENCES "line"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "cash_handover" ADD CONSTRAINT "cash_handover_dayCloseId_fkey" FOREIGN KEY ("dayCloseId") REFERENCES "day_close"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "cash_denomination" ADD CONSTRAINT "cash_denomination_cashHandoverId_fkey" FOREIGN KEY ("cashHandoverId") REFERENCES "cash_handover"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ledger_account" ADD CONSTRAINT "ledger_account_accountLoanId_fkey" FOREIGN KEY ("accountLoanId") REFERENCES "account_loan"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ledger_entry" ADD CONSTRAINT "ledger_entry_ledgerTransactionId_fkey" FOREIGN KEY ("ledgerTransactionId") REFERENCES "ledger_transaction"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ledger_entry" ADD CONSTRAINT "ledger_entry_ledgerAccountId_fkey" FOREIGN KEY ("ledgerAccountId") REFERENCES "ledger_account"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "notification" ADD CONSTRAINT "notification_userId_fkey" FOREIGN KEY ("userId") REFERENCES "user"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "push_subscription" ADD CONSTRAINT "push_subscription_userId_fkey" FOREIGN KEY ("userId") REFERENCES "user"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "notification_outbox" ADD CONSTRAINT "notification_outbox_notificationId_fkey" FOREIGN KEY ("notificationId") REFERENCES "notification"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "notification_outbox" ADD CONSTRAINT "notification_outbox_pushSubscriptionId_fkey" FOREIGN KEY ("pushSubscriptionId") REFERENCES "push_subscription"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "holiday" ADD CONSTRAINT "holiday_organizationId_fkey" FOREIGN KEY ("organizationId") REFERENCES "organization"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "holiday" ADD CONSTRAINT "holiday_sectorId_fkey" FOREIGN KEY ("sectorId") REFERENCES "sector"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "setting" ADD CONSTRAINT "setting_organizationId_fkey" FOREIGN KEY ("organizationId") REFERENCES "organization"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
