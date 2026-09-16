-- Email delivery (M10, notifications.md#email).
--
-- A separate outbox from push: notification_outbox rows each belong to one
-- device, and an email has no device. Rows are written in the transaction of
-- the event they describe and drained by the `dispatch-emails` job.
--
-- The recipient is the user, never a copied address: the address is read when
-- the email is sent, so a corrected address is used and a deleted user's
-- queued mail goes with them (cascade).

CREATE TYPE "EmailKind" AS ENUM ('NOTIFICATION', 'WELCOME');

CREATE TABLE "email_outbox" (
    "id" TEXT NOT NULL,
    "organizationId" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "kind" "EmailKind" NOT NULL,
    "notificationId" TEXT,
    "subject" TEXT NOT NULL,
    "textBody" TEXT NOT NULL,
    "htmlBody" TEXT,
    "status" "OutboxStatus" NOT NULL DEFAULT 'PENDING',
    "attempts" INTEGER NOT NULL DEFAULT 0,
    "lastError" TEXT,
    "nextAttemptAt" TIMESTAMPTZ(3),
    "sentAt" TIMESTAMPTZ(3),
    "createdAt" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMPTZ(3) NOT NULL,

    CONSTRAINT "email_outbox_pkey" PRIMARY KEY ("id")
);

CREATE INDEX "email_outbox_organizationId_status_nextAttemptAt_idx"
  ON "email_outbox"("organizationId", "status", "nextAttemptAt");
CREATE INDEX "email_outbox_userId_idx" ON "email_outbox"("userId");
CREATE INDEX "email_outbox_notificationId_idx" ON "email_outbox"("notificationId");

ALTER TABLE "email_outbox"
  ADD CONSTRAINT "email_outbox_organizationId_fkey"
    FOREIGN KEY ("organizationId") REFERENCES "organization"("id")
    ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "email_outbox"
  ADD CONSTRAINT "email_outbox_userId_fkey"
    FOREIGN KEY ("userId") REFERENCES "user"("id")
    ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "email_outbox"
  ADD CONSTRAINT "email_outbox_notificationId_fkey"
    FOREIGN KEY ("notificationId") REFERENCES "notification"("id")
    ON DELETE CASCADE ON UPDATE CASCADE;
