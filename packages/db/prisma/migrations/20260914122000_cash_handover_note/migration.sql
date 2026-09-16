-- S-06: the sender's note, required when the count differs from the system.

-- AlterTable
ALTER TABLE "cash_handover" ADD COLUMN     "note" TEXT;
