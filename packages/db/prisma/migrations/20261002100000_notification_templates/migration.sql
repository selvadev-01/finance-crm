-- US-074 notification templates: a business's own wording per message and
-- language, its channel choices, and each staff member's language.
-- CreateEnum
CREATE TYPE "Language" AS ENUM ('EN', 'TA');

-- AlterTable
ALTER TABLE "staff_profile" ADD COLUMN     "language" "Language" NOT NULL DEFAULT 'EN';

-- CreateTable
CREATE TABLE "notification_template" (
    "id" TEXT NOT NULL,
    "organizationId" TEXT NOT NULL,
    "key" TEXT NOT NULL,
    "language" "Language" NOT NULL,
    "title" TEXT,
    "body" TEXT,
    "emailSubject" TEXT NOT NULL,
    "emailHeading" TEXT NOT NULL,
    "emailBody" TEXT NOT NULL,
    "emailAction" TEXT NOT NULL,
    "emailFooter" TEXT NOT NULL,
    "createdAt" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMPTZ(3) NOT NULL,
    "createdByUserId" TEXT,
    "updatedByUserId" TEXT,

    CONSTRAINT "notification_template_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "notification_channel" (
    "id" TEXT NOT NULL,
    "organizationId" TEXT NOT NULL,
    "key" TEXT NOT NULL,
    "push" BOOLEAN NOT NULL,
    "email" BOOLEAN NOT NULL,
    "createdAt" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMPTZ(3) NOT NULL,
    "createdByUserId" TEXT,

    CONSTRAINT "notification_channel_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "notification_template_organizationId_key_language_key" ON "notification_template"("organizationId", "key", "language");

-- CreateIndex
CREATE UNIQUE INDEX "notification_channel_organizationId_key_key" ON "notification_channel"("organizationId", "key");

-- AddForeignKey
ALTER TABLE "notification_template" ADD CONSTRAINT "notification_template_organizationId_fkey" FOREIGN KEY ("organizationId") REFERENCES "organization"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "notification_channel" ADD CONSTRAINT "notification_channel_organizationId_fkey" FOREIGN KEY ("organizationId") REFERENCES "organization"("id") ON DELETE CASCADE ON UPDATE CASCADE;

