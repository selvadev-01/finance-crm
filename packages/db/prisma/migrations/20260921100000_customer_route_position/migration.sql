-- US-040: a customer's place on its line's visiting order. Null until placed.

-- AlterTable
ALTER TABLE "customer" ADD COLUMN     "routePosition" INTEGER;

-- CreateIndex
CREATE UNIQUE INDEX "customer_line_route_position_key" ON "customer"("lineId", "routePosition") WHERE ("routePosition" IS NOT NULL);
