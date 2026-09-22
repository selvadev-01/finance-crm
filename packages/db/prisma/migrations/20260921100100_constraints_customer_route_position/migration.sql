-- US-040: a place on the visiting order counts from 1. Null means not yet placed.
ALTER TABLE "customer"
  ADD CONSTRAINT "customer_route_position_check"
    CHECK ("routePosition" IS NULL OR "routePosition" >= 1);
