-- A refused security-relevant attempt (M13, ADR-0014).
--
-- Separate from `audit_log` on purpose: nothing changed, so there is no
-- before/after to snapshot, and nothing here has to be immutable. The table
-- therefore takes no append-only trigger — see constraints_security_event.

-- CreateEnum
CREATE TYPE "SecurityEventKind" AS ENUM ('PERMISSION_DENIED', 'RANK_GUARD', 'SELF_GUARD', 'SETTING_LOCKED', 'OUT_OF_SCOPE');

-- CreateTable
CREATE TABLE "security_event" (
    "id" TEXT NOT NULL,
    "organizationId" TEXT NOT NULL,
    "actorUserId" TEXT NOT NULL,
    "actorRole" "StaffRole" NOT NULL,
    "kind" "SecurityEventKind" NOT NULL,
    "code" TEXT NOT NULL,
    "status" INTEGER NOT NULL,
    "method" TEXT NOT NULL,
    "path" TEXT NOT NULL,
    "targetTable" TEXT,
    "targetId" TEXT,
    "detail" JSONB,
    "ipAddress" TEXT,
    "userAgent" TEXT,
    "createdAt" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "security_event_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "security_event_organizationId_createdAt_idx" ON "security_event"("organizationId", "createdAt");

-- CreateIndex
CREATE INDEX "security_event_actorUserId_idx" ON "security_event"("actorUserId");

-- CreateIndex
CREATE INDEX "security_event_code_idx" ON "security_event"("code");

-- AddForeignKey
ALTER TABLE "security_event" ADD CONSTRAINT "security_event_organizationId_fkey" FOREIGN KEY ("organizationId") REFERENCES "organization"("id") ON DELETE CASCADE ON UPDATE CASCADE;
