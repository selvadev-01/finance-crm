"use client";

import { RoleLanding } from "../../lib/role-landing";

/** Junior landing (US-001). Today's route is S-01 / US-040. */
export default function RoutePage() {
  return <RoleLanding screen="Today’s route" role={["JUNIOR"]} />;
}
