-- US-090: the audit log is read per organization, so each entry records the
-- organization it belongs to. Nullable: rows written before this column cannot
-- be backfilled (audit_log rejects UPDATE), and a sign-in attempt that matched
-- no staff member belongs to no organization.

-- AlterTable
ALTER TABLE "audit_log" ADD COLUMN     "organizationId" TEXT;

-- CreateIndex
CREATE INDEX "audit_log_organizationId_createdAt_idx" ON "audit_log"("organizationId", "createdAt");

-- AddForeignKey
ALTER TABLE "audit_log" ADD CONSTRAINT "audit_log_organizationId_fkey" FOREIGN KEY ("organizationId") REFERENCES "organization"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
