-- Which line a customer belonged to, and when (US-023, M04).
--
-- The open row is the current line, mirrored on "customer"."lineId". It is
-- what lets a Junior sync a collection taken at the door before the customer
-- was transferred away: the collection path asks whether the customer was on
-- the Junior's line on that collection's business date (BR-15).

-- CreateTable
CREATE TABLE "customer_line_period" (
    "id" TEXT NOT NULL,
    "customerId" TEXT NOT NULL,
    "lineId" TEXT NOT NULL,
    "effectiveFrom" DATE NOT NULL,
    "effectiveTo" DATE,
    "reason" TEXT,
    "createdAt" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMPTZ(3) NOT NULL,
    "createdByUserId" TEXT,

    CONSTRAINT "customer_line_period_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "customer_line_period_lineId_effectiveFrom_idx" ON "customer_line_period"("lineId", "effectiveFrom");

-- CreateIndex
CREATE INDEX "customer_line_period_customerId_effectiveFrom_idx" ON "customer_line_period"("customerId", "effectiveFrom");

-- CreateIndex
CREATE UNIQUE INDEX "customer_line_period_current_key" ON "customer_line_period"("customerId") WHERE ("effectiveTo" IS NULL);

-- AddForeignKey
ALTER TABLE "customer_line_period" ADD CONSTRAINT "customer_line_period_customerId_fkey" FOREIGN KEY ("customerId") REFERENCES "customer"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "customer_line_period" ADD CONSTRAINT "customer_line_period_lineId_fkey" FOREIGN KEY ("lineId") REFERENCES "line"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- Every existing customer has always been on its current line, so one open
-- period each, starting the business date it was onboarded (BR-12: the
-- business day is Asia/Kolkata, and this is the one place outside
-- `toBusinessDate` that converts — a backfill cannot call it).
INSERT INTO "customer_line_period" ("id", "customerId", "lineId", "effectiveFrom", "updatedAt", "createdByUserId")
SELECT
  'clp_' || "id",
  "id",
  "lineId",
  ("createdAt" AT TIME ZONE 'Asia/Kolkata')::date,
  CURRENT_TIMESTAMP,
  "createdByUserId"
FROM "customer";
