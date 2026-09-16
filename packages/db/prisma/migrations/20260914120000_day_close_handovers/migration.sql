-- M08 (US-060, US-061, US-064): which hop a handover is, and what each phone
-- last reported about its outbox. cash_handover is empty when this lands.

-- CreateEnum
CREATE TYPE "HandoverHop" AS ENUM ('JUNIOR_TO_SENIOR', 'SENIOR_TO_OFFICE');

-- AlterTable
ALTER TABLE "cash_handover" ADD COLUMN     "hop" "HandoverHop" NOT NULL;

-- CreateTable
CREATE TABLE "device_sync_report" (
    "id" TEXT NOT NULL,
    "staffProfileId" TEXT NOT NULL,
    "unsentCount" INTEGER NOT NULL,
    "oldestUnsentAt" TIMESTAMPTZ(3),
    "reportedAt" TIMESTAMPTZ(3) NOT NULL,
    "createdAt" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMPTZ(3) NOT NULL,

    CONSTRAINT "device_sync_report_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "device_sync_report_staffProfileId_key" ON "device_sync_report"("staffProfileId");

-- CreateIndex
CREATE UNIQUE INDEX "cash_handover_one_pending_key" ON "cash_handover"("dayCloseId", "fromUserId") WHERE ("status" = 'PENDING'::"HandoverStatus");

-- AddForeignKey
ALTER TABLE "device_sync_report" ADD CONSTRAINT "device_sync_report_staffProfileId_fkey" FOREIGN KEY ("staffProfileId") REFERENCES "staff_profile"("id") ON DELETE CASCADE ON UPDATE CASCADE;
