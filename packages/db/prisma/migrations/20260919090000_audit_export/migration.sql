-- M12 export: a report, dashboard or list downloaded as Excel or PDF is
-- recorded in the audit log. Like LOGIN, nothing changed — the entry records
-- who took which figures out of the system, with which filters.
--
-- The value is added here and first used in constraints_audit_export: a new
-- enum value cannot be used in the transaction that adds it.

-- AlterEnum
ALTER TYPE "AuditAction" ADD VALUE 'EXPORT';
